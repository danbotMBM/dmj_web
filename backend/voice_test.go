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
