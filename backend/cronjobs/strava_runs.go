package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	tokenURL      = "https://www.strava.com/oauth/token"
	activitiesURL = "https://www.strava.com/api/v3/athlete/activities"
	credsFile     = "stravacreds.txt"
	outputFile    = "strava_runs.json"
)

type Creds struct {
	ClientID     string
	ClientSecret string
	RefreshToken string
	AthleteID    string
	AccessToken  string
	ExpiresAt    int64
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
}

type Activity struct {
	ID                 int64   `json:"id"`
	Name               string  `json:"name"`
	Type               string  `json:"type"`
	SportType          string  `json:"sport_type"`
	Distance           float64 `json:"distance"`
	MovingTime         int     `json:"moving_time"`
	ElapsedTime        int     `json:"elapsed_time"`
	TotalElevationGain float64 `json:"total_elevation_gain"`
	StartDate          string  `json:"start_date"`
	StartDateLocal     string  `json:"start_date_local"`
	AverageSpeed       float64 `json:"average_speed"`
	MaxSpeed           float64 `json:"max_speed"`
	AverageHeartrate   float64 `json:"average_heartrate"`
	MaxHeartrate       float64 `json:"max_heartrate"`
	SufferScore        float64     `json:"suffer_score"`
}

type RunSummary struct {
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

func main() {
	creds, err := loadCreds(credsFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error loading credentials: %v\n", err)
		os.Exit(1)
	}

	accessToken, err := getAccessToken(&creds)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error getting access token: %v\n", err)
		os.Exit(1)
	}

	activities, err := fetchActivities(accessToken, 1, 100)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error fetching activities: %v\n", err)
		os.Exit(1)
	}

	runs := filterRuns(activities)
	summaries := summarizeRuns(runs)

	fmt.Printf("Found %d running activities out of %d total\n\n", len(summaries), len(activities))

	for _, r := range summaries {
		fmt.Printf("%-30s  %s  %.2f km  %s /km\n", r.Name, r.Date, r.DistanceKm, r.PaceMinPerKm)
	}

	if err := saveJSON(outputFile, summaries); err != nil {
		fmt.Fprintf(os.Stderr, "Error saving output: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("\nSaved %d runs to %s\n", len(summaries), outputFile)
}

func loadCreds(path string) (Creds, error) {
	f, err := os.Open(path)
	if err != nil {
		return Creds{}, fmt.Errorf("opening %s: %w", path, err)
	}
	defer f.Close()

	vals := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			vals[strings.TrimSpace(parts[0])] = strings.TrimSpace(parts[1])
		}
	}
	if err := scanner.Err(); err != nil {
		return Creds{}, fmt.Errorf("reading %s: %w", path, err)
	}

	expiresAt, _ := strconv.ParseInt(vals["expires_at"], 10, 64)
	c := Creds{
		ClientID:     vals["client_id"],
		ClientSecret: vals["client_secret"],
		RefreshToken: vals["refresh_token"],
		AthleteID:    vals["athlete_id"],
		AccessToken:  vals["access_token"],
		ExpiresAt:    expiresAt,
	}
	if c.ClientID == "" || c.ClientSecret == "" || c.RefreshToken == "" {
		return Creds{}, fmt.Errorf("stravacreds.txt must contain client_id, client_secret, and refresh_token")
	}
	return c, nil
}

func saveCreds(path string, creds *Creds) error {
	lines := []string{
		"client_id=" + creds.ClientID,
		"client_secret=" + creds.ClientSecret,
		"refresh_token=" + creds.RefreshToken,
		"athlete_id=" + creds.AthleteID,
		"access_token=" + creds.AccessToken,
		"expires_at=" + strconv.FormatInt(creds.ExpiresAt, 10),
		"",
	}
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0644)
}

