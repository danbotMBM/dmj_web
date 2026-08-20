package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func vread(t *testing.T, c *websocket.Conn) signalMsg {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var m signalMsg
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return m
}

func vwrite(t *testing.T, c *websocket.Conn, m signalMsg) {
	t.Helper()
	b, _ := json.Marshal(m)
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestVoiceSignalingFlow(t *testing.T) {
	// Reset the global hub for a clean run.
	voice = &voiceHub{peers: make(map[string]*voicePeer)}

	srv := httptest.NewServer(http.HandlerFunc(voiceWS))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	dial := func() *websocket.Conn {
		c, _, err := websocket.Dial(context.Background(), wsURL, nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		return c
	}

	// Client A joins -> welcome with no peers.
	a := dial()
	defer a.CloseNow()
	vwrite(t, a, signalMsg{Type: "join", Name: "Alice"})
	wa := vread(t, a)
	if wa.Type != "welcome" || wa.Self == "" || len(wa.Peers) != 0 {
		t.Fatalf("A welcome wrong: %+v", wa)
	}

	// Client B joins -> welcome lists A; A gets peer-join for B.
	b := dial()
	defer b.CloseNow()
	vwrite(t, b, signalMsg{Type: "join", Name: "Bob"})
	wb := vread(t, b)
	if wb.Type != "welcome" || len(wb.Peers) != 1 || wb.Peers[0].Name != "Alice" {
		t.Fatalf("B welcome wrong: %+v", wb)
	}
	aJoin := vread(t, a)
	if aJoin.Type != "peer-join" || aJoin.Peer == nil || aJoin.Peer.Name != "Bob" {
		t.Fatalf("A peer-join wrong: %+v", aJoin)
	}

	// B relays a signal to A (using A's id from B's welcome).
	vwrite(t, b, signalMsg{Type: "signal", To: wb.Peers[0].ID, Data: json.RawMessage(`{"kind":"offer","sdp":"x"}`)})
	aSig := vread(t, a)
	if aSig.Type != "signal" || aSig.From != wb.Self || string(aSig.Data) != `{"kind":"offer","sdp":"x"}` {
		t.Fatalf("A signal wrong: %+v", aSig)
	}

	// B leaves -> A gets peer-leave.
	b.Close(websocket.StatusNormalClosure, "bye")
	aLeave := vread(t, a)
	if aLeave.Type != "peer-leave" || aLeave.ID != wb.Self {
		t.Fatalf("A peer-leave wrong: %+v", aLeave)
	}
}

func TestVoiceMoveAndProfileBroadcast(t *testing.T) {
	voice = &voiceHub{peers: make(map[string]*voicePeer)}
	srv := httptest.NewServer(http.HandlerFunc(voiceWS))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	dial := func() *websocket.Conn {
		c, _, err := websocket.Dial(context.Background(), wsURL, nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		return c
	}

	a := dial()
	defer a.CloseNow()
	vwrite(t, a, signalMsg{Type: "join", Name: "Alice", Color: "#ff0000", X: 10, Y: 20})
	wa := vread(t, a)
	if wa.Type != "welcome" {
		t.Fatalf("A welcome wrong: %+v", wa)
	}

	b := dial()
	defer b.CloseNow()
	vwrite(t, b, signalMsg{Type: "join", Name: "Bob", Color: "not-a-color"})
	wb := vread(t, b)
	if wb.Type != "welcome" || len(wb.Peers) != 1 {
		t.Fatalf("B welcome wrong: %+v", wb)
	}
	if wb.Peers[0].Color != "#ff0000" || wb.Peers[0].X != 10 || wb.Peers[0].Y != 20 {
		t.Fatalf("B welcome peer snapshot wrong: %+v", wb.Peers[0])
	}
	aJoin := vread(t, a)
	if aJoin.Type != "peer-join" || aJoin.Peer.Color != defaultVoiceColor {
		t.Fatalf("invalid color should fall back to default, got: %+v", aJoin.Peer)
	}

	// A moves -> B sees peer-move.
	vwrite(t, a, signalMsg{Type: "move", X: 55, Y: 66})
	bMove := vread(t, b)
	if bMove.Type != "peer-move" || bMove.ID != wa.Self || bMove.X != 55 || bMove.Y != 66 {
		t.Fatalf("B peer-move wrong: %+v", bMove)
	}

	// B renames/recolors -> A sees peer-profile.
	vwrite(t, b, signalMsg{Type: "profile", Name: "Bobby", Color: "#00ff00"})
	aProfile := vread(t, a)
	if aProfile.Type != "peer-profile" || aProfile.ID != wb.Self || aProfile.Name != "Bobby" || aProfile.Color != "#00ff00" {
		t.Fatalf("A peer-profile wrong: %+v", aProfile)
	}
}

func TestSanitizeVoiceColor(t *testing.T) {
	cases := map[string]string{
		"#ff00aa":                   "#ff00aa",
		"#FF00AA":                   "#FF00AA",
		"red":                       defaultVoiceColor,
		"":                          defaultVoiceColor,
		"#fff":                      defaultVoiceColor,
		"#ff00aa; background:url()": defaultVoiceColor,
	}
	for in, want := range cases {
		if got := sanitizeVoiceColor(in); got != want {
			t.Errorf("sanitizeVoiceColor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsValidVoiceToken(t *testing.T) {
	valid := []string{"abcdefgh", strings.Repeat("a", 64), "abc-DEF_123"}
	for _, v := range valid {
		if !isValidVoiceToken(v) {
			t.Errorf("expected %q to be valid", v)
		}
	}
	invalid := []string{"", "short", strings.Repeat("a", 65), "has spaces", "has/slash"}
	for _, v := range invalid {
		if isValidVoiceToken(v) {
			t.Errorf("expected %q to be invalid", v)
		}
	}
}

func TestVoiceRoomFull(t *testing.T) {
	voice = &voiceHub{peers: make(map[string]*voicePeer)}
	srv := httptest.NewServer(http.HandlerFunc(voiceWS))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	var conns []*websocket.Conn
	for i := 0; i < maxVoicePeers; i++ {
		c, _, err := websocket.Dial(context.Background(), wsURL, nil)
		if err != nil {
			t.Fatalf("dial %d: %v", i, err)
		}
		conns = append(conns, c)
		vwrite(t, c, signalMsg{Type: "join", Name: "P"})
		if m := vread(t, c); m.Type != "welcome" {
			t.Fatalf("peer %d expected welcome, got %+v", i, m)
		}
		// Drain any peer-join notices already queued to earlier peers so reads
		// don't block; not strictly necessary for the full-room assertion.
		c.SetReadLimit(1 << 16)
	}
	defer func() {
		for _, c := range conns {
			c.CloseNow()
		}
	}()

	// The 7th join must be rejected.
	over, _, err := websocket.Dial(context.Background(), wsURL, nil)
	if err != nil {
		t.Fatalf("dial overflow: %v", err)
	}
	defer over.CloseNow()
	vwrite(t, over, signalMsg{Type: "join", Name: "Late"})
	if m := vread(t, over); m.Type != "room-full" {
		t.Fatalf("expected room-full, got %+v", m)
	}
}
