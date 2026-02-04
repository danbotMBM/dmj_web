package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	usersFile   = "users.txt"
	dataFile    = "data.txt"
	secretFile  = "secret.txt"
	tokenExpiry = 24 * time.Hour
)

var (
	secret     []byte
	fileMu     sync.RWMutex
	corsOrigin string
)

func main() {
	// Load or generate secret for token signing
	loadSecret()

	// Load CORS origin from env (default: dev)
	corsOrigin = os.Getenv("CORS_ORIGIN")
	if corsOrigin == "" {
		corsOrigin = "https://danbotlab"
	}
	fmt.Printf("CORS origin: %s\n", corsOrigin)

	// Ensure data file exists
	if _, err := os.Stat(dataFile); os.IsNotExist(err) {
		os.WriteFile(dataFile, []byte(""), 0644)
	}

	http.HandleFunc("/data", cors(handleData))
	registerRoute("GET", "/data", "Read data file (public)")
	registerRoute("POST", "/data", "Append to data file (auth required)")

	http.HandleFunc("/login", cors(handleLogin))
	registerRoute("POST", "/login", "Get auth token")

	registerRunningRoutes()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8900"
	}

	fmt.Printf("Server starting on :%s\n", port)
	printRoutes()

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
		os.Exit(1)
	}
}

func loadSecret() {
	data, err := os.ReadFile(secretFile)
	if err != nil {
		// Generate a simple secret if file doesn't exist
		secret = []byte("change-me-to-something-random")
		os.WriteFile(secretFile, secret, 0600)
		fmt.Println("Warning: Generated default secret. Edit secret.txt for production.")
		return
	}
	secret = []byte(strings.TrimSpace(string(data)))
}

// cors wraps a handler with CORS headers
func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

// handleData serves GET (public) and POST (authenticated) for the data file
func handleData(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		getData(w, r)
	case http.MethodPost, http.MethodPut:
		postData(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// getData returns the contents of data.txt (public)
func getData(w http.ResponseWriter, r *http.Request) {
	fileMu.RLock()
	defer fileMu.RUnlock()

	data, err := os.ReadFile(dataFile)
	if err != nil {
		http.Error(w, "Failed to read data", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

// postData appends to data.txt (requires auth)
func postData(w http.ResponseWriter, r *http.Request) {
	// Check authorization
	token := r.Header.Get("Authorization")
	token = strings.TrimPrefix(token, "Bearer ")

	if !validateToken(token) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// Read body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read body", http.StatusBadRequest)
		return
	}

	fileMu.Lock()
	defer fileMu.Unlock()

	// Append to file
	f, err := os.OpenFile(dataFile, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0644)
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

// handleLogin authenticates and returns a token
func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if !checkCredentials(creds.Username, creds.Password) {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	token := generateToken(creds.Username)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token": token,
	})
}

// checkCredentials validates username:password against users.txt
// Format: username:password (one per line)
func checkCredentials(username, password string) bool {
	f, err := os.Open(usersFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot open users file: %v\n", err)
		return false
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}

		if parts[0] == username && parts[1] == password {
			return true
		}
	}

	return false
}

// generateToken creates a simple signed token
// Format: username:expiry:signature (hex encoded)
func generateToken(username string) string {
	expiry := time.Now().Add(tokenExpiry).Unix()
	data := fmt.Sprintf("%s:%d", username, expiry)

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(data))
	sig := hex.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("%s:%s", data, sig)
}

// validateToken checks if token is valid and not expired
func validateToken(token string) bool {
	parts := strings.Split(token, ":")
	if len(parts) != 3 {
		return false
	}

	data := parts[0] + ":" + parts[1]
	providedSig := parts[2]

	// Verify signature
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(data))
	expectedSig := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(providedSig), []byte(expectedSig)) {
		return false
	}

	// Check expiry
	var username string
	var expiry int64
	if _, err := fmt.Sscanf(data, "%s:%d", &username, &expiry); err != nil {
		// Try manual parsing
		idx := strings.LastIndex(data, ":")
		if idx == -1 {
			return false
		}
		if _, err := fmt.Sscanf(data[idx+1:], "%d", &expiry); err != nil {
			return false
		}
	}

	return time.Now().Unix() < expiry
}
