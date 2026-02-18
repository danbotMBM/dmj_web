package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var analyticsDB *sql.DB

func initAnalyticsDB() {
	var err error
	analyticsDB, err = sql.Open("sqlite", "trivia_analytics.db")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open analytics DB: %v\n", err)
		return
	}

	analyticsDB.Exec("PRAGMA journal_mode=WAL")
	analyticsDB.Exec("PRAGMA busy_timeout=5000")

	schema := `CREATE TABLE IF NOT EXISTS trivia_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		event_type TEXT NOT NULL,
		timestamp TEXT NOT NULL,
		player_id TEXT,
		trivia_date TEXT,
		question_id TEXT,
		answer_text TEXT,
		correct INTEGER,
		points INTEGER,
		ip_address TEXT,
		user_agent TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_trivia_date ON trivia_events(trivia_date);
	CREATE INDEX IF NOT EXISTS idx_player_id ON trivia_events(player_id);
	CREATE INDEX IF NOT EXISTS idx_event_type ON trivia_events(event_type);
	CREATE INDEX IF NOT EXISTS idx_timestamp ON trivia_events(timestamp);`

	if _, err := analyticsDB.Exec(schema); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create analytics schema: %v\n", err)
		return
	}

	fmt.Println("Analytics DB initialized")
}

func getClientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		return strings.SplitN(fwd, ",", 2)[0]
	}
	return strings.SplitN(r.RemoteAddr, ":", 2)[0]
}

