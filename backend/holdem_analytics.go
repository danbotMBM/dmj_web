package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// recordHoldemEvent writes a holdem timeline event. Fire-and-forget: never
// blocks the caller (gameplay), never panics out.
func recordHoldemEvent(playerID, name, eventType, word string, score int) {
	if analyticsDB == nil || playerID == "" {
		return
	}
	ts := time.Now().Unix()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Fprintf(os.Stderr, "recordHoldemEvent panic: %v\n", r)
			}
		}()
		var wordVal, scoreVal interface{}
		if eventType == "word" {
			wordVal = word
			scoreVal = score
		}
		_, err := analyticsDB.Exec(
			`INSERT INTO holdem_events (ts, player_id, player_name, event_type, word, score)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			ts, playerID, name, eventType, wordVal, scoreVal,
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "holdem_events insert error: %v\n", err)
		}
	}()
}

type holdemTimelineEvent struct {
	TS    int64  `json:"ts"`
	Type  string `json:"type"`
	Word  string `json:"word,omitempty"`
	Score int    `json:"score,omitempty"`
}

type holdemTimelinePlayer struct {
	PlayerID string                `json:"player_id"`
	Name     string                `json:"name"`
	Events   []holdemTimelineEvent `json:"events"`
}

func handleHoldemTimeline(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := r.Header.Get("Authorization")
	token = strings.TrimPrefix(token, "Bearer ")
	if !validateToken(token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if analyticsDB == nil {
		http.Error(w, "Analytics DB unavailable", http.StatusInternalServerError)
		return
	}

	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 90 {
			days = v
		}
	}
	end := time.Now().Unix()
	start := end - int64(days)*86400

	rows, err := analyticsDB.Query(
		`SELECT ts, player_id, player_name, event_type, word, score
		 FROM holdem_events
		 WHERE ts >= ? AND ts <= ?
		 ORDER BY player_id, ts`,
		start, end,
	)
	if err != nil {
		http.Error(w, "Query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	byPlayer := map[string]*holdemTimelinePlayer{}
	totalWords := 0
	for rows.Next() {
		var ts int64
		var pid, pname, etype string
		var word sql.NullString
		var score sql.NullInt64
		if err := rows.Scan(&ts, &pid, &pname, &etype, &word, &score); err != nil {
			continue
		}
		p, ok := byPlayer[pid]
		if !ok {
			p = &holdemTimelinePlayer{PlayerID: pid, Name: pname}
			byPlayer[pid] = p
		}
		// Keep the most recent name we saw for this player.
		if pname != "" {
			p.Name = pname
		}
		ev := holdemTimelineEvent{TS: ts, Type: etype}
		if etype == "word" {
			if word.Valid {
				ev.Word = word.String
			}
			if score.Valid {
				ev.Score = int(score.Int64)
			}
			totalWords++
		}
		p.Events = append(p.Events, ev)
	}

	players := make([]*holdemTimelinePlayer, 0, len(byPlayer))
	for _, p := range byPlayer {
		players = append(players, p)
	}
	sort.Slice(players, func(i, j int) bool {
		if players[i].Name == players[j].Name {
			return players[i].PlayerID < players[j].PlayerID
		}
		return strings.ToLower(players[i].Name) < strings.ToLower(players[j].Name)
	})

	resp := map[string]interface{}{
		"window_start": start,
		"window_end":   end,
		"total_words":  totalWords,
		"players":      players,
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func registerHoldemAnalyticsRoutes() {
	http.HandleFunc("/holdem/admin/timeline", cors(handleHoldemTimeline))
	registerRoute("GET", "/holdem/admin/timeline", "Holdem player activity timeline (auth required)")
}
