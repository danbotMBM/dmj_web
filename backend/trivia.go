package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
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

func getTodayDate() string {
	loc, _ := time.LoadLocation("America/New_York")
	return time.Now().In(loc).Format("2006-01-02")
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

	day := getTriviaForDate(getRequestDate(r))
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

	day := getTriviaForDate(getRequestDate(r))
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

	day := getTriviaForDate(getRequestDate(r))
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

	go trackEvent(r, "answer_submit", getRequestDate(r), req.ID, req.Answer, &correct, &q.Points)

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

	loc, _ := time.LoadLocation("America/New_York")
	today := time.Now().In(loc).Format("2006-01-02")

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
}
