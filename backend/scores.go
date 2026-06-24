package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode"
)

// bannedWords is an intentionally small, simple profanity list. It is not a comprehensive
// filter — just a basic guard so obviously offensive display names are rejected.
var bannedWords = []string{
	"fuck", "shit", "bitch", "cunt", "nigger", "nigga", "faggot", "slut",
	"whore", "rape", "dick", "pussy", "cock", "asshole", "retard",
}

// isProfane reports whether name contains a banned word. It lowercases and strips
// non-letters first so simple obfuscations (spaces, punctuation) are still caught.
func isProfane(name string) bool {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		if unicode.IsLetter(r) {
			b.WriteRune(r)
		}
	}
	stripped := b.String()
	for _, w := range bannedWords {
		if strings.Contains(stripped, w) {
			return true
		}
	}
	return false
}

// getPlayerName returns the stored display name for a player, or "" if none is set.
func getPlayerName(playerID string) string {
	if analyticsDB == nil {
		return ""
	}
	var name string
	err := analyticsDB.QueryRow(`SELECT name FROM player_names WHERE player_id=?`, playerID).Scan(&name)
	if err != nil {
		return ""
	}
	return name
}

func handleTriviaName(w http.ResponseWriter, r *http.Request) {
	playerID := r.Header.Get("X-Player-ID")
	if !isValidPlayerID(playerID) {
		http.Error(w, "Invalid player_id", http.StatusBadRequest)
		return
	}

	switch r.Method {
	case http.MethodGet:
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"name": getPlayerName(playerID)})

	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "Invalid JSON", http.StatusBadRequest)
			return
		}

		name := strings.TrimSpace(body.Name)
		if name == "" || len([]rune(name)) > 20 {
			writeJSONError(w, "Name must be 1–20 characters.", http.StatusBadRequest)
			return
		}
		for _, c := range name {
			if !unicode.IsPrint(c) {
				writeJSONError(w, "Name contains invalid characters.", http.StatusBadRequest)
				return
			}
		}
		if isProfane(name) {
			writeJSONError(w, "That name isn't allowed.", http.StatusBadRequest)
			return
		}

		if analyticsDB == nil {
			http.Error(w, "DB unavailable", http.StatusInternalServerError)
			return
		}
		_, err := analyticsDB.Exec(`
			INSERT INTO player_names (player_id, name, updated_at)
			VALUES (?, ?, ?)
			ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
		`, playerID, name, time.Now().UTC().Format(time.RFC3339))
		if err != nil {
			http.Error(w, "DB error", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"name": name})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func writeJSONError(w http.ResponseWriter, msg string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

type leaderEntry struct {
	Name  string `json:"name"`
	Score int    `json:"score"`
}

// handleTriviaResults returns the leaderboard for a board: the top 3 scores (by name only,
// never player IDs), the total number of recorded players, and — if the requesting player
// has a recorded score — their own score and overall rank.
func handleTriviaResults(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if analyticsDB == nil {
		http.Error(w, "DB unavailable", http.StatusInternalServerError)
		return
	}

	date := r.URL.Query().Get("date")
	if date == "" {
		date = getTodayDate()
	}
	playerID := r.Header.Get("X-Player-ID")

	maxScore := 0
	if day := getTriviaForDate(date); day != nil {
		for _, q := range day.Questions {
			maxScore += q.Points
		}
	}

	// Top 3 — names only, never player IDs. Earlier completion breaks score ties.
	top3 := []leaderEntry{}
	rows, err := analyticsDB.Query(`
		SELECT s.score, COALESCE(n.name, 'Anonymous')
		FROM trivia_scores s
		LEFT JOIN player_names n ON s.player_id = n.player_id
		WHERE s.trivia_date = ?
		ORDER BY s.score DESC, s.completed_at ASC
		LIMIT 3
	`, date)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var e leaderEntry
			if err := rows.Scan(&e.Score, &e.Name); err == nil {
				top3 = append(top3, e)
			}
		}
	}

	var total int
	analyticsDB.QueryRow(`SELECT COUNT(*) FROM trivia_scores WHERE trivia_date=?`, date).Scan(&total)

	resp := map[string]interface{}{
		"max_score":     maxScore,
		"total_players": total,
		"top3":          top3,
		"name":          getPlayerName(playerID),
		"score":         nil,
		"rank":          nil,
	}

	// The requesting player's own score + rank, if recorded.
	if isValidPlayerID(playerID) {
		var myScore int
		err := analyticsDB.QueryRow(
			`SELECT score FROM trivia_scores WHERE trivia_date=? AND player_id=?`,
			date, playerID,
		).Scan(&myScore)
		if err == nil {
			var ahead int
			analyticsDB.QueryRow(
				`SELECT COUNT(*) FROM trivia_scores WHERE trivia_date=? AND score > ?`,
				date, myScore,
			).Scan(&ahead)
			resp["score"] = myScore
			resp["rank"] = ahead + 1
		} else if err != sql.ErrNoRows {
			http.Error(w, "DB error", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func registerScoreRoutes() {
	http.HandleFunc("/trivia/name", cors(handleTriviaName))
	registerRoute("GET", "/trivia/name", "Get the requesting player's display name (X-Player-ID)")
	registerRoute("POST", "/trivia/name", "Set the requesting player's display name (X-Player-ID)")

	http.HandleFunc("/trivia/results", cors(handleTriviaResults))
	registerRoute("GET", "/trivia/results", "Leaderboard: top 3, total players, and caller's rank (names only)")
}
