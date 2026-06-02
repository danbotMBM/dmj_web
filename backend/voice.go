package main

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// ---------------------------------------------------------------------------
// Voice chat — server-side audio mixing (MCU model).
//
// Up to 6 players join a single shared room over a WebSocket. Each client
// streams its microphone as raw 16-bit PCM (16 kHz mono, 20 ms frames) to the
// server. A single mix loop ticks every 20 ms and, for *each listener*, sums
// the most recent frame of every *other* active speaker — applying that
// listener's per-speaker volume gain — into one personalized mixed frame that
// is sent back down the same socket.
//
// Why mix on the server (harder, but more extensible): volume, muting, and
// future *proximity* attenuation are all just per-(listener,speaker) gain
// factors computed authoritatively in one place (mixFrameLocked). Proximity
// chat drops in later as `gain *= proximityGain(listener, speaker)` using the
// position fields already carried on each player — no client or protocol
// changes required. The trade-off is CPU: the server decodes, gain-scales, and
// re-sums audio for every listener every tick (O(listeners x speakers)).
//
// Protocol (single WebSocket, mixed text + binary):
//   client -> server  binary : one 640-byte PCM frame (only sent when the
//                              client's voice-activity gate is open)
//   client -> server  text   : JSON control {"type": "volume"|"mute"|"position"}
//   server -> client  binary : one 640-byte mixed PCM frame (only when at least
//                              one other speaker is audible to this listener)
//   server -> client  text   : JSON {"type": "welcome"|"roster"|"activity"|"error"}
//
// State is in-memory only; a restart empties the room (casual feature).
// ---------------------------------------------------------------------------

const (
	voiceSampleRate   = 16000                                                  // 16 kHz wideband voice
	voiceFrameMs      = 20                                                      // mix tick / frame size
	voiceFrameSamples = voiceSampleRate * voiceFrameMs / 1000                  // 320 samples
	voiceFrameBytes   = voiceFrameSamples * 2                                   // 640 bytes (int16 LE)
	voiceTick         = voiceFrameMs * time.Millisecond                         //
	voiceMaxPlayers   = 6                                                       //
	voiceJitterPrime  = 2                                                       // frames buffered before a talkspurt starts draining
	voiceInBufFrames  = 16                                                      // per-speaker uplink jitter buffer cap (~320 ms)
	voiceOutBufFrames = 32                                                      // per-listener downlink buffer cap
	voiceMaxGain      = 2.0                                                     // 200% slider ceiling
	voiceMaxNameLen   = 16                                                      //

	// Proximity chat: players move around a fixed 2D world (clients and server
	// share these coordinates). Volume falls off with distance via a smoothstep
	// between a full-volume inner radius and a silent outer radius.
	voiceWorldW       = 900 // world width  in world units (== canvas px)
	voiceWorldH       = 540 // world height in world units
	voiceFullRadius   = 200 // distance at/under which a speaker is at full volume
	voiceSilenceRadius = 700 // distance at/beyond which a speaker is inaudible
	voiceOccludedGain = 0.2 // volume multiplier when a wall blocks the line of sight
	voicePlayerRadius = 18  // avatar radius, used for wall collision (matches client R)
)

// voiceWall is an axis-aligned wall rectangle in world coordinates.
type voiceWall struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// voiceWalls partitions the world into a connected 3x2 grid of rooms. This is
// the single source of truth: it's sent to clients in the welcome message for
// rendering + local collision, and enforced here so players can't pass through.
// Two vertical dividers (x=300, x=600) and one horizontal divider (y=270) split
// the space into six rooms; each divider has a doorway centered in every cell,
// kept well clear of the intersections so the openings never pinch shut.
var voiceWalls = []voiceWall{
	// Vertical divider 1 (x=300): doorways at y 85..185 (top row) and 355..455 (bottom).
	{292, 0, 16, 85}, {292, 185, 16, 170}, {292, 455, 16, 85},
	// Vertical divider 2 (x=600): same doorways.
	{592, 0, 16, 85}, {592, 185, 16, 170}, {592, 455, 16, 85},
	// Horizontal divider (y=270): doorways at x 100..200, 400..500, 700..800.
	{0, 262, 100, 16}, {200, 262, 200, 16}, {500, 262, 200, 16}, {800, 262, 100, 16},
}

