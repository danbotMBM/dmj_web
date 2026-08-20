package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
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
	maxVoicePeers     = 6
	voiceNameMaxLen   = 16
	voiceColorRegex   = `^#[0-9a-fA-F]{6}$`
	defaultVoiceColor = "#5b8def"
	// writeTimeout bounds how long a single send to a slow client may block the
	// hub before we give up on that client.
	voiceWriteTimeout = 10 * time.Second
)

var voiceColorRe = regexp.MustCompile(voiceColorRegex)

// signalMsg is the wire format exchanged over the WebSocket in both directions.
// Only a subset of fields is set for any given Type.
type signalMsg struct {
	Type string `json:"type"`

	// Client -> server
	Name  string          `json:"name,omitempty"`  // join/profile: display name
	Color string          `json:"color,omitempty"` // join/profile: circle color (#rrggbb)
	X     float64         `json:"x,omitempty"`     // join/move: world position
	Y     float64         `json:"y,omitempty"`     // join/move: world position
	To    string          `json:"to,omitempty"`    // signal: target peer id
	Data  json.RawMessage `json:"data,omitempty"`  // signal: opaque SDP/ICE payload

	// Server -> client
	Self  string       `json:"self,omitempty"`  // welcome: this client's assigned id
	From  string       `json:"from,omitempty"`  // signal: origin peer id
	Peers []voicePeerI `json:"peers,omitempty"` // welcome: existing peers
	Peer  *voicePeerI  `json:"peer,omitempty"`  // peer-join: the peer that joined
	ID    string       `json:"id,omitempty"`    // peer-leave/peer-move/peer-profile: the peer
	Msg   string       `json:"msg,omitempty"`   // error: human-readable reason
}

// voicePeerI is the public view of a peer (no connection internals).
type voicePeerI struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Color string  `json:"color"`
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
}

// voicePeer is a single connected client.
type voicePeer struct {
	id string
	// metaMu guards name/color/x/y, updated frequently by "move"/"profile"
	// messages independent of the hub-wide membership lock.
	metaMu sync.Mutex
	name   string
	color  string
	x, y   float64
	conn   *websocket.Conn
	// send serializes writes to conn; the hub and the read loop must not write
	// concurrently to a websocket connection.
	sendMu sync.Mutex
}

func (p *voicePeer) setPos(x, y float64) {
	p.metaMu.Lock()
	p.x, p.y = x, y
	p.metaMu.Unlock()
}

func (p *voicePeer) setProfile(name, color string) {
	p.metaMu.Lock()
	if name != "" {
		p.name = name
	}
	if color != "" {
		p.color = color
	}
	p.metaMu.Unlock()
}

func (p *voicePeer) view() voicePeerI {
	p.metaMu.Lock()
	defer p.metaMu.Unlock()
	return voicePeerI{ID: p.id, Name: p.name, Color: p.color, X: p.x, Y: p.y}
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

	http.HandleFunc("/voice/profile", cors(handleVoiceProfileSave))
	registerRoute("POST", "/voice/profile", "Save a player's name/color under their token")

	http.HandleFunc("/voice/profile/", cors(handleVoiceProfileGet))
	registerRoute("GET", "/voice/profile/{token}", "Fetch a player's saved name/color by token")
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
			color := sanitizeVoiceColor(msg.Color)
			peer.setPos(msg.X, msg.Y)
			if ok := voice.add(ctx, peer, name, color); !ok {
				peer.send(ctx, signalMsg{Type: "room-full"})
				return
			}
			joined = true

		case "signal":
			if !joined || msg.To == "" {
				continue
			}
			voice.relay(ctx, peer, msg)

		case "move":
			if !joined {
				continue
			}
			voice.move(ctx, peer, msg.X, msg.Y)

		case "profile":
			if !joined {
				continue
			}
			voice.updateProfile(ctx, peer, msg.Name, msg.Color)

		case "leave":
			return

		default:
			// ignore unknown types
		}
	}
}

// add seats a peer if there's room and announces it. It also sends the new peer
// a welcome with the existing roster. Returns false if the room is full.
func (h *voiceHub) add(ctx context.Context, p *voicePeer, name, color string) bool {
	h.mu.Lock()
	if len(h.peers) >= maxVoicePeers {
		h.mu.Unlock()
		return false
	}
	p.setProfile(name, color)

	// Snapshot existing peers for the welcome before adding self.
	existing := make([]voicePeerI, 0, len(h.peers))
	others := make([]*voicePeer, 0, len(h.peers))
	for _, o := range h.peers {
		existing = append(existing, o.view())
		others = append(others, o)
	}
	h.peers[p.id] = p
	h.mu.Unlock()

	// Tell the newcomer who's already here. By convention the newcomer is the
	// offerer toward every existing peer, which keeps mesh negotiation simple
	// and glare-free (only one side initiates per pair).
	p.send(ctx, signalMsg{Type: "welcome", Self: p.id, Peers: existing})

	// Tell everyone else that a peer joined.
	view := p.view()
	join := signalMsg{Type: "peer-join", Peer: &view}
	for _, o := range others {
		o.send(ctx, join)
	}
	return true
}

