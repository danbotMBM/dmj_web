package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const runningFile = "running.json"

func init() {
	// Ensure running file exists with empty JSON object
	if _, err := os.Stat(runningFile); os.IsNotExist(err) {
		os.WriteFile(runningFile, []byte("{}"), 0644)
	}
}

func registerRunningRoutes() {
	http.HandleFunc("/running", cors(handleRunning))
	registerRoute("GET", "/running", "Read running state (public)")
	registerRoute("PUT", "/running", "Update running state (auth required)")

	http.HandleFunc("/strava-runs", cors(handleStravaRuns))
	registerRoute("GET", "/strava-runs", "Get Strava runs for Feb & Apr 2026 (public)")
}

func handleRunning(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getRunning(w, r)
	case http.MethodPost, http.MethodPut:
		putRunning(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getRunning(w http.ResponseWriter, r *http.Request) {
	fileMu.RLock()
	defer fileMu.RUnlock()

	data, err := os.ReadFile(runningFile)
	if err != nil {
		// Return empty object if file doesn't exist
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{}"))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func putRunning(w http.ResponseWriter, r *http.Request) {
	token := r.Header.Get("Authorization")
	token = strings.TrimPrefix(token, "Bearer ")

	if !validateToken(token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	// Validate JSON
	var js map[string]interface{}
	if err := json.Unmarshal(body, &js); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	fileMu.Lock()
	defer fileMu.Unlock()

	if err := os.WriteFile(runningFile, body, 0644); err != nil {
		http.Error(w, "Failed to write", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}

type stravaRun struct {
	ID               int64   `json:"id"`
	Name             string  `json:"name"`
	Date             string  `json:"date"`
	DistanceKm       float64 `json:"distance_km"`
	DistanceMiles    float64 `json:"distance_miles"`
	MovingTimeMins   float64 `json:"moving_time_mins"`
	ElapsedTimeMins  float64 `json:"elapsed_time_mins"`
	ElevationGainM   float64 `json:"elevation_gain_m"`
	PaceMinPerKm     string  `json:"pace_min_per_km"`
	PaceMinPerMile   string  `json:"pace_min_per_mile"`
	AverageSpeedKmh  float64 `json:"average_speed_kmh"`
	AverageHeartrate float64 `json:"average_heartrate,omitempty"`
	MaxHeartrate     float64 `json:"max_heartrate,omitempty"`
}

func handleStravaRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	fileMu.RLock()
	data, err := os.ReadFile("cronjobs/strava_runs.json")
	fileMu.RUnlock()

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}

	var allRuns []stravaRun
	if err := json.Unmarshal(data, &allRuns); err != nil {
		http.Error(w, "Failed to parse strava data", http.StatusInternalServerError)
		return
	}

	var filtered []stravaRun
	for _, run := range allRuns {
		t, err := time.Parse(time.RFC3339, run.Date)
		if err != nil {
			continue
		}
		if t.Year() == 2026 && (t.Month() == time.February || t.Month() == time.March || t.Month() == time.April) {
			filtered = append(filtered, run)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(filtered)
}
