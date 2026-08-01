package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	"unicode"
)

const triviaFile = "trivia_questions.json"

type TriviaAnswer struct {
	Valid []string `json:"valid"`
}

type TriviaQuestion struct {
	ID       string       `json:"id"`
	Category string       `json:"category"`
	Points   int          `json:"points"`
	Question string       `json:"question"`
	Answer   TriviaAnswer `json:"answer"`
	Display  string       `json:"display"`
}

type TriviaDay struct {
	Date       string           `json:"date"`
	Categories []string         `json:"categories"`
	Questions  []TriviaQuestion `json:"questions"`
}

type TriviaData struct {
	Days []TriviaDay `json:"days"`
}

var triviaData TriviaData

func init() {
	if _, err := os.Stat(triviaFile); os.IsNotExist(err) {
		os.WriteFile(triviaFile, []byte(`{"days":[]}`), 0644)
	}
}

func loadTriviaData() {
	data, err := os.ReadFile(triviaFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read trivia file: %v\n", err)
		return
	}
	if err := json.Unmarshal(data, &triviaData); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse trivia file: %v\n", err)
	}
	fmt.Printf("Loaded %d trivia days\n", len(triviaData.Days))
}

func getTriviaForDate(date string) *TriviaDay {
	// Try exact date match first
	for i := range triviaData.Days {
		if triviaData.Days[i].Date == date {
			return &triviaData.Days[i]
		}
	}

	// Fallback: deterministic pick using SHA-256 hash of date
	if len(triviaData.Days) == 0 {
		return nil
	}
	h := sha256.Sum256([]byte(date))
	idx := int(binary.BigEndian.Uint32(h[:4])) % len(triviaData.Days)
	return &triviaData.Days[idx]
}

// getTodayDate returns the current date in UTC+14 (Pacific/Kiritimati), the most
// forward timezone on Earth. A new day unlocks as soon as it begins anywhere in
// the world, preventing future-day grids from being served to any player.
func getTodayDate() string {
	loc, _ := time.LoadLocation("America/New_York")
	return time.Now().In(loc).Format("2006-01-02")
}

// isFutureDate returns true if the given YYYY-MM-DD date is strictly after today
// as observed in UTC+14 (the first timezone to tick over into a new day).
func isFutureDate(date string) bool {
	return date > getTodayDate()
}

func getTodayTrivia() *TriviaDay {
	return getTriviaForDate(getTodayDate())
}

func getRequestDate(r *http.Request) string {
	date := r.URL.Query().Get("date")
	if date != "" {
		return date
	}
	return getTodayDate()
}

// levenshtein computes the Levenshtein distance between two strings using single-row DP.
func levenshtein(a, b string) int {
	if len(a) == 0 {
		return len(b)
	}
	if len(b) == 0 {
		return len(a)
	}

	aRunes := []rune(a)
	bRunes := []rune(b)
	aLen := len(aRunes)
	bLen := len(bRunes)

	// Single-row DP
	row := make([]int, bLen+1)
	for j := 0; j <= bLen; j++ {
		row[j] = j
	}

	for i := 1; i <= aLen; i++ {
		prev := row[0]
		row[0] = i
		for j := 1; j <= bLen; j++ {
			old := row[j]
			cost := 1
			if aRunes[i-1] == bRunes[j-1] {
				cost = 0
			}
			ins := row[j] + 1
			del := row[j-1] + 1
			sub := prev + cost
			best := ins
			if del < best {
				best = del
			}
			if sub < best {
				best = sub
			}
			row[j] = best
			prev = old
		}
	}
	return row[bLen]
}

// normalizeAnswer lowercases, trims, strips leading articles and punctuation.
func normalizeAnswer(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	// Remove punctuation
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) {
			b.WriteRune(r)
		}
	}
	s = b.String()
	// Strip leading articles
	for _, article := range []string{"the ", "a ", "an "} {
		if strings.HasPrefix(s, article) {
			s = s[len(article):]
			break
		}
	}
	return strings.TrimSpace(s)
}

// checkAnswer returns true if the given answer is close enough to any valid answer.
func checkAnswer(input string, valid []string) bool {
	norm := normalizeAnswer(input)
	for _, v := range valid {
		target := normalizeAnswer(v)
		if norm == target {
			return true
		}
		dist := levenshtein(norm, target)
		maxDist := 1
		if len(target) > 12 {
			maxDist = 3
		} else if len(target) > 5 {
			maxDist = 2
		}
		if dist <= maxDist {
			return true
		}
	}
	return false
}

func findQuestion(day *TriviaDay, id string) *TriviaQuestion {
	for i := range day.Questions {
		if day.Questions[i].ID == id {
			return &day.Questions[i]
		}
	}
	return nil
}