// voiceOriginPatterns lists the origins allowed to open the voice WebSocket.
// Mirrors the static-site hosts in utils.js / nginx.conf (the page and the API
// live on different subdomains, so this is a genuine cross-origin upgrade).
var voiceOriginPatterns = []string{
	"danbotlab", "*.danbotlab",
	"danbotlab.com", "*.danbotlab.com",
	"danielmarkjones.com", "*.danielmarkjones.com",
	"localhost", "localhost:*", "127.0.0.1:*",
}

// outMsg is a queued outbound WebSocket message. All writes for a connection go
// through its single writer goroutine via the player's out channel, so audio
// frames and control messages never race on the socket.
type outMsg struct {
	typ  websocket.MessageType
	data []byte
}

// voicePlayer is one connected participant.
type voicePlayer struct {
	id   string
	name string
	conn *websocket.Conn

	in  chan []int16 // uplink mic frames (jitter buffer), drained by the mix loop
	out chan outMsg  // outbound messages, drained by the writer goroutine

	cancel context.CancelFunc // cancels this connection's read/write goroutines

	// --- fields below are guarded by voiceRoom.mu ---

	// gains[speakerID] is this listener's volume for that speaker (1.0 = 100%).
	// Absent = default 1.0. Set by the per-user volume sliders.
	gains map[string]float64

	muted bool // self-muted: this player neither transmits nor is mixed for others

	// Proximity: the player's position in the shared 2D world, updated by the
	// client's "position" control messages and used by proximityGain to set the
	// distance-based volume each listener hears.
	x, y float64

	// --- mix-loop-only scratch (also under mu, but only touched there) ---
	primed   bool    // jitter buffer has reached prime depth and is draining
	cur      []int16 // frame chosen for the current tick, nil = silence
	speaking bool     // whether cur != nil this tick (drives the roster dots)
}

// voiceRoom is the single shared room.
type voiceRoom struct {
	mu      sync.Mutex
	players map[string]*voicePlayer
	lastAct string // signature of the last broadcast speaking set (de-dupes activity msgs)
}

var voice = &voiceRoom{players: make(map[string]*voicePlayer)}

func registerVoiceRoutes() {
	http.HandleFunc("/voice/ws", voiceWS)
	registerRoute("GET", "/voice/ws", "Voice chat WebSocket (PCM in/out + JSON control)")

	http.HandleFunc("/voice/info", cors(voiceInfo))
	registerRoute("GET", "/voice/info", "Voice room status (player count, capacity)")

	go voice.mixLoop()
}

// voiceInfo reports lightweight room status so the page can show "n/6" before
// the user commits to opening their mic.
func voiceInfo(w http.ResponseWriter, r *http.Request) {
	voice.mu.Lock()
	names := make([]string, 0, len(voice.players))
	for _, p := range voice.players {
		names = append(names, p.name)
	}
	voice.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"players":     names,
		"count":       len(names),
		"max":         voiceMaxPlayers,
		"sampleRate":  voiceSampleRate,
		"frameSamples": voiceFrameSamples,
	})
}

// voiceWS upgrades the request and runs one participant's session.
func voiceWS(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		OriginPatterns: voiceOriginPatterns,
	})
	if err != nil {
		return // Accept already wrote the error response
	}
	conn.SetReadLimit(8192) // frames are 640 B; control JSON is tiny

	name := sanitizeName(r.URL.Query().Get("name"))
	id := r.URL.Query().Get("id")
	if id == "" {
		id = newPlayerID()
	}

	ctx, cancel := context.WithCancel(context.Background())
	sx, sy := voiceSpawn()
	p := &voicePlayer{
		id:     id,
		name:   name,
		conn:   conn,
		in:     make(chan []int16, voiceInBufFrames),
		out:    make(chan outMsg, voiceOutBufFrames),
		cancel: cancel,
		gains:  make(map[string]float64),
		x:      sx,
		y:      sy,
	}

	if !voice.add(p) {
		// Room full: tell the client cleanly so it can show a message.
		conn.Write(ctx, websocket.MessageText, mustJSON(map[string]any{
			"type": "error", "code": "full", "message": "Voice room is full (max 6).",
		}))
		conn.Close(websocket.StatusTryAgainLater, "room full")
		cancel()
		return
	}

	// Single writer goroutine owns all socket writes.
	go p.writeLoop(ctx)

	// Greet the new player with its id and the audio format, then everyone gets
	// a fresh roster (the joiner included).
	p.send(websocket.MessageText, mustJSON(map[string]any{
		"type":          "welcome",
		"id":            id,
		"name":          name,
		"sampleRate":    voiceSampleRate,
		"frameSamples":  voiceFrameSamples,
		"max":           voiceMaxPlayers,
		"worldW":        voiceWorldW,
		"worldH":        voiceWorldH,
		"fullRadius":    voiceFullRadius,
		"silenceRadius": voiceSilenceRadius,
		"occludedGain":  voiceOccludedGain,
		"walls":         voiceWalls,
		"x":             p.x,
		"y":             p.y,
	}))
	voice.broadcastRoster()

	// Read loop runs on this goroutine until the socket closes.
	voice.readLoop(ctx, p)

	// Teardown.
	voice.remove(id)
	cancel()
	conn.Close(websocket.StatusNormalClosure, "bye")
}

