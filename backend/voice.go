package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// ---------------------------------------------------------------------------
// Voice chat — WebRTC signaling server for a single global voice room.
//
// Architecture (see games/voice for the client): audio itself never touches
// this server. Browsers form a peer-to-peer WebRTC *mesh*; this server only
// relays the signaling needed to set those connections up (SDP offers/answers
// and ICE candidates) and tracks who is in the room so each client can build
// the mesh. Per-user volume and (later) proximity attenuation are applied
// client-side with Web Audio gain nodes, so they need no server involvement.
//
// State is in-memory only and a restart drops everyone (casual feature). The
// room is capped at maxVoicePeers; extra joiners are told the room is full.
//
// Why mesh + signaling-only rather than an SFU: for <=6 participants a mesh is
// trivially cheap (each browser holds <=5 connections), keeps this server's
// bandwidth/CPU near zero, and avoids a heavy media dependency. If we ever need
// server-authoritative proximity mixing or larger rooms, this signaling layer
// can be swapped for a pion-based SFU without changing the room model.
// ---------------------------------------------------------------------------

const (
	maxVoicePeers   = 6
	voiceNameMaxLen = 16
	// writeTimeout bounds how long a single send to a slow client may block the
	// hub before we give up on that client.
	voiceWriteTimeout = 10 * time.Second
)

// signalMsg is the wire format exchanged over the WebSocket in both directions.
// Only a subset of fields is set for any given Type.
type signalMsg struct {
	Type string `json:"type"`

	// Client -> server
	Name string          `json:"name,omitempty"` // join: requested display name
	To   string          `json:"to,omitempty"`   // signal: target peer id
	Data json.RawMessage `json:"data,omitempty"` // signal: opaque SDP/ICE payload

	// Server -> client
	Self  string       `json:"self,omitempty"`  // welcome: this client's assigned id
	From  string       `json:"from,omitempty"`  // signal: origin peer id
	Peers []voicePeerI `json:"peers,omitempty"` // welcome: existing peers
	Peer  *voicePeerI  `json:"peer,omitempty"`  // peer-join: the peer that joined
	ID    string       `json:"id,omitempty"`    // peer-leave: the peer that left
	Msg   string       `json:"msg,omitempty"`   // error: human-readable reason
}

// voicePeerI is the public view of a peer (no connection internals).
type voicePeerI struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// voicePeer is a single connected client.
type voicePeer struct {
	id   string
	name string
	conn *websocket.Conn
	// send serializes writes to conn; the hub and the read loop must not write
	// concurrently to a websocket connection.
	sendMu sync.Mutex
}

// voiceHub holds the single global room. All access is guarded by mu.
type voiceHub struct {
	mu    sync.Mutex
	peers map[string]*voicePeer
}

var voice = &voiceHub{peers: make(map[string]*voicePeer)}

// iceServersJSON returns the ICE server configuration handed to clients. STUN
// is always included (free, public). A TURN relay is optional and configured
// purely through env vars so coturn can be dropped in later without code
// changes — without TURN, clients behind restrictive/symmetric NAT may fail to
// connect peer-to-peer, which is acceptable for a casual v1.
func iceServersJSON() []map[string]any {
	servers := []map[string]any{
		{"urls": []string{"stun:stun.l.google.com:19302"}},
	}
	if turn := os.Getenv("TURN_URL"); turn != "" {
		s := map[string]any{"urls": []string{turn}}
		if u := os.Getenv("TURN_USERNAME"); u != "" {
			s["username"] = u
		}
		if c := os.Getenv("TURN_CREDENTIAL"); c != "" {
			s["credential"] = c
		}
		servers = append(servers, s)
	}
	return servers
}

func registerVoiceRoutes() {
	http.HandleFunc("/voice/config", cors(voiceConfig))
	registerRoute("GET", "/voice/config", "Get WebRTC ICE servers + room limits")

	http.HandleFunc("/voice/ws", voiceWS)
	registerRoute("GET", "/voice/ws", "WebSocket signaling for the voice room")
}

// voiceConfig returns the ICE servers and room limits the client needs before
// opening the signaling socket.
func voiceConfig(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"iceServers": iceServersJSON(),
		"maxPeers":   maxVoicePeers,
	})
}