func handleTriviaGrid(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	reqDate := getRequestDate(r)
	if isFutureDate(reqDate) {
		http.Error(w, "No trivia available", http.StatusNotFound)
		return
	}

	day := getTriviaForDate(reqDate)
	if day == nil {
		http.Error(w, "No trivia available", http.StatusNotFound)
		return
	}

	type questionStub struct {
		ID       string `json:"id"`
		Category string `json:"category"`
		Points   int    `json:"points"`
	}

	stubs := make([]questionStub, len(day.Questions))
	for i, q := range day.Questions {
		stubs[i] = questionStub{ID: q.ID, Category: q.Category, Points: q.Points}
	}

	resp := map[string]interface{}{
		"date":       day.Date,
		"categories": day.Categories,
		"questions":  stubs,
	}

	go trackEvent(r, "grid_load", day.Date, "", "", nil, nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleTriviaQuestion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/trivia/question/")
	if id == "" {
		http.Error(w, "Missing question ID", http.StatusBadRequest)
		return
	}

	reqDate := getRequestDate(r)
	if isFutureDate(reqDate) {
		http.Error(w, "No trivia available", http.StatusNotFound)
		return
	}

	day := getTriviaForDate(reqDate)
	if day == nil {
		http.Error(w, "No trivia available", http.StatusNotFound)
		return
	}

	q := findQuestion(day, id)
	if q == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
		return
	}

	resp := map[string]interface{}{
		"id":       q.ID,
		"category": q.Category,
		"points":   q.Points,
		"question": q.Question,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// attemptMu serializes the read-modify-write on trivia_attempts so two concurrent
// submissions from the same player can't double-count or race the completion lock.
var attemptMu sync.Mutex

// recordAnswer applies a server-validated answer to the player's attempt for the given
// board and returns the authoritative running totals. The score is derived entirely from
// server-side validation; the first completed attempt per (date, player) is locked into
// trivia_scores and never overwritten ("only the first submission counts"). The submitting
// connection's IP is stored with that score so the leaderboard can show a geo tag.
func recordAnswer(date, playerID, qid, ip string, correct bool, points, totalQuestions, maxScore int) {
	if analyticsDB == nil {
		return
	}

	attemptMu.Lock()
	defer attemptMu.Unlock()

	answered := map[string]bool{}
	var raw string
	var strikes, score, completed int
	err := analyticsDB.QueryRow(
		`SELECT answered, strikes, score, completed FROM trivia_attempts WHERE trivia_date=? AND player_id=?`,
		date, playerID,
	).Scan(&raw, &strikes, &score, &completed)
	if err == nil {
		json.Unmarshal([]byte(raw), &answered)
	}

	// Once complete, the attempt is final; re-answering a question is idempotent.
	if completed == 1 {
		return
	}
	if _, done := answered[qid]; done {
		return
	}

	answered[qid] = correct
	if correct {
		score += points
	} else {
		strikes++
	}
	gameOver := strikes >= 3 || len(answered) >= totalQuestions
	if gameOver {
		completed = 1
	}

	answeredJSON, _ := json.Marshal(answered)
	if _, err := analyticsDB.Exec(`
		INSERT INTO trivia_attempts (trivia_date, player_id, answered, strikes, score, completed)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(trivia_date, player_id) DO UPDATE SET
			answered=excluded.answered, strikes=excluded.strikes,
			score=excluded.score, completed=excluded.completed
	`, date, playerID, string(answeredJSON), strikes, score, completed); err != nil {
		fmt.Fprintf(os.Stderr, "trivia_attempts upsert error: %v\n", err)
	}

	if gameOver {
		res, err := analyticsDB.Exec(`
			INSERT INTO trivia_scores (trivia_date, player_id, score, max_score, completed_at, ip_address)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(trivia_date, player_id) DO NOTHING
		`, date, playerID, score, maxScore, time.Now().UTC().Format(time.RFC3339), ip)
		if err != nil {
			fmt.Fprintf(os.Stderr, "trivia_scores insert error: %v\n", err)
		} else if n, _ := res.RowsAffected(); n > 0 {
			// Resolve this connection's location now so the leaderboard, which reads
			// the geo cache only, has it ready without an outbound call on that path.
			warmGeoCache([]string{ip})

			// Genuine first completion for this player+board — announce it to Discord.
			var total, ahead int
			analyticsDB.QueryRow(`SELECT COUNT(*) FROM trivia_scores WHERE trivia_date=?`, date).Scan(&total)
			analyticsDB.QueryRow(`SELECT COUNT(*) FROM trivia_scores WHERE trivia_date=? AND score > ?`, date, score).Scan(&ahead)
			notifyBoardCompleted(date, getPlayerName(playerID), score, maxScore, ahead+1, total)
		}
	}
}

func handleTriviaAnswer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ID     string `json:"id"`
		Answer string `json:"answer"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	reqDate := getRequestDate(r)
	if isFutureDate(reqDate) {
		http.Error(w, "No trivia available", http.StatusNotFound)
		return
	}

	day := getTriviaForDate(reqDate)
	if day == nil {
		http.Error(w, "No trivia available", http.StatusNotFound)
		return
	}

	q := findQuestion(day, req.ID)
	if q == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
		return
	}

	correct := checkAnswer(req.Answer, q.Answer.Valid)

	// Server-authoritative scoring for the live daily board only. Past-board replays
	// (?date=) stay practice-only and are never recorded or ranked.
	if playerID := r.Header.Get("X-Player-ID"); isValidPlayerID(playerID) && reqDate == getTodayDate() {
		maxScore := 0
		for _, dq := range day.Questions {
			maxScore += dq.Points
		}
		recordAnswer(reqDate, playerID, q.ID, getClientIP(r), correct, q.Points, len(day.Questions), maxScore)
	}

	go trackEvent(r, "answer_submit", reqDate, req.ID, req.Answer, &correct, &q.Points)

	resp := map[string]interface{}{
		"correct": correct,
		"display": q.Display,
		"points":  q.Points,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleTriviaDays(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	today := getTodayDate()

	var dates []string
	for _, day := range triviaData.Days {
		if day.Date <= today {
			dates = append(dates, day.Date)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"dates": dates,
	})
}

func handleAdminQuestions(w http.ResponseWriter, r *http.Request) {
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

	date := r.URL.Query().Get("date")
	if date == "" {
		http.Error(w, "Missing date parameter", http.StatusBadRequest)
		return
	}

	day := getTriviaForDate(date)
	if day == nil {
		http.Error(w, "No trivia for that date", http.StatusNotFound)
		return
	}

	type adminQuestion struct {
		ID       string   `json:"id"`
		Category string   `json:"category"`
		Points   int      `json:"points"`
		Question string   `json:"question"`
		Display  string   `json:"display"`
		Valid    []string `json:"valid"`
	}

	questions := make([]adminQuestion, len(day.Questions))
	for i, q := range day.Questions {
		questions[i] = adminQuestion{
			ID:       q.ID,
			Category: q.Category,
			Points:   q.Points,
			Question: q.Question,
			Display:  q.Display,
			Valid:    q.Answer.Valid,
		}
	}

	resp := map[string]interface{}{
		"date":       day.Date,
		"categories": day.Categories,
		"questions":  questions,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleAdminUpdateAnswers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	token := r.Header.Get("Authorization")
	token = strings.TrimPrefix(token, "Bearer ")
	if !validateToken(token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		Date       string   `json:"date"`
		QuestionID string   `json:"question_id"`
		Valid      []string `json:"valid"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Date == "" || req.QuestionID == "" {
		http.Error(w, "Missing date or question_id", http.StatusBadRequest)
		return
	}
	if len(req.Valid) == 0 {
		http.Error(w, "Valid answers list cannot be empty", http.StatusBadRequest)
		return
	}

	// Find the day in the actual data (not the hashed fallback)
	var day *TriviaDay
	for i := range triviaData.Days {
		if triviaData.Days[i].Date == req.Date {
			day = &triviaData.Days[i]
			break
		}
	}
	if day == nil {
		http.Error(w, "No trivia day with that exact date", http.StatusNotFound)
		return
	}

	q := findQuestion(day, req.QuestionID)
	if q == nil {
		http.Error(w, "Question not found", http.StatusNotFound)
		return
	}

	// Update in memory
	q.Answer.Valid = req.Valid

	// Persist to disk
	data, err := json.MarshalIndent(triviaData, "", "  ")
	if err != nil {
		http.Error(w, "Failed to serialize trivia data", http.StatusInternalServerError)
		return
	}
	if err := os.WriteFile(triviaFile, data, 0644); err != nil {
		http.Error(w, "Failed to write trivia file", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"ok":    true,
		"valid": q.Answer.Valid,
	})
}

func registerTriviaRoutes() {
	loadTriviaData()

	http.HandleFunc("/trivia/days", cors(handleTriviaDays))
	registerRoute("GET", "/trivia/days", "List past trivia dates (public)")

	http.HandleFunc("/trivia/grid", cors(handleTriviaGrid))
	registerRoute("GET", "/trivia/grid", "Get trivia grid, optional ?date= param (public)")

	http.HandleFunc("/trivia/question/", cors(handleTriviaQuestion))
	registerRoute("GET", "/trivia/question/{id}", "Get trivia question text (public)")

	http.HandleFunc("/trivia/answer", cors(handleTriviaAnswer))
	registerRoute("POST", "/trivia/answer", "Submit trivia answer (public)")

	http.HandleFunc("/trivia/admin/questions", cors(handleAdminQuestions))
	registerRoute("GET", "/trivia/admin/questions", "Get questions with valid answers (auth required)")

	http.HandleFunc("/trivia/admin/answers", cors(handleAdminUpdateAnswers))
	registerRoute("PUT", "/trivia/admin/answers", "Update valid answers for a question (auth required)")
}