// move updates a peer's world position and broadcasts it to the rest of the
// room. Positions drive client-side proximity/line-of-sight gain, so they're
// broadcast to everyone rather than relayed to one target.
func (h *voiceHub) move(ctx context.Context, p *voicePeer, x, y float64) {
	p.setPos(x, y)
	h.mu.Lock()
	others := make([]*voicePeer, 0, len(h.peers))
	for _, o := range h.peers {
		if o.id != p.id {
			others = append(others, o)
		}
	}
	h.mu.Unlock()

	move := signalMsg{Type: "peer-move", ID: p.id, X: x, Y: y}
	for _, o := range others {
		o.send(ctx, move)
	}
}

// updateProfile applies a live name/color change and broadcasts it. Either
// field may be empty (unchanged) except that an empty name is never applied
// (a display name is always required).
func (h *voiceHub) updateProfile(ctx context.Context, p *voicePeer, name, color string) {
	if name != "" {
		name = sanitizeVoiceName(name)
	}
	if color != "" {
		color = sanitizeVoiceColor(color)
	}
	p.setProfile(name, color)
	view := p.view()

	h.mu.Lock()
	others := make([]*voicePeer, 0, len(h.peers))
	for _, o := range h.peers {
		if o.id != p.id {
			others = append(others, o)
		}
	}
	h.mu.Unlock()

	update := signalMsg{Type: "peer-profile", ID: p.id, Name: view.Name, Color: view.Color}
	for _, o := range others {
		o.send(ctx, update)
	}
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

// sanitizeVoiceColor accepts only a strict #rrggbb hex color, falling back to
// the default so a malformed value can never end up driving arbitrary CSS/SVG
// on other clients.
func sanitizeVoiceColor(color string) string {
	color = strings.TrimSpace(color)
	if voiceColorRe.MatchString(color) {
		return color
	}
	return defaultVoiceColor
}

// ---------------------------------------------------------------------------
// Player profile persistence — lets a player carry their name/color across
// devices and sessions via a token they hold (in localStorage, or pasted into
// the settings drawer on another device). Stored in the shared analytics
// sqlite DB, consistent with the rest of the backend's persistence.
// ---------------------------------------------------------------------------

const voiceTokenRegex = `^[A-Za-z0-9_-]{8,64}$`

var voiceTokenRe = regexp.MustCompile(voiceTokenRegex)

func isValidVoiceToken(token string) bool {
	return voiceTokenRe.MatchString(token)
}

func initVoiceProfilesTable() {
	if analyticsDB == nil {
		return
	}
	schema := `CREATE TABLE IF NOT EXISTS voice_players (
		token      TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		color      TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);`
	if _, err := analyticsDB.Exec(schema); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create voice_players schema: %v\n", err)
	}
}

type voiceProfile struct {
	Token string `json:"token"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

// handleVoiceProfileSave upserts a player's saved name/color under their
// token (POST /voice/profile).
func handleVoiceProfileSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if analyticsDB == nil {
		http.Error(w, "Not available", http.StatusServiceUnavailable)
		return
	}

	var body voiceProfile
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if !isValidVoiceToken(body.Token) {
		http.Error(w, "Invalid token", http.StatusBadRequest)
		return
	}

	name := sanitizeVoiceName(body.Name)
	color := sanitizeVoiceColor(body.Color)
	now := time.Now().UTC().Format(time.RFC3339)

	_, err := analyticsDB.Exec(`
		INSERT INTO voice_players (token, name, color, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(token) DO UPDATE SET
			name = excluded.name,
			color = excluded.color,
			updated_at = excluded.updated_at
	`, body.Token, name, color, now)
	if err != nil {
		fmt.Fprintf(os.Stderr, "voice_players upsert error: %v\n", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(voiceProfile{Token: body.Token, Name: name, Color: color})
}

// handleVoiceProfileGet fetches a saved profile by token (GET
// /voice/profile/{token}), used to restore identity on another device.
func handleVoiceProfileGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if analyticsDB == nil {
		http.Error(w, "Not available", http.StatusServiceUnavailable)
		return
	}

	token := strings.TrimPrefix(r.URL.Path, "/voice/profile/")
	if !isValidVoiceToken(token) {
		http.Error(w, "Invalid token", http.StatusBadRequest)
		return
	}

	var p voiceProfile
	p.Token = token
	err := analyticsDB.QueryRow(
		`SELECT name, color FROM voice_players WHERE token = ?`, token,
	).Scan(&p.Name, &p.Color)
	if err == sql.ErrNoRows {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}