// voiceWS upgrades to a WebSocket and runs the signaling loop for one client.
func voiceWS(w http.ResponseWriter, r *http.Request) {
	// Restrict the upgrade to our own origins (the browser sends Origin on WS
	// handshakes). corsOrigin is the canonical site; also allow same-host dev.
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: []string{
			"danbotlab.com", "*.danbotlab.com",
			"danielmarkjones.com", "*.danielmarkjones.com",
			"danbotlab", "*.danbotlab", "localhost", "localhost:*",
		},
	})
	if err != nil {
		return // Accept already wrote an error response
	}
	// Generous read limit: SDP offers with many ICE candidates can be a few KB.
	c.SetReadLimit(1 << 16) // 64 KiB

	peer := &voicePeer{id: newVoiceID(), conn: c}

	// The peer is not added to the room until it sends a valid join. Until then
	// it occupies no seat. ctx lives for the whole connection.
	ctx := context.Background()

	defer func() {
		voice.remove(peer)
		c.CloseNow()
	}()

	joined := false
	for {
		_, raw, err := c.Read(ctx)
		if err != nil {
			return // client closed or errored
		}

		var msg signalMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			peer.send(ctx, signalMsg{Type: "error", Msg: "bad message"})
			continue
		}

		switch msg.Type {
		case "join":
			if joined {
				continue // already seated; ignore duplicate joins
			}
			name := sanitizeVoiceName(msg.Name)
			if ok := voice.add(ctx, peer, name); !ok {
				peer.send(ctx, signalMsg{Type: "room-full"})
				return
			}
			joined = true

		case "signal":
			if !joined || msg.To == "" {
				continue
			}
			voice.relay(ctx, peer, msg)

		case "leave":
			return

		default:
			// ignore unknown types
		}
	}
}

// add seats a peer if there's room and announces it. It also sends the new peer
// a welcome with the existing roster. Returns false if the room is full.
func (h *voiceHub) add(ctx context.Context, p *voicePeer, name string) bool {
	h.mu.Lock()
	if len(h.peers) >= maxVoicePeers {
		h.mu.Unlock()
		return false
	}
	p.name = name

	// Snapshot existing peers for the welcome before adding self.
	existing := make([]voicePeerI, 0, len(h.peers))
	others := make([]*voicePeer, 0, len(h.peers))
	for _, o := range h.peers {
		existing = append(existing, voicePeerI{ID: o.id, Name: o.name})
		others = append(others, o)
	}
	h.peers[p.id] = p
	h.mu.Unlock()

	// Tell the newcomer who's already here. By convention the newcomer is the
	// offerer toward every existing peer, which keeps mesh negotiation simple
	// and glare-free (only one side initiates per pair).
	p.send(ctx, signalMsg{Type: "welcome", Self: p.id, Peers: existing})

	// Tell everyone else that a peer joined.
	join := signalMsg{Type: "peer-join", Peer: &voicePeerI{ID: p.id, Name: p.name}}
	for _, o := range others {
		o.send(ctx, join)
	}
	return true
}

// remove drops a peer (if present) and notifies the rest of the room.
func (h *voiceHub) remove(p *voicePeer) {
	h.mu.Lock()
	if _, ok := h.peers[p.id]; !ok {
		h.mu.Unlock()
		return
	}
	delete(h.peers, p.id)
	others := make([]*voicePeer, 0, len(h.peers))
	for _, o := range h.peers {
		others = append(others, o)
	}
	h.mu.Unlock()

	leave := signalMsg{Type: "peer-leave", ID: p.id}
	for _, o := range others {
		o.send(context.Background(), leave)
	}
}

// relay forwards a signaling payload from one peer to a specific target peer.
func (h *voiceHub) relay(ctx context.Context, from *voicePeer, msg signalMsg) {
	h.mu.Lock()
	target := h.peers[msg.To]
	h.mu.Unlock()
	if target == nil {
		return // target gone; the disconnect notice will clean up the client
	}
	target.send(ctx, signalMsg{Type: "signal", From: from.id, Data: msg.Data})
}

// send writes one JSON message to the peer, serialized per-connection and
// bounded by a write timeout so a stuck client can't wedge the hub.
func (p *voicePeer) send(ctx context.Context, msg signalMsg) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	p.sendMu.Lock()
	defer p.sendMu.Unlock()
	wctx, cancel := context.WithTimeout(ctx, voiceWriteTimeout)
	defer cancel()
	if err := p.conn.Write(wctx, websocket.MessageText, b); err != nil {
		// Best-effort: close so the read loop unblocks and cleanup runs.
		p.conn.CloseNow()
	}
}

// newVoiceID returns a short random hex id for a connection, kept distinct from
// the client's persistent player id so signaling routing is per-connection.
func newVoiceID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		// Fall back to a timestamp-based id; collisions are astronomically
		// unlikely at this scale and only affect a single casual room.
		return fmt.Sprintf("t%d", time.Now().UnixNano())
	}
	return fmt.Sprintf("%x", b)
}

func sanitizeVoiceName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Guest"
	}
	r := []rune(name)
	if len(r) > voiceNameMaxLen {
		r = r[:voiceNameMaxLen]
	}
	return string(r)
}
