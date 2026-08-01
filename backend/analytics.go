package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
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
	CREATE INDEX IF NOT EXISTS idx_timestamp ON trivia_events(timestamp);
	CREATE TABLE IF NOT EXISTS ip_geo_cache (
		ip_address TEXT PRIMARY KEY,
		country TEXT,
		country_code TEXT,
		region TEXT,
		city TEXT,
		lat REAL,
		lon REAL,
		isp TEXT,
		org TEXT,
		resolved_at TEXT
	);
	CREATE TABLE IF NOT EXISTS player_stats (
		player_id TEXT PRIMARY KEY,
		history TEXT NOT NULL,
		last_updated TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS holdem_events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ts INTEGER NOT NULL,
		player_id TEXT NOT NULL,
		player_name TEXT NOT NULL,
		event_type TEXT NOT NULL,
		word TEXT,
		score INTEGER
	);
	CREATE INDEX IF NOT EXISTS idx_holdem_events_ts ON holdem_events(ts);
	CREATE INDEX IF NOT EXISTS idx_holdem_events_player ON holdem_events(player_id);
	CREATE TABLE IF NOT EXISTS trivia_attempts (
		trivia_date TEXT NOT NULL,
		player_id   TEXT NOT NULL,
		answered    TEXT NOT NULL,
		strikes     INTEGER NOT NULL,
		score       INTEGER NOT NULL,
		completed   INTEGER NOT NULL DEFAULT 0,
		PRIMARY KEY (trivia_date, player_id)
	);
	CREATE TABLE IF NOT EXISTS trivia_scores (
		trivia_date  TEXT NOT NULL,
		player_id    TEXT NOT NULL,
		score        INTEGER NOT NULL,
		max_score    INTEGER NOT NULL,
		completed_at TEXT NOT NULL,
		ip_address   TEXT,
		PRIMARY KEY (trivia_date, player_id)
	);
	CREATE TABLE IF NOT EXISTS player_names (
		player_id  TEXT PRIMARY KEY,
		name       TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_trivia_scores_date ON trivia_scores(trivia_date, score DESC);`

	if _, err := analyticsDB.Exec(schema); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create analytics schema: %v\n", err)
		return
	}

	// Columns added after the original schema shipped; CREATE TABLE IF NOT EXISTS
	// leaves pre-existing tables untouched, so they need an explicit ALTER.
	addColumnIfMissing("ip_geo_cache", "country_code", "TEXT")
	addColumnIfMissing("trivia_scores", "ip_address", "TEXT")

	fmt.Println("Analytics DB initialized")
}

// addColumnIfMissing adds a column to an existing table. SQLite has no
// "ADD COLUMN IF NOT EXISTS", so the duplicate-column error is the expected
// (and harmless) result on databases that already have it.
func addColumnIfMissing(table, column, decl string) {
	_, err := analyticsDB.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, decl))
	if err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		fmt.Fprintf(os.Stderr, "Failed to add %s.%s: %v\n", table, column, err)
	}
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
		QuestionID      string   `json:"question_id"`
		Category        string   `json:"category"`
		Question        string   `json:"question"`
		Points          int      `json:"points"`
		DisplayAnswer   string   `json:"display_answer"`
		TotalAttempts   int      `json:"total_attempts"`
		CorrectCount    int      `json:"correct_count"`
		CorrectPct      float64  `json:"correct_pct"`
		FirstAttemptPct float64  `json:"first_attempt_correct_pct"`
		TopWrongAnswers []string `json:"top_wrong_answers"`
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
		"hourly":        hourly,
		"avg_score":     avgScore,
		"max_score":     maxScore,
		"total_players": totalPlayers,
		"retry_players": retryPlayers,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

type geoInfo struct {
	Country     string  `json:"country"`
	CountryCode string  `json:"country_code"`
	Region      string  `json:"region"`
	City        string  `json:"city"`
	Lat         float64 `json:"lat"`
	Lon         float64 `json:"lon"`
	ISP         string  `json:"isp"`
	Org         string  `json:"org"`
}

// isPrivateIP reports whether an address is loopback or RFC1918 and therefore
// pointless (and unresolvable) to send to a geo lookup service.
func isPrivateIP(ip string) bool {
	return strings.HasPrefix(ip, "127.") || strings.HasPrefix(ip, "10.") ||
		strings.HasPrefix(ip, "192.168.") || strings.HasPrefix(ip, "172.") ||
		ip == "::1" || ip == "localhost"
}

// COALESCE guards rows written before country_code existed, which would
// otherwise fail to scan into a string and look like a cache miss.
const geoCacheSelect = `SELECT COALESCE(country,''), COALESCE(country_code,''), COALESCE(region,''),
	COALESCE(city,''), COALESCE(lat,0), COALESCE(lon,0), COALESCE(isp,''), COALESCE(org,'')
	FROM ip_geo_cache WHERE ip_address = ?`

// lookupGeoCached returns geo data for the given IPs from the local cache only.
// It never calls out to ip-api.com, so it is safe to use on public request paths.
func lookupGeoCached(ips []string) map[string]*geoInfo {
	result := make(map[string]*geoInfo)
	if analyticsDB == nil {
		return result
	}
	for _, ip := range ips {
		if ip == "" || isPrivateIP(ip) {
			continue
		}
		if _, done := result[ip]; done {
			continue
		}
		var geo geoInfo
		err := analyticsDB.QueryRow(geoCacheSelect, ip).Scan(
			&geo.Country, &geo.CountryCode, &geo.Region, &geo.City,
			&geo.Lat, &geo.Lon, &geo.ISP, &geo.Org,
		)
		if err == nil {
			result[ip] = &geo
		}
	}
	return result
}

// resolveGeoIPs looks up geo data for the given IPs, using the cache first
// and batch-resolving any misses via ip-api.com.
func resolveGeoIPs(ips []string) map[string]*geoInfo {
	result := lookupGeoCached(ips)

	var uncached []string
	queued := map[string]bool{}
	for _, ip := range ips {
		if ip == "" || isPrivateIP(ip) || queued[ip] {
			continue
		}
		if _, cached := result[ip]; cached {
			continue
		}
		queued[ip] = true
		uncached = append(uncached, ip)
	}

	if len(uncached) == 0 {
		return result
	}

	// Batch resolve uncached IPs via ip-api.com (max 100 per request)
	type batchQuery struct {
		Query  string `json:"query"`
		Fields string `json:"fields"`
	}
	for i := 0; i < len(uncached); i += 100 {
		end := i + 100
		if end > len(uncached) {
			end = len(uncached)
		}
		chunk := uncached[i:end]

		var batch []batchQuery
		for _, ip := range chunk {
			batch = append(batch, batchQuery{
				Query:  ip,
				Fields: "query,country,countryCode,regionName,city,lat,lon,isp,org,status",
			})
		}

		body, err := json.Marshal(batch)
		if err != nil {
			fmt.Fprintf(os.Stderr, "GeoIP marshal error: %v\n", err)
			continue
		}

		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Post("http://ip-api.com/batch", "application/json", bytes.NewReader(body))
		if err != nil {
			fmt.Fprintf(os.Stderr, "GeoIP lookup error: %v\n", err)
			continue
		}

		var results []struct {
			Status      string  `json:"status"`
			Query       string  `json:"query"`
			Country     string  `json:"country"`
			CountryCode string  `json:"countryCode"`
			RegionName  string  `json:"regionName"`
			City        string  `json:"city"`
			Lat         float64 `json:"lat"`
			Lon         float64 `json:"lon"`
			ISP         string  `json:"isp"`
			Org         string  `json:"org"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&results); err != nil {
			fmt.Fprintf(os.Stderr, "GeoIP decode error: %v\n", err)
			resp.Body.Close()
			continue
		}
		resp.Body.Close()

		now := time.Now().UTC().Format(time.RFC3339)
		for _, r := range results {
			if r.Status != "success" {
				continue
			}
			geo := &geoInfo{
				Country:     r.Country,
				CountryCode: r.CountryCode,
				Region:      r.RegionName,
				City:        r.City,
				Lat:         r.Lat,
				Lon:         r.Lon,
				ISP:         r.ISP,
				Org:         r.Org,
			}
			result[r.Query] = geo

			// Cache in DB
			analyticsDB.Exec(
				`INSERT OR REPLACE INTO ip_geo_cache (ip_address, country, country_code, region, city, lat, lon, isp, org, resolved_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				r.Query, geo.Country, geo.CountryCode, geo.Region, geo.City, geo.Lat, geo.Lon, geo.ISP, geo.Org, now,
			)
		}
	}

	return result
}

// geoWarmCooldown bounds how often a single unresolved IP may be re-sent to ip-api.com.
const geoWarmCooldown = time.Hour

var (
	geoWarmMu sync.Mutex
	geoWarmAt = map[string]time.Time{}
)

// warmGeoCache resolves any of the given IPs that aren't cached yet, in the background.
// Public request paths read the cache only, so this is what eventually fills it — throttled
// per IP so an address ip-api.com can't resolve doesn't turn every page load into an
// outbound request.
func warmGeoCache(ips []string) {
	if analyticsDB == nil || len(ips) == 0 {
		return
	}
	cached := lookupGeoCached(ips)
	now := time.Now()

	geoWarmMu.Lock()
	if len(geoWarmAt) > 1000 {
		for ip, at := range geoWarmAt {
			if now.Sub(at) >= geoWarmCooldown {
				delete(geoWarmAt, ip)
			}
		}
	}
	var pending []string
	for _, ip := range ips {
		if ip == "" || isPrivateIP(ip) {
			continue
		}
		if _, ok := cached[ip]; ok {
			continue
		}
		if last, ok := geoWarmAt[ip]; ok && now.Sub(last) < geoWarmCooldown {
			continue
		}
		geoWarmAt[ip] = now
		pending = append(pending, ip)
	}
	geoWarmMu.Unlock()

	if len(pending) > 0 {
		go resolveGeoIPs(pending)
	}
}

func handleTriviaStatsIPs(w http.ResponseWriter, r *http.Request) {
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

	dateFilter := r.URL.Query().Get("date")

	query := `
		SELECT ip_address,
			COUNT(*) as total_events,
			MIN(timestamp) as first_seen,
			MAX(timestamp) as last_seen,
			COUNT(DISTINCT trivia_date) as days_active,
			COUNT(DISTINCT player_id) as player_ids_used
		FROM trivia_events
		WHERE ip_address != ''`
	var args []interface{}
	if dateFilter != "" {
		query += ` AND trivia_date = ?`
		args = append(args, dateFilter)
	}
	query += `
		GROUP BY ip_address
		ORDER BY total_events DESC`

	rows, err := analyticsDB.Query(query, args...)
	if err != nil {
		http.Error(w, "Query error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type ipStats struct {
		IP            string   `json:"ip"`
		TotalEvents   int      `json:"total_events"`
		FirstSeen     string   `json:"first_seen"`
		LastSeen      string   `json:"last_seen"`
		DaysActive    int      `json:"days_active"`
		PlayerIDsUsed int      `json:"player_ids_used"`
		Geo           *geoInfo `json:"geo"`
	}

	var ips []ipStats
	var ipAddrs []string
	totalEvents := 0
	for rows.Next() {
		var ip ipStats
		rows.Scan(&ip.IP, &ip.TotalEvents, &ip.FirstSeen, &ip.LastSeen, &ip.DaysActive, &ip.PlayerIDsUsed)
		totalEvents += ip.TotalEvents
		ipAddrs = append(ipAddrs, ip.IP)
		ips = append(ips, ip)
	}

	// Resolve geo data for all IPs
	geoMap := resolveGeoIPs(ipAddrs)
	for i := range ips {
		ips[i].Geo = geoMap[ips[i].IP]
	}

	resp := map[string]interface{}{
		"total_unique_ips": len(ips),
		"total_events":     totalEvents,
		"ips":              ips,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func isValidPlayerID(id string) bool {
	if len(id) != 16 {
		return false
	}
	for _, c := range id {
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

type playerStatsRecord struct {
	PlayerID    string          `json:"player_id"`
	History     json.RawMessage `json:"history"`
	LastUpdated string          `json:"last_updated"`
}

func handlePlayerStatsUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		PlayerID    string          `json:"player_id"`
		History     json.RawMessage `json:"history"`
		LastUpdated string          `json:"last_updated"`
	}

	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if !isValidPlayerID(body.PlayerID) {
		http.Error(w, "Invalid player_id", http.StatusBadRequest)
		return
	}

	if len(body.History) == 0 || body.LastUpdated == "" {
		http.Error(w, "Missing fields", http.StatusBadRequest)
		return
	}

	if body.History[0] != '[' {
		http.Error(w, "History must be a JSON array", http.StatusBadRequest)
		return
	}

	_, err := analyticsDB.Exec(`
		INSERT INTO player_stats (player_id, history, last_updated)
		VALUES (?, ?, ?)
		ON CONFLICT(player_id) DO UPDATE SET
			history = excluded.history,
			last_updated = excluded.last_updated
	`, body.PlayerID, string(body.History), body.LastUpdated)

	if err != nil {
		fmt.Fprintf(os.Stderr, "player_stats insert error: %v\n", err)
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func handlePlayerStatsGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := strings.TrimPrefix(r.URL.Path, "/trivia/player-stats/")
	if !isValidPlayerID(id) {
		http.Error(w, "Invalid player_id", http.StatusBadRequest)
		return
	}

	var historyStr, lastUpdated string
	err := analyticsDB.QueryRow(`
		SELECT history, last_updated FROM player_stats WHERE player_id = ?
	`, id).Scan(&historyStr, &lastUpdated)

	if err == sql.ErrNoRows {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "DB error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(playerStatsRecord{
		PlayerID:    id,
		History:     json.RawMessage(historyStr),
		LastUpdated: lastUpdated,
	})
}

func registerAnalyticsRoutes() {
	http.HandleFunc("/trivia/stats/ips", cors(handleTriviaStatsIPs))
	registerRoute("GET", "/trivia/stats/ips", "Trivia IP address analytics with geo data (auth required)")

	http.HandleFunc("/trivia/stats", cors(handleTriviaStats))
	registerRoute("GET", "/trivia/stats", "Trivia analytics overview (auth required)")

	http.HandleFunc("/trivia/stats/", cors(handleTriviaStatsDate))
	registerRoute("GET", "/trivia/stats/{date}", "Trivia analytics for date (auth required)")

	http.HandleFunc("/trivia/player-stats", cors(handlePlayerStatsUpload))
	registerRoute("POST", "/trivia/player-stats", "Upload/overwrite player stats by ID")

	http.HandleFunc("/trivia/player-stats/", cors(handlePlayerStatsGet))
	registerRoute("GET", "/trivia/player-stats/{id}", "Fetch player stats by ID")
}
