package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func decodeScoreboard(t *testing.T, date, playerID string) map[string]interface{} {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/trivia/scoreboard?date="+date, nil)
	if playerID != "" {
		req.Header.Set("X-Player-ID", playerID)
	}
	rec := httptest.NewRecorder()
	handleTriviaScoreboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode scoreboard: %v", err)
	}
	return out
}

// TestScoreboardListsEveryPlayer checks that the scoreboard returns every score for the
// day (not just a top 3), high to low, tagging the caller's own row and carrying geo.
func TestScoreboardListsEveryPlayer(t *testing.T) {
	openLegacyDB(t)

	analyticsDB.Exec(`INSERT INTO ip_geo_cache (ip_address, country, country_code, region, city)
		VALUES ('1.1.1.1', 'United States', 'US', 'New York', 'Buffalo')`)

	// Four players today — one more than the top-3 leaderboard would ever show.
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at, ip_address)
		VALUES ('2026-01-01', 'aaaaaaaaaaaaaaaa', 50, 60, '2026-01-01T01:00:00Z', '1.1.1.1')`)
	analyticsDB.Exec(`INSERT INTO player_names (player_id, name, updated_at)
		VALUES ('aaaaaaaaaaaaaaaa', 'Dan', '2026-01-01T00:00:00Z')`)
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at)
		VALUES ('2026-01-01', 'bbbbbbbbbbbbbbbb', 40, 60, '2026-01-01T02:00:00Z')`)
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at)
		VALUES ('2026-01-01', 'cccccccccccccccc', 30, 60, '2026-01-01T03:00:00Z')`)
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at)
		VALUES ('2026-01-01', 'dddddddddddddddd', 10, 60, '2026-01-01T04:00:00Z')`)

	// Ask as player "cccc" so we can confirm the "me" flag lands on the right row.
	out := decodeScoreboard(t, "2026-01-01", "cccccccccccccccc")

	if total, _ := out["total_players"].(float64); int(total) != 4 {
		t.Errorf("total_players = %v, want 4", out["total_players"])
	}
	entries, ok := out["entries"].([]interface{})
	if !ok || len(entries) != 4 {
		t.Fatalf("entries = %v, want 4", out["entries"])
	}

	wantScores := []int{50, 40, 30, 10}
	for i, e := range entries {
		entry := e.(map[string]interface{})
		if got := int(entry["score"].(float64)); got != wantScores[i] {
			t.Errorf("entry %d score = %d, want %d", i, got, wantScores[i])
		}
		isMe, _ := entry["me"].(bool)
		if wantMe := i == 2; isMe != wantMe {
			t.Errorf("entry %d me = %v, want %v", i, isMe, wantMe)
		}
	}

	// Top entry carries the geo tag; city/coordinates/isp/org never leak.
	geo, present := entries[0].(map[string]interface{})["geo"].(map[string]interface{})
	if !present {
		t.Fatal("top entry missing geo tag")
	}
	if geo["region"] != "New York" || geo["country_code"] != "US" {
		t.Errorf("top geo = %v, want New York/US", geo)
	}
	for _, field := range []string{"city", "lat", "lon", "isp", "org"} {
		if _, leaked := geo[field]; leaked {
			t.Errorf("leaked %s into public payload: %v", field, geo)
		}
	}
}
