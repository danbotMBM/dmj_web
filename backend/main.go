package main

import (
	"bufio"
	"crypto/hmac"
	"crypto/rand"
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

	"golang.org/x/crypto/bcrypt"
)

const (
	usersFile   = "users.txt"
	dataFile    = "data.txt"
	secretFile  = "secret.txt"
	tokenExpiry = 24 * time.Hour

	// Login rate limiting (per client IP).
	loginMaxFails = 5
	loginWindow   = 15 * time.Minute
	loginLockout  = 15 * time.Minute
)

var (
	secret     []byte
	fileMu     sync.RWMutex
	corsOrigin string

	// dummyBcryptHash is compared against when a username is unknown (or the
	// store is unreadable) so that response timing doesn't reveal whether a
	// username exists. Initialized in init().
	dummyBcryptHash []byte
)

func init() {
	// A valid bcrypt hash so CompareHashAndPassword does real work (constant-ish
	// time) on the unknown-user path rather than failing to parse instantly.
	dummyBcryptHash, _ = bcrypt.GenerateFromPassword([]byte("constant-time-dummy"), bcrypt.DefaultCost)
}

// secretFilePath returns the signing-secret path, overridable via SECRET_FILE so
// the secret can live outside the web root in production.
func secretFilePath() string {
	if p := os.Getenv("SECRET_FILE"); p != "" {
		return p
	}
	return secretFile
}

// usersFilePath returns the credentials file path, overridable via USERS_FILE so
// it can live outside the web root in production.
func usersFilePath() string {
	if p := os.Getenv("USERS_FILE"); p != "" {
		return p
	}
	return usersFile
}

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
	registerPhotosRoutes()
	registerTriviaRoutes()
	registerHoldemRoutes()
	registerVoiceRoutes()
	initAnalyticsDB()
	registerAnalyticsRoutes()
	registerHoldemAnalyticsRoutes()

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
	path := secretFilePath()

	if data, err := os.ReadFile(path); err == nil {
		if s := strings.TrimSpace(string(data)); s != "" {
			secret = []byte(s)
			return
		}
	}

	// No usable secret on disk: generate a strong random one (never a known
	// constant — a predictable key would let anyone forge auth tokens).
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		fmt.Fprintf(os.Stderr, "FATAL: cannot generate a signing secret: %v\n", err)
		os.Exit(1)
	}
	secret = []byte(hex.EncodeToString(buf))

	if err := os.WriteFile(path, secret, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Warning: generated a random signing secret but could not persist it to %s: %v (tokens will be invalidated on restart)\n", path, err)
	} else {
		fmt.Printf("Generated a new random signing secret at %s\n", path)
	}
}

// cors wraps a handler with CORS headers
func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", corsOrigin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Player-ID")

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

	// Throttle brute-force attempts per client IP.
	ip := getClientIP(r)
	if ok, retryAfter := loginAllowed(ip); !ok {
		w.Header().Set("Retry-After", fmt.Sprintf("%d", retryAfter))
		http.Error(w, "Too many login attempts, try again later", http.StatusTooManyRequests)
		return
	}

	var creds struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}

	// Cap the body so a huge payload can't be used to exhaust memory.
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&creds); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if !checkCredentials(creds.Username, creds.Password) {
		loginFailed(ip)
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	loginSucceeded(ip)
	token := generateToken(creds.Username)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"token": token,
	})
}

// checkCredentials validates a username/password against the users file.
// Format: one `username:bcrypt_hash` per line. Plaintext passwords are rejected
// (use the hashpw tool to generate hashes).
func checkCredentials(username, password string) bool {
	f, err := os.Open(usersFilePath())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot open users file: %v\n", err)
		// Burn comparable time so a missing store isn't distinguishable by timing.
		bcrypt.CompareHashAndPassword(dummyBcryptHash, []byte(password))
		return false
	}
	defer f.Close()

	var storedHash string
	found := false
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
		if parts[0] == username {
			storedHash = parts[1]
			found = true
			break
		}
	}

	if !found {
		// Compare against a dummy hash so unknown users take similar time.
		bcrypt.CompareHashAndPassword(dummyBcryptHash, []byte(password))
		return false
	}

	if !strings.HasPrefix(storedHash, "$2") {
		fmt.Fprintf(os.Stderr, "User %q has a non-bcrypt password in the users file; refusing. Regenerate it with the hashpw tool.\n", username)
		bcrypt.CompareHashAndPassword(dummyBcryptHash, []byte(password))
		return false
	}

	return bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(password)) == nil
}

// --- Login rate limiting (per client IP) ---

type loginAttempt struct {
	fails       int
	windowStart time.Time
	lockedUntil time.Time
}

var (
	loginMu       sync.Mutex
	loginAttempts = map[string]*loginAttempt{}
)

// loginAllowed reports whether the IP may attempt a login now. If not, it also
// returns the number of seconds to wait.
func loginAllowed(ip string) (bool, int) {
	loginMu.Lock()
	defer loginMu.Unlock()
	a := loginAttempts[ip]
	if a == nil {
		return true, 0
	}
	if now := time.Now(); now.Before(a.lockedUntil) {
		return false, int(time.Until(a.lockedUntil).Seconds()) + 1
	}
	return true, 0
}

// loginFailed records a failed attempt for the IP and locks it out once the
// failure threshold is reached within the window.
func loginFailed(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	now := time.Now()
	a := loginAttempts[ip]
	if a == nil || now.Sub(a.windowStart) > loginWindow {
		a = &loginAttempt{windowStart: now}
		loginAttempts[ip] = a
	}
	a.fails++
	if a.fails >= loginMaxFails {
		a.lockedUntil = now.Add(loginLockout)
	}
	// Opportunistic cleanup so the map can't grow without bound.
	if len(loginAttempts) > 10000 {
		for k, v := range loginAttempts {
			if now.After(v.lockedUntil) && now.Sub(v.windowStart) > loginWindow {
				delete(loginAttempts, k)
			}
		}
	}
}

// loginSucceeded clears any failure state for the IP after a successful login.
func loginSucceeded(ip string) {
	loginMu.Lock()
	defer loginMu.Unlock()
	delete(loginAttempts, ip)
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
