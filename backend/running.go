package main

import (
	"io"
	"net/http"
	"os"
	"strings"
)

const runningFile = "running.txt"

func init() {
	// Ensure running file exists
	if _, err := os.Stat(runningFile); os.IsNotExist(err) {
		os.WriteFile(runningFile, []byte(""), 0644)
	}
}

func registerRunningRoutes() {
	http.HandleFunc("/running", handleRunning)
	registerRoute("GET", "/running", "Read running file (public)")
	registerRoute("POST", "/running", "Append to running file (auth required)")
}

func handleRunning(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getRunning(w, r)
	case http.MethodPost, http.MethodPut:
		postRunning(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getRunning(w http.ResponseWriter, r *http.Request) {
	fileMu.RLock()
	defer fileMu.RUnlock()

	data, err := os.ReadFile(runningFile)
	if err != nil {
		http.Error(w, "Failed to read data", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

func postRunning(w http.ResponseWriter, r *http.Request) {
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

	fileMu.Lock()
	defer fileMu.Unlock()

	f, err := os.OpenFile(runningFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
	if err != nil {
		http.Error(w, "Failed to open file", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	if _, err := f.Write(body); err != nil {
		http.Error(w, "Failed to write", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}