func getAccessToken(creds *Creds) (string, error) {
	// Use cached access token if it hasn't expired yet (with 60s buffer)
	if creds.AccessToken != "" && time.Now().Unix() < creds.ExpiresAt-60 {
		fmt.Println("Using cached access token")
		return creds.AccessToken, nil
	}

	fmt.Println("Access token expired, refreshing...")
	data := url.Values{
		"client_id":     {creds.ClientID},
		"client_secret": {creds.ClientSecret},
		"refresh_token": {creds.RefreshToken},
		"grant_type":    {"refresh_token"},
	}

	resp, err := http.PostForm(tokenURL, data)
	if err != nil {
		return "", fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("reading token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("token request returned %d: %s", resp.StatusCode, string(body))
	}

	var tokenResp TokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("parsing token response: %w", err)
	}

	// Update creds with new tokens
	creds.AccessToken = tokenResp.AccessToken
	creds.ExpiresAt = tokenResp.ExpiresAt
	if tokenResp.RefreshToken != "" {
		creds.RefreshToken = tokenResp.RefreshToken
	}

	// Persist updated tokens to creds file
	if err := saveCreds(credsFile, creds); err != nil {
		return "", fmt.Errorf("saving updated credentials: %w", err)
	}

	return tokenResp.AccessToken, nil
}

func fetchActivities(accessToken string, page, perPage int) ([]Activity, error) {
	var all []Activity

	for {
		req, err := http.NewRequest("GET", activitiesURL, nil)
		if err != nil {
			return nil, fmt.Errorf("creating request: %w", err)
		}

		req.Header.Set("Authorization", "Bearer "+accessToken)
		q := req.URL.Query()
		q.Set("page", fmt.Sprintf("%d", page))
		q.Set("per_page", fmt.Sprintf("%d", perPage))
		req.URL.RawQuery = q.Encode()

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("fetching activities page %d: %w", page, err)
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("reading response body: %w", err)
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("activities request returned %d: %s", resp.StatusCode, string(body))
		}

    fmt.Printf("%s", body)
		var activities []Activity
		if err := json.Unmarshal(body, &activities); err != nil {
			return nil, fmt.Errorf("parsing activities: %w", err)
		}

		if len(activities) == 0 {
			break
		}

		all = append(all, activities...)
		page++
	}

	return all, nil
}

func filterRuns(activities []Activity) []Activity {
	var runs []Activity
	for _, a := range activities {
		if a.Type == "Run" || a.SportType == "Run" {
			runs = append(runs, a)
		}
	}
	return runs
}

func summarizeRuns(runs []Activity) []RunSummary {
	summaries := make([]RunSummary, 0, len(runs))
	for _, r := range runs {
		distKm := r.Distance / 1000.0
		distMiles := distKm * 0.621371
		movingMins := float64(r.MovingTime) / 60.0
		elapsedMins := float64(r.ElapsedTime) / 60.0

		paceSecsPerKm := 0.0
		if distKm > 0 {
			paceSecsPerKm = float64(r.MovingTime) / distKm
		}
		paceSecsPerMile := 0.0
		if distMiles > 0 {
			paceSecsPerMile = float64(r.MovingTime) / distMiles
		}

		summaries = append(summaries, RunSummary{
			ID:               r.ID,
			Name:             r.Name,
			Date:             r.StartDateLocal,
			DistanceKm:       round2(distKm),
			DistanceMiles:    round2(distMiles),
			MovingTimeMins:   round2(movingMins),
			ElapsedTimeMins:  round2(elapsedMins),
			ElevationGainM:   r.TotalElevationGain,
			PaceMinPerKm:     formatPace(paceSecsPerKm),
			PaceMinPerMile:   formatPace(paceSecsPerMile),
			AverageSpeedKmh:  round2(r.AverageSpeed * 3.6),
			AverageHeartrate: r.AverageHeartrate,
			MaxHeartrate:     r.MaxHeartrate,
		})
	}
	return summaries
}

func formatPace(totalSeconds float64) string {
	mins := int(totalSeconds) / 60
	secs := int(totalSeconds) % 60
	return fmt.Sprintf("%d:%02d", mins, secs)
}

func round2(v float64) float64 {
	return float64(int(v*100+0.5)) / 100
}

func saveJSON(path string, data interface{}) error {
	out, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling json: %w", err)
	}
	return os.WriteFile(path, out, 0644)
}