func trackEvent(r *http.Request, eventType, triviaDate, questionID, answerText string, correct *bool, points *int) {
	if analyticsDB == nil {
		return
	}

	playerID := r.Header.Get("X-Player-ID")
	ip := getClientIP(r)
	ua := r.Header.Get("User-Agent")
	ts := time.Now().UTC().Format(time.RFC3339)

	go func() {
		var correctVal, pointsVal interface{}
		if correct != nil {
			if *correct {
				correctVal = 1
			} else {
				correctVal = 0
			}
		}
		if points != nil {
			pointsVal = *points
		}

		_, err := analyticsDB.Exec(
			`INSERT INTO trivia_events (event_type, timestamp, player_id, trivia_date, question_id, answer_text, correct, points, ip_address, user_agent)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			eventType, ts, playerID, triviaDate, questionID, answerText, correctVal, pointsVal, ip, ua,
		)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Analytics insert error: %v\n", err)
		}
	}()
}

func handleTriviaStats(w http.ResponseWriter, r *http.Request) {
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

	var totalLoads, totalAnswers, uniquePlayers int
	var minDate, maxDate sql.NullString

	analyticsDB.QueryRow(`SELECT COUNT(*) FROM trivia_events WHERE event_type='grid_load'`).Scan(&totalLoads)
	analyticsDB.QueryRow(`SELECT COUNT(*) FROM trivia_events WHERE event_type='answer_submit'`).Scan(&totalAnswers)
	analyticsDB.QueryRow(`SELECT COUNT(DISTINCT player_id) FROM trivia_events WHERE player_id != ''`).Scan(&uniquePlayers)
	analyticsDB.QueryRow(`SELECT MIN(trivia_date), MAX(trivia_date) FROM trivia_events`).Scan(&minDate, &maxDate)

	rows, err := analyticsDB.Query(`
		SELECT
			trivia_date,
			SUM(CASE WHEN event_type='grid_load' THEN 1 ELSE 0 END) as grid_loads,
			COUNT(DISTINCT CASE WHEN event_type='grid_load' THEN player_id END) as unique_players,
			SUM(CASE WHEN event_type='answer_submit' THEN 1 ELSE 0 END) as total_answers,
			SUM(CASE WHEN event_type='answer_submit' AND correct=1 THEN 1 ELSE 0 END) as correct_answers
		FROM trivia_events
		WHERE trivia_date != ''
		GROUP BY trivia_date
		ORDER BY trivia_date DESC
	`)
	if err != nil {
		http.Error(w, "Query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type dailyStats struct {
		Date           string  `json:"date"`
		GridLoads      int     `json:"grid_loads"`
		UniquePlayers  int     `json:"unique_players"`
		TotalAnswers   int     `json:"total_answers"`
		CorrectAnswers int     `json:"correct_answers"`
		CorrectPct     float64 `json:"correct_pct"`
	}

	var daily []dailyStats
	for rows.Next() {
		var d dailyStats
		rows.Scan(&d.Date, &d.GridLoads, &d.UniquePlayers, &d.TotalAnswers, &d.CorrectAnswers)
		if d.TotalAnswers > 0 {
			d.CorrectPct = float64(d.CorrectAnswers) / float64(d.TotalAnswers) * 100
		}
		daily = append(daily, d)
	}

	resp := map[string]interface{}{
		"total_loads":    totalLoads,
		"total_answers":  totalAnswers,
		"unique_players": uniquePlayers,
		"min_date":       minDate.String,
		"max_date":       maxDate.String,
		"daily":          daily,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func handleTriviaStatsDate(w http.ResponseWriter, r *http.Request) {
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

	date := strings.TrimPrefix(r.URL.Path, "/trivia/stats/")
	if date == "" {
		http.Error(w, "Missing date", http.StatusBadRequest)
		return
	}

	// Per-question accuracy
	type questionStats struct {
		QuestionID       string   `json:"question_id"`
		Category         string   `json:"category"`
		Question         string   `json:"question"`
		Points           int      `json:"points"`
		DisplayAnswer    string   `json:"display_answer"`
		TotalAttempts    int      `json:"total_attempts"`
		CorrectCount     int      `json:"correct_count"`
		CorrectPct       float64  `json:"correct_pct"`
		FirstAttemptPct  float64  `json:"first_attempt_correct_pct"`
		TopWrongAnswers  []string `json:"top_wrong_answers"`
	}

	// Look up the trivia day for question metadata
	day := getTriviaForDate(date)

	qRows, err := analyticsDB.Query(`
		SELECT question_id,
			COUNT(*) as total,
			SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END) as correct_count
		FROM trivia_events
		WHERE event_type='answer_submit' AND trivia_date=?
		GROUP BY question_id
	`, date)
	if err != nil {
		http.Error(w, "Query error", http.StatusInternalServerError)
		return
	}
	defer qRows.Close()

	var questions []questionStats
	for qRows.Next() {
		var qs questionStats
		qRows.Scan(&qs.QuestionID, &qs.TotalAttempts, &qs.CorrectCount)
		if qs.TotalAttempts > 0 {
			qs.CorrectPct = float64(qs.CorrectCount) / float64(qs.TotalAttempts) * 100
		}
		if day != nil {
			if q := findQuestion(day, qs.QuestionID); q != nil {
				qs.Category = q.Category
				qs.Question = q.Question
				qs.Points = q.Points
				qs.DisplayAnswer = q.Display
			}
		}
		questions = append(questions, qs)
	}

	// First-attempt accuracy and top wrong answers per question
	for i := range questions {
		qid := questions[i].QuestionID

		// First attempt per player using window function
		var firstCorrect, firstTotal int
		analyticsDB.QueryRow(`
			SELECT COUNT(*), SUM(CASE WHEN correct=1 THEN 1 ELSE 0 END)
			FROM (
				SELECT correct, ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY timestamp) as rn
				FROM trivia_events
				WHERE event_type='answer_submit' AND trivia_date=? AND question_id=? AND player_id != ''
			) WHERE rn=1
		`, date, qid).Scan(&firstTotal, &firstCorrect)

		if firstTotal > 0 {
			questions[i].FirstAttemptPct = float64(firstCorrect) / float64(firstTotal) * 100
		}

		// Top 3 wrong answers
		wrongRows, err := analyticsDB.Query(`
			SELECT answer_text, COUNT(*) as cnt
			FROM trivia_events
			WHERE event_type='answer_submit' AND trivia_date=? AND question_id=? AND correct=0 AND answer_text != ''
			GROUP BY answer_text
			ORDER BY cnt DESC
			LIMIT 3
		`, date, qid)
		if err == nil {
			defer wrongRows.Close()
			for wrongRows.Next() {
				var ans string
				var cnt int
				wrongRows.Scan(&ans, &cnt)
				questions[i].TopWrongAnswers = append(questions[i].TopWrongAnswers, ans)
			}
		}
	}

	// Device breakdown (simple UA check)
	var mobile, desktop int
	devRows, err := analyticsDB.Query(`
		SELECT user_agent FROM trivia_events WHERE trivia_date=? AND user_agent != ''
	`, date)
	if err == nil {
		defer devRows.Close()
		for devRows.Next() {
			var ua string
			devRows.Scan(&ua)
			uaLower := strings.ToLower(ua)
			if strings.Contains(uaLower, "mobile") || strings.Contains(uaLower, "android") || strings.Contains(uaLower, "iphone") {
				mobile++
			} else {
				desktop++
			}
		}
	}

	// Hourly activity
	type hourlyBucket struct {
		Hour  int `json:"hour"`
		Count int `json:"count"`
	}

	hourRows, err := analyticsDB.Query(`
		SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as cnt
		FROM trivia_events
		WHERE trivia_date=?
		GROUP BY hour
		ORDER BY hour
	`, date)

	var hourly []hourlyBucket
	if err == nil {
		defer hourRows.Close()
		for hourRows.Next() {
			var h hourlyBucket
			hourRows.Scan(&h.Hour, &h.Count)
			hourly = append(hourly, h)
		}
	}

	// Average score across unique players
	type playerInfo struct {
		score int
		loads int
	}
	playerMap := make(map[string]*playerInfo)

	// Scores per player
	scoreRows, err := analyticsDB.Query(`
		SELECT player_id, SUM(CASE WHEN correct=1 THEN points ELSE 0 END) as score
		FROM trivia_events
		WHERE event_type='answer_submit' AND trivia_date=? AND player_id != ''
		GROUP BY player_id
	`, date)
	if err == nil {
		defer scoreRows.Close()
		for scoreRows.Next() {
			var pid string
			var score int
			scoreRows.Scan(&pid, &score)
			playerMap[pid] = &playerInfo{score: score}
		}
	}

	// Grid loads per player (to detect retries)
	loadRows, err := analyticsDB.Query(`
		SELECT player_id, COUNT(*) as loads
		FROM trivia_events
		WHERE event_type='grid_load' AND trivia_date=? AND player_id != ''
		GROUP BY player_id
	`, date)
	if err == nil {
		defer loadRows.Close()
		for loadRows.Next() {
			var pid string
			var loads int
			loadRows.Scan(&pid, &loads)
			if p, ok := playerMap[pid]; ok {
				p.loads = loads
			} else {
				playerMap[pid] = &playerInfo{loads: loads}
			}
		}
	}

	var avgScore float64
	var totalPlayers, retryPlayers int
	if len(playerMap) > 0 {
		totalScore := 0
		for _, p := range playerMap {
			totalPlayers++
			totalScore += p.score
			if p.loads > 1 {
				retryPlayers++
			}
		}
		avgScore = float64(totalScore) / float64(totalPlayers)
	}

	// Max possible score from trivia data
	var maxScore int
	if day != nil {
		for _, q := range day.Questions {
			maxScore += q.Points
		}
	}

	resp := map[string]interface{}{
		"date":      date,
		"questions": questions,
		"devices": map[string]int{
			"mobile":  mobile,
			"desktop": desktop,
		},
		"hourly":         hourly,
		"avg_score":      avgScore,
		"max_score":      maxScore,
		"total_players":  totalPlayers,
		"retry_players":  retryPlayers,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func registerAnalyticsRoutes() {
	http.HandleFunc("/trivia/stats", cors(handleTriviaStats))
	registerRoute("GET", "/trivia/stats", "Trivia analytics overview (auth required)")

	http.HandleFunc("/trivia/stats/", cors(handleTriviaStatsDate))
	registerRoute("GET", "/trivia/stats/{date}", "Trivia analytics for date (auth required)")
}
