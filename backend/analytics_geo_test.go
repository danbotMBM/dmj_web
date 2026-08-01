package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// openLegacyDB writes a database using the schema as it existed before the geo-tag
// columns were added, so the migration in initAnalyticsDB is exercised for real.
func openLegacyDB(t *testing.T) {
	t.Helper()
	t.Chdir(t.TempDir())

	db, err := sql.Open("sqlite", "trivia_analytics.db")
	if err != nil {
		t.Fatalf("open legacy db: %v", err)
	}
	_, err = db.Exec(`
		CREATE TABLE ip_geo_cache (
			ip_address TEXT PRIMARY KEY,
			country TEXT, region TEXT, city TEXT,
			lat REAL, lon REAL, isp TEXT, org TEXT, resolved_at TEXT
		);
		CREATE TABLE trivia_scores (
			trivia_date TEXT NOT NULL, player_id TEXT NOT NULL,
			score INTEGER NOT NULL, max_score INTEGER NOT NULL, completed_at TEXT NOT NULL,
			PRIMARY KEY (trivia_date, player_id)
		);`)
	if err != nil {
		t.Fatalf("create legacy schema: %v", err)
	}
	db.Close()

	initAnalyticsDB()
	if analyticsDB == nil {
		t.Fatal("initAnalyticsDB left analyticsDB nil")
	}
	t.Cleanup(func() {
		analyticsDB.Close()
		analyticsDB = nil
	})
}

// TestMigrationAddsGeoColumns checks that a database predating the geo columns gains
// them, and that rows written before country_code existed still read back cleanly.
func TestMigrationAddsGeoColumns(t *testing.T) {
	openLegacyDB(t)

	if _, err := analyticsDB.Exec(
		`INSERT INTO ip_geo_cache (ip_address, country, region, city) VALUES (?, ?, ?, ?)`,
		"8.8.8.8", "United States", "Virginia", "Ashburn",
	); err != nil {
		t.Fatalf("insert legacy geo row: %v", err)
	}
	if _, err := analyticsDB.Exec(
		`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at, ip_address)
		 VALUES ('2026-01-01', 'aaaaaaaaaaaaaaaa', 10, 10, '2026-01-01T00:00:00Z', '1.1.1.1')`,
	); err != nil {
		t.Fatalf("trivia_scores.ip_address missing after migration: %v", err)
	}

	// A legacy row has a NULL country_code; it must still be a cache hit, not a miss.
	geo := lookupGeoCached([]string{"8.8.8.8"})["8.8.8.8"]
	if geo == nil {
		t.Fatal("legacy geo row read back as a cache miss")
	}
	if geo.Country != "United States" || geo.Region != "Virginia" {
		t.Errorf("unexpected geo: %+v", geo)
	}
	if geo.CountryCode != "" {
		t.Errorf("country_code = %q, want empty for a legacy row", geo.CountryCode)
	}

	// Private and unknown addresses must never be reported as located.
	for _, ip := range []string{"127.0.0.1", "192.168.1.5", "", "203.0.113.9"} {
		if _, ok := lookupGeoCached([]string{ip})[ip]; ok {
			t.Errorf("lookupGeoCached unexpectedly returned a result for %q", ip)
		}
	}
}

func decodeResults(t *testing.T, date string) map[string]interface{} {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/trivia/results?date="+date, nil)
	rec := httptest.NewRecorder()
	handleTriviaResults(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatalf("decode results: %v", err)
	}
	return out
}

// TestLeaderboardGeoTags covers both ways a leaderboard entry gets a location: the IP
// stored with the score, and — for scores recorded before that column existed — the
// fallback to the last IP the board saw from that player.
func TestLeaderboardGeoTags(t *testing.T) {
	openLegacyDB(t)

	analyticsDB.Exec(`INSERT INTO ip_geo_cache (ip_address, country, country_code, region, city)
		VALUES ('1.1.1.1', 'United States', 'US', 'New York', 'Buffalo'),
		       ('2.2.2.2', 'Germany', 'DE', 'Bavaria', 'Munich')`)

	// Winner: IP recorded on the score itself.
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at, ip_address)
		VALUES ('2026-01-01', 'aaaaaaaaaaaaaaaa', 50, 60, '2026-01-01T01:00:00Z', '1.1.1.1')`)
	analyticsDB.Exec(`INSERT INTO player_names (player_id, name, updated_at)
		VALUES ('aaaaaaaaaaaaaaaa', 'Dan', '2026-01-01T00:00:00Z')`)

	// Runner-up: legacy score with no IP, but the board has an event from them.
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at)
		VALUES ('2026-01-01', 'bbbbbbbbbbbbbbbb', 30, 60, '2026-01-01T02:00:00Z')`)
	analyticsDB.Exec(`INSERT INTO trivia_events (event_type, timestamp, player_id, trivia_date, ip_address)
		VALUES ('grid_load', '2026-01-01T00:30:00Z', 'bbbbbbbbbbbbbbbb', '2026-01-01', '2.2.2.2')`)

	// Third: no IP anywhere — entry must still render, just without a geo tag.
	analyticsDB.Exec(`INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at)
		VALUES ('2026-01-01', 'cccccccccccccccc', 10, 60, '2026-01-01T03:00:00Z')`)

	top3, ok := decodeResults(t, "2026-01-01")["top3"].([]interface{})
	if !ok || len(top3) != 3 {
		t.Fatalf("top3 = %v, want 3 entries", top3)
	}

	want := []struct {
		name   string
		region string
		code   string
		hasGeo bool
	}{
		{"Dan", "New York", "US", true},
		{"Anonymous", "Bavaria", "DE", true},
		{"Anonymous", "", "", false},
	}
	for i, w := range want {
		entry := top3[i].(map[string]interface{})
		if entry["name"] != w.name {
			t.Errorf("entry %d name = %v, want %q", i, entry["name"], w.name)
		}
		geo, present := entry["geo"].(map[string]interface{})
		if present != w.hasGeo {
			t.Errorf("entry %d geo present = %v, want %v", i, present, w.hasGeo)
			continue
		}
		if !w.hasGeo {
			continue
		}
		if geo["region"] != w.region || geo["country_code"] != w.code {
			t.Errorf("entry %d geo = %v, want region %q code %q", i, geo, w.region, w.code)
		}
		// City, coordinates, ISP, and org stay off the public leaderboard.
		for _, field := range []string{"city", "lat", "lon", "isp", "org"} {
			if _, leaked := geo[field]; leaked {
				t.Errorf("entry %d leaked %s into the public payload: %v", i, field, geo)
			}
		}
	}
}
