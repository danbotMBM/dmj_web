package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
)

const photosFile = "photos.json"

func registerPhotosRoutes() {
	http.HandleFunc("/photos", cors(handlePhotos))
	registerRoute("GET", "/photos", "Read photo list with focal points (public)")
	registerRoute("PUT", "/photos", "Replace photo list (auth required)")
}

func handlePhotos(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getPhotos(w, r)
	case http.MethodPost, http.MethodPut:
		putPhotos(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func getPhotos(w http.ResponseWriter, r *http.Request) {
	fileMu.RLock()
	defer fileMu.RUnlock()

	data, err := os.ReadFile(photosFile)
	if err != nil {
		// Return empty array if file doesn't exist
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func putPhotos(w http.ResponseWriter, r *http.Request) {
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

	// Validate JSON is an array of objects. Keep each element as raw bytes so
	// re-indenting below preserves the original field order (filename first).
	var js []json.RawMessage
	if err := json.Unmarshal(body, &js); err != nil {
		http.Error(w, "Invalid JSON (expected array)", http.StatusBadRequest)
		return
	}
	for _, el := range js {
		var obj map[string]interface{}
		if err := json.Unmarshal(el, &obj); err != nil {
			http.Error(w, "Invalid JSON (expected array of objects)", http.StatusBadRequest)
			return
		}
	}

	// Re-indent so the on-disk file stays human-readable.
	pretty, err := json.MarshalIndent(js, "", "  ")
	if err != nil {
		http.Error(w, "Failed to format", http.StatusInternalServerError)
		return
	}
	pretty = append(pretty, '\n')

	fileMu.Lock()
	defer fileMu.Unlock()

	if err := os.WriteFile(photosFile, pretty, 0644); err != nil {
		http.Error(w, "Failed to write", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok"}`))
}