// readLoop pumps inbound frames and control messages until the socket errors.
func (room *voiceRoom) readLoop(ctx context.Context, p *voicePlayer) {
	for {
		typ, data, err := p.conn.Read(ctx)
		if err != nil {
			return
		}
		switch typ {
		case websocket.MessageBinary:
			if len(data) != voiceFrameBytes {
				continue // ignore malformed frames
			}
			frame := bytesToInt16(data)
			// Push into the jitter buffer; if it's full the client is ahead of
			// the mix clock, so drop the oldest frame to stay near-live.
			select {
			case p.in <- frame:
			default:
				select {
				case <-p.in:
				default:
				}
				select {
				case p.in <- frame:
				default:
				}
			}
		case websocket.MessageText:
			room.handleControl(p, data)
		}
	}
}

// handleControl applies a JSON control message from the client.
func (room *voiceRoom) handleControl(p *voicePlayer, data []byte) {
	var msg struct {
		Type   string  `json:"type"`
		Target string  `json:"target"`
		Gain   float64 `json:"gain"`
		Muted  bool    `json:"muted"`
		X      float64 `json:"x"`
		Y      float64 `json:"y"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	switch msg.Type {
	case "volume":
		if msg.Target == "" {
			return
		}
		g := msg.Gain
		if g < 0 {
			g = 0
		}
		if g > voiceMaxGain {
			g = voiceMaxGain
		}
		room.mu.Lock()
		p.gains[msg.Target] = g
		room.mu.Unlock()
	case "mute":
		room.mu.Lock()
		changed := p.muted != msg.Muted
		p.muted = msg.Muted
		if msg.Muted {
			drainFrames(p.in) // stop any buffered audio from leaking out
		}
		room.mu.Unlock()
		if changed {
			room.broadcastRoster()
		}
	case "position":
		// Clamp into the world, then accept the move only if the destination is
		// clear of walls. The client moves continuously and never steps into a
		// wall, so each ~18-unit position update lands just outside; since that's
		// far smaller than a wall's inflated width, rejecting in-wall endpoints is
		// enough to keep players out of and from tunneling through walls.
		nx := clampF(msg.X, 0, voiceWorldW)
		ny := clampF(msg.Y, 0, voiceWorldH)
		room.mu.Lock()
		if !pointBlocked(nx, ny) {
			p.x, p.y = nx, ny
		}
		room.mu.Unlock()
	}
}

// writeLoop owns all writes for one connection and keeps it alive with pings.
func (p *voicePlayer) writeLoop(ctx context.Context) {
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-p.out:
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := p.conn.Write(wctx, m.typ, m.data)
			cancel()
			if err != nil {
				p.cancel()
				return
			}
		case <-ping.C:
			wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err := p.conn.Ping(wctx)
			cancel()
			if err != nil {
				p.cancel()
				return
			}
		}
	}
}

// send queues an outbound message, dropping it if the buffer is full. Dropping
// an audio frame is harmless (the client plays silence); control messages are
// re-sent by the next state change, so a rare drop is acceptable too.
func (p *voicePlayer) send(typ websocket.MessageType, data []byte) {
	select {
	case p.out <- outMsg{typ, data}:
	default:
	}
}

// ---------------------------------------------------------------------------
// Room membership
// ---------------------------------------------------------------------------

func (room *voiceRoom) add(p *voicePlayer) bool {
	room.mu.Lock()
	defer room.mu.Unlock()
	if len(room.players) >= voiceMaxPlayers {
		return false
	}
	room.players[p.id] = p
	return true
}

func (room *voiceRoom) remove(id string) {
	room.mu.Lock()
	_, ok := room.players[id]
	delete(room.players, id)
	room.mu.Unlock()
	if ok {
		room.broadcastRoster()
	}
}

// ---------------------------------------------------------------------------
// Mixing
// ---------------------------------------------------------------------------

// mixLoop ticks every 20 ms forever, producing one personalized mixed frame per
// listener. It is cheap when the room is empty or silent.
func (room *voiceRoom) mixLoop() {
	t := time.NewTicker(voiceTick)
	defer t.Stop()
	activity := 0
	for range t.C {
		room.mu.Lock()
		room.advanceJitterLocked()
		room.mixFrameLocked()
		if activity++; activity >= 5 { // ~every 100 ms
			activity = 0
			room.broadcastActivityLocked()
			room.broadcastPositionsLocked()
		}
		room.mu.Unlock()
	}
}

// advanceJitterLocked selects the frame each speaker contributes this tick,
// honoring the jitter-buffer prime depth so a talkspurt only starts playing
// once a small cushion has accumulated.
func (room *voiceRoom) advanceJitterLocked() {
	for _, p := range room.players {
		p.cur = nil
		if p.muted {
			drainFrames(p.in)
			p.primed, p.speaking = false, false
			continue
		}
		if !p.primed && len(p.in) >= voiceJitterPrime {
			p.primed = true
		}
		if p.primed {
			select {
			case f := <-p.in:
				p.cur = f
			default:
				p.primed = false // underrun: wait to re-prime
			}
		}
		p.speaking = p.cur != nil
	}
}

// mixFrameLocked sums, for every listener, the gain-scaled current frame of
// every other speaker and queues the result. This is the single place where
// gain is applied: proximity (distance-based) times the listener's manual
// per-user volume slider.
func (room *voiceRoom) mixFrameLocked() {
	for _, l := range room.players {
		var acc []int32
		for _, s := range room.players {
			if s.id == l.id || s.cur == nil {
				continue
			}
			// Proximity sets the base volume from how close the two avatars are;
			// out-of-range speakers contribute nothing (and are skipped, which is
			// the CPU win of a bounded falloff).
			gain := proximityGain(l, s)
			if gain <= 0 {
				continue
			}
			// The manual slider is a personal multiplier on top of proximity.
			if g, ok := l.gains[s.id]; ok {
				gain *= g
			}
			if gain <= 0 {
				continue
			}
			if acc == nil {
				acc = make([]int32, voiceFrameSamples)
			}
			for i, v := range s.cur {
				acc[i] += int32(float64(v) * gain)
			}
		}
		if acc == nil {
			continue // nothing audible for this listener — send no frame
		}
		out := make([]int16, voiceFrameSamples)
		for i, v := range acc {
			out[i] = clip16(v)
		}
		l.send(websocket.MessageBinary, int16ToBytes(out))
	}
}

// ---------------------------------------------------------------------------
// Roster / activity broadcasts
// ---------------------------------------------------------------------------

type voiceRosterEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Muted bool   `json:"muted"`
}

func (room *voiceRoom) broadcastRoster() {
	room.mu.Lock()
	defer room.mu.Unlock()
	room.broadcastRosterLocked()
}

func (room *voiceRoom) broadcastRosterLocked() {
	entries := make([]voiceRosterEntry, 0, len(room.players))
	for _, p := range room.players {
		entries = append(entries, voiceRosterEntry{ID: p.id, Name: p.name, Muted: p.muted})
	}
	payload := mustJSON(map[string]any{"type": "roster", "players": entries})
	for _, p := range room.players {
		p.send(websocket.MessageText, payload)
	}
}

// broadcastActivityLocked tells clients who is currently speaking, but only when
// the set changes, to keep the control channel quiet.
func (room *voiceRoom) broadcastActivityLocked() {
	speaking := make([]string, 0, len(room.players))
	sig := ""
	for _, p := range room.players {
		if p.speaking {
			speaking = append(speaking, p.id)
			sig += p.id + ","
		}
	}
	if sig == room.lastAct {
		return
	}
	room.lastAct = sig
	payload := mustJSON(map[string]any{"type": "activity", "speaking": speaking})
	for _, p := range room.players {
		p.send(websocket.MessageText, payload)
	}
}

type voicePos struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

// broadcastPositionsLocked streams every player's world position so clients can
// render the avatars. Sent ~10x/sec; clients smooth the motion between updates.
func (room *voiceRoom) broadcastPositionsLocked() {
	if len(room.players) == 0 {
		return
	}
	positions := make([]voicePos, 0, len(room.players))
	for _, p := range room.players {
		positions = append(positions, voicePos{ID: p.id, X: p.x, Y: p.y})
	}
	payload := mustJSON(map[string]any{"type": "positions", "players": positions})
	for _, p := range room.players {
		p.send(websocket.MessageText, payload)
	}
}

// proximityGain returns listener l's volume for speaker s: a distance falloff
// (full volume within voiceFullRadius, smoothstep fade to zero at
// voiceSilenceRadius) gated by line of sight — if any wall lies on the straight
// line between the two, the result is multiplied by voiceOccludedGain so they
// only hear each other faintly through the wall. With a clear sightline (e.g.
// through a doorway) it's the full distance falloff.
func proximityGain(l, s *voicePlayer) float64 {
	dx := l.x - s.x
	dy := l.y - s.y
	d := math.Sqrt(dx*dx + dy*dy)

	var g float64
	switch {
	case d <= voiceFullRadius:
		g = 1.0
	case d >= voiceSilenceRadius:
		return 0.0
	default:
		t := (d - voiceFullRadius) / (voiceSilenceRadius - voiceFullRadius) // 0..1
		g = 1.0 - (t * t * (3 - 2*t))                                       // 1 -> 0, smoothstepped
	}

	if lineOfSightBlocked(l.x, l.y, s.x, s.y) {
		g *= voiceOccludedGain
	}
	return g
}

// lineOfSightBlocked reports whether any wall intersects the straight line
// between two points (walls at their true extent — the sightline is a thin ray,
// so a player standing in a doorway has a clear line through the gap).
func lineOfSightBlocked(x0, y0, x1, y1 float64) bool {
	for _, w := range voiceWalls {
		if segAABB(x0, y0, x1, y1, w.X, w.Y, w.X+w.W, w.Y+w.H) {
			return true
		}
	}
	return false
}

// segAABB reports whether segment (x0,y0)->(x1,y1) intersects the axis-aligned
// box [minx,maxx]x[miny,maxy] (Liang–Barsky slab clipping).
func segAABB(x0, y0, x1, y1, minx, miny, maxx, maxy float64) bool {
	dx, dy := x1-x0, y1-y0
	t0, t1 := 0.0, 1.0
	edges := [4][2]float64{{-dx, x0 - minx}, {dx, maxx - x0}, {-dy, y0 - miny}, {dy, maxy - y0}}
	for _, e := range edges {
		p, q := e[0], e[1]
		if p == 0 {
			if q < 0 {
				return false // parallel to this slab and outside it
			}
			continue
		}
		t := q / p
		if p < 0 {
			if t > t1 {
				return false
			}
			if t > t0 {
				t0 = t
			}
		} else {
			if t < t0 {
				return false
			}
			if t < t1 {
				t1 = t
			}
		}
	}
	return true
}

// voiceSpawn picks a random starting position, retrying until it's not inside a
// wall (with a center fallback if the room is somehow saturated).
func voiceSpawn() (float64, float64) {
	const m = 60.0
	for i := 0; i < 200; i++ {
		x := m + rand.Float64()*(voiceWorldW-2*m)
		y := m + rand.Float64()*(voiceWorldH-2*m)
		if !pointBlocked(x, y) {
			return x, y
		}
	}
	return voiceWorldW / 2, voiceWorldH / 2
}

// pointBlocked reports whether a player centered at (x,y) overlaps any wall. The
// walls are inflated by the player radius so the avatar circle can't clip in.
func pointBlocked(x, y float64) bool {
	const r = voicePlayerRadius
	for _, w := range voiceWalls {
		if x > w.X-r && x < w.X+w.W+r && y > w.Y-r && y < w.Y+w.H+r {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func bytesToInt16(b []byte) []int16 {
	out := make([]int16, len(b)/2)
	for i := range out {
		out[i] = int16(binary.LittleEndian.Uint16(b[2*i:]))
	}
	return out
}

func int16ToBytes(s []int16) []byte {
	b := make([]byte, len(s)*2)
	for i, v := range s {
		binary.LittleEndian.PutUint16(b[2*i:], uint16(v))
	}
	return b
}

// clip16 saturates a mixed (potentially out-of-range) sample to int16.
func clip16(v int32) int16 {
	if v > 32767 {
		return 32767
	}
	if v < -32768 {
		return -32768
	}
	return int16(v)
}

func drainFrames(ch chan []int16) {
	for {
		select {
		case <-ch:
		default:
			return
		}
	}
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		return []byte(fmt.Sprintf(`{"type":"error","message":%q}`, err.Error()))
	}
	return b
}
