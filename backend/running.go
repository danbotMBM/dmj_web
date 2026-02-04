package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
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
