package main

// MCP (Model Context Protocol) server for danbot lab.
//
// Exposes a read-only view of the site's public content over Streamable HTTP at
// /mcp so AI assistants (Claude custom connectors, MCP clients, agents) can
// search and read the blogs, project catalog, photos, and running data. All
// data served here is already public on the website; there are no mutating
// tools and nothing here touches the private trivia answers, analytics, users,
// or secret files.
//
// Data sources:
//   - content-index.json  : built by Eleventy (generators/content-index.11ty.js),
//                            holds every content page + the curated project cards.
//   - photos.json         : photo metadata (reused from photos.go).
//   - running.json        : training calendar (reused from running.go).
//   - cronjobs/strava_runs.json : recent runs (stravaRun type from running.go).
//   - race_results_all.json     : half-marathon field results.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// --- config -----------------------------------------------------------------

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func contentIndexPath() string { return envOr("CONTENT_INDEX", "../_site/content-index.json") }
func raceResultsPath() string {
	return envOr("RACE_RESULTS_FILE", "../blogs/race_results/race_results_all.json")
}
func raceRunnerName() string { return envOr("RACE_RUNNER_NAME", "Daniel Jones") }
func stravaRunsPath() string { return envOr("STRAVA_RUNS_FILE", "cronjobs/strava_runs.json") }

// --- content index (blogs, about, landing pages, project catalog) -----------

type indexPage struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Section     string `json:"section"`
	Text        string `json:"text"`
}

type indexProject struct {
	Title    string   `json:"title"`
	Href     string   `json:"href"`
	Blurb    string   `json:"blurb"`
	Sections []string `json:"sections"`
}

type contentIndex struct {
	Site      string         `json:"site"`
	Generated string         `json:"generated"`
	Pages     []indexPage    `json:"pages"`
	Projects  []indexProject `json:"projects"`
}

var (
	ciMu      sync.Mutex
	ciCache   *contentIndex
	ciModTime time.Time
)

// loadContentIndex reads content-index.json, caching it and reloading only when
// the file's mtime changes (so a site rebuild is picked up without a restart).
func loadContentIndex() (*contentIndex, error) {
	path := contentIndexPath()
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("content index not found at %s (run the eleventy build): %w", path, err)
	}

	ciMu.Lock()
	defer ciMu.Unlock()
	if ciCache != nil && info.ModTime().Equal(ciModTime) {
		return ciCache, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var idx contentIndex
	if err := json.Unmarshal(data, &idx); err != nil {
		return nil, fmt.Errorf("content index is not valid JSON: %w", err)
	}
	ciCache = &idx
	ciModTime = info.ModTime()
	return ciCache, nil
}

// --- small text helpers -----------------------------------------------------

// snippet returns a short window of text around the first matching term, so
// search results carry context without shipping the whole page.
func snippet(text string, terms []string, width int) string {
	lower := strings.ToLower(text)
	idx := -1
	for _, t := range terms {
		if i := strings.Index(lower, t); i >= 0 && (idx == -1 || i < idx) {
			idx = i
		}
	}
	if idx == -1 {
		if len(text) > width {
			return strings.TrimSpace(text[:width]) + "…"
		}
		return text
	}
	start := idx - width/2
	if start < 0 {
		start = 0
	}
	end := start + width
	if end > len(text) {
		end = len(text)
	}
	out := strings.TrimSpace(text[start:end])
	if start > 0 {
		out = "…" + out
	}
	if end < len(text) {
		out = out + "…"
	}
	return out
}

// countMatches sums occurrences of every term in haystack (already lowercased).
func countMatches(haystack string, terms []string) int {
	n := 0
	for _, t := range terms {
		n += strings.Count(haystack, t)
	}
	return n
}

func queryTerms(q string) []string {
	var terms []string
	for _, f := range strings.Fields(strings.ToLower(q)) {
		if len(f) >= 2 {
			terms = append(terms, f)
		}
	}
	return terms
}

// --- tool: search_content ---------------------------------------------------

type searchContentIn struct {
	Query   string `json:"query" jsonschema:"words to search for across blogs, pages, and projects"`
	Section string `json:"section,omitempty" jsonschema:"optional filter: blog, about, home, game, photos"`
}

type searchHit struct {
	Kind    string `json:"kind"` // "page" or "project"
	URL     string `json:"url"`
	Title   string `json:"title"`
	Section string `json:"section,omitempty"`
	Snippet string `json:"snippet"`
	Score   int    `json:"score"`
}

type searchContentOut struct {
	Query string      `json:"query"`
	Count int         `json:"count"`
	Hits  []searchHit `json:"hits"`
}

func searchContent(ctx context.Context, _ *mcp.CallToolRequest, in searchContentIn) (*mcp.CallToolResult, searchContentOut, error) {
	var out searchContentOut
	out.Query = in.Query
	terms := queryTerms(in.Query)
	if len(terms) == 0 {
		return toolResult(out)
	}
	idx, err := loadContentIndex()
	if err != nil {
		return nil, out, err
	}
	wantSection := strings.ToLower(strings.TrimSpace(in.Section))

	var hits []searchHit
	for _, p := range idx.Pages {
		if wantSection != "" && p.Section != wantSection {
			continue
		}
		// Title/description weighted more heavily than body text.
		score := countMatches(strings.ToLower(p.Title), terms)*5 +
			countMatches(strings.ToLower(p.Description), terms)*3 +
			countMatches(strings.ToLower(p.Text), terms)
		if score == 0 {
			continue
		}
		hits = append(hits, searchHit{
			Kind: "page", URL: p.URL, Title: p.Title, Section: p.Section,
			Snippet: snippet(p.Text, terms, 280), Score: score,
		})
	}
	if wantSection == "" {
		for _, pr := range idx.Projects {
			score := countMatches(strings.ToLower(pr.Title), terms)*5 +
				countMatches(strings.ToLower(pr.Blurb), terms)
			if score == 0 {
				continue
			}
			hits = append(hits, searchHit{
				Kind: "project", URL: pr.Href, Title: pr.Title,
				Snippet: pr.Blurb, Score: score,
			})
		}
	}

	sort.SliceStable(hits, func(i, j int) bool { return hits[i].Score > hits[j].Score })
	if len(hits) > 10 {
		hits = hits[:10]
	}
	out.Hits = hits
	out.Count = len(hits)
	return toolResult(out)
}

// --- tool: get_page ---------------------------------------------------------

type getPageIn struct {
	URL string `json:"url" jsonschema:"the page url, e.g. /blogs/recall/ (from a search result)"`
}

func getPage(ctx context.Context, _ *mcp.CallToolRequest, in getPageIn) (*mcp.CallToolResult, indexPage, error) {
	idx, err := loadContentIndex()
	if err != nil {
		return nil, indexPage{}, err
	}
	want := strings.TrimSpace(in.URL)
	for _, p := range idx.Pages {
		if p.URL == want || strings.TrimRight(p.URL, "/") == strings.TrimRight(want, "/") {
			return toolResult(p)
		}
	}
	return nil, indexPage{}, fmt.Errorf("no page found for url %q; use search_content to find valid urls", in.URL)
}

// --- tool: list_projects ----------------------------------------------------

type listProjectsIn struct {
	Category string `json:"category,omitempty" jsonschema:"optional filter: home, blogs, or games"`
}

type listProjectsOut struct {
	Count    int            `json:"count"`
	Projects []indexProject `json:"projects"`
}

func listProjects(ctx context.Context, _ *mcp.CallToolRequest, in listProjectsIn) (*mcp.CallToolResult, listProjectsOut, error) {
	idx, err := loadContentIndex()
	if err != nil {
		return nil, listProjectsOut{}, err
	}
	cat := strings.ToLower(strings.TrimSpace(in.Category))
	var out listProjectsOut
	for _, pr := range idx.Projects {
		if cat != "" {
			found := false
			for _, s := range pr.Sections {
				if s == cat {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		out.Projects = append(out.Projects, pr)
	}
	out.Count = len(out.Projects)
	return toolResult(out)
}

// --- tool: list_photos ------------------------------------------------------

type photoEntry struct {
	Filename    string  `json:"filename"`
	Description string  `json:"description"`
	Location    string  `json:"location"`
	PosX        float64 `json:"posX"`
	PosY        float64 `json:"posY"`
}

type listPhotosIn struct {
	Location string `json:"location,omitempty" jsonschema:"optional case-insensitive filter on location, e.g. Taiwan"`
}

type listPhotosOut struct {
	Count  int          `json:"count"`
	Photos []photoEntry `json:"photos"`
}

func listPhotos(ctx context.Context, _ *mcp.CallToolRequest, in listPhotosIn) (*mcp.CallToolResult, listPhotosOut, error) {
	fileMu.RLock()
	data, err := os.ReadFile(photosFile)
	fileMu.RUnlock()
	if err != nil {
		return toolResult(listPhotosOut{})
	}
	var all []photoEntry
	if err := json.Unmarshal(data, &all); err != nil {
		return nil, listPhotosOut{}, fmt.Errorf("photos.json is not valid JSON: %w", err)
	}
	loc := strings.ToLower(strings.TrimSpace(in.Location))
	var out listPhotosOut
	for _, p := range all {
		if loc != "" && !strings.Contains(strings.ToLower(p.Location), loc) {
			continue
		}
		out.Photos = append(out.Photos, p)
	}
	out.Count = len(out.Photos)
	return toolResult(out)
}

// --- tool: get_training_status ----------------------------------------------

type trainingStatusOut struct {
	TotalDaysLogged int            `json:"total_days_logged"`
	FirstDay        string         `json:"first_day,omitempty"`
	LastDay         string         `json:"last_day,omitempty"`
	CountsByType    map[string]int `json:"counts_by_type"`
	Schedule        map[string]string `json:"schedule"`
	RecentRuns      []stravaRun    `json:"recent_runs,omitempty"`
}

func getTrainingStatus(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, trainingStatusOut, error) {
	out := trainingStatusOut{CountsByType: map[string]int{}, Schedule: map[string]string{}}

	fileMu.RLock()
	runData, rErr := os.ReadFile(runningFile)
	stravaData, sErr := os.ReadFile(stravaRunsPath())
	fileMu.RUnlock()

	if rErr == nil {
		if err := json.Unmarshal(runData, &out.Schedule); err != nil {
			return nil, trainingStatusOut{}, fmt.Errorf("running.json is not valid JSON: %w", err)
		}
	}
	var days []string
	for day, typ := range out.Schedule {
		days = append(days, day)
		out.CountsByType[typ]++
	}
	sort.Strings(days)
	out.TotalDaysLogged = len(days)
	if len(days) > 0 {
		out.FirstDay = days[0]
		out.LastDay = days[len(days)-1]
	}

	if sErr == nil {
		var runs []stravaRun
		if err := json.Unmarshal(stravaData, &runs); err == nil {
			sort.SliceStable(runs, func(i, j int) bool { return runs[i].Date > runs[j].Date })
			if len(runs) > 5 {
				runs = runs[:5]
			}
			out.RecentRuns = runs
		}
	}
	return toolResult(out)
}

// --- tool: get_race_result --------------------------------------------------

type raceResult struct {
	Place    string `json:"place"`
	Bib      string `json:"bib"`
	Name     string `json:"name"`
	Age      string `json:"age"`
	Sex      string `json:"sex"`
	Div      string `json:"div"`
	DivPlace string `json:"div_place"`
	NetTime  string `json:"net_time"`
	NetPace  string `json:"net_pace"`
	GunTime  string `json:"gun_time"`
	GunPace  string `json:"gun_pace"`
}

type raceFile struct {
	Event    string       `json:"event"`
	Distance string       `json:"distance"`
	Results  []raceResult `json:"results"`
}

var (
	rrMu      sync.Mutex
	rrCache   *raceFile
	rrModTime time.Time
)

func loadRaceResults() (*raceFile, error) {
	path := raceResultsPath()
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("race results not found at %s: %w", path, err)
	}
	rrMu.Lock()
	defer rrMu.Unlock()
	if rrCache != nil && info.ModTime().Equal(rrModTime) {
		return rrCache, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var rf raceFile
	if err := json.Unmarshal(data, &rf); err != nil {
		return nil, fmt.Errorf("race results is not valid JSON: %w", err)
	}
	rrCache = &rf
	rrModTime = info.ModTime()
	return rrCache, nil
}

type getRaceResultIn struct {
	Name string `json:"name,omitempty" jsonschema:"runner name to look up; defaults to the site owner"`
}

type getRaceResultOut struct {
	Event         string       `json:"event"`
	Distance      string       `json:"distance"`
	TotalFinishers int         `json:"total_finishers"`
	Winner        *raceResult  `json:"winner,omitempty"`
	Matches       []raceResult `json:"matches"`
}

func getRaceResult(ctx context.Context, _ *mcp.CallToolRequest, in getRaceResultIn) (*mcp.CallToolResult, getRaceResultOut, error) {
	rf, err := loadRaceResults()
	if err != nil {
		return nil, getRaceResultOut{}, err
	}
	name := strings.ToLower(strings.TrimSpace(in.Name))
	if name == "" {
		name = strings.ToLower(raceRunnerName())
	}

	out := getRaceResultOut{
		Event:          rf.Event,
		Distance:       rf.Distance,
		TotalFinishers: len(rf.Results),
	}
	for i := range rf.Results {
		r := rf.Results[i]
		if r.Place == "1" && out.Winner == nil {
			w := r
			out.Winner = &w
		}
		if strings.Contains(strings.ToLower(r.Name), name) {
			out.Matches = append(out.Matches, r)
		}
	}
	if len(out.Matches) == 0 {
		return nil, out, fmt.Errorf("no finisher matching %q in %s", name, rf.Event)
	}
	return toolResult(out)
}

// --- result helper ----------------------------------------------------------

// toolResult renders a value as pretty JSON text content while also returning
// it as the typed structured output, so both text-only and structured MCP
// clients get a useful payload.
func toolResult[T any](v T) (*mcp.CallToolResult, T, error) {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, v, err
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: string(b)}},
	}, v, nil
}

// --- wiring -----------------------------------------------------------------

// mcpCORS allows browser-based MCP clients (e.g. the MCP Inspector) to reach the
// endpoint and read the session header. Server-side clients like Claude ignore
// CORS entirely.
func mcpCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID")
		w.Header().Set("Access-Control-Expose-Headers", "Mcp-Session-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func newMCPServer() *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "danbot-lab",
		Version: "1.0.0",
	}, nil)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "search_content",
		Description: "Full-text search across danbot lab's blog posts, pages, and project catalog. Returns ranked matches with a snippet and url. Optionally filter by section (blog, about, home, game, photos).",
	}, searchContent)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_page",
		Description: "Return the full plaintext of a blog post or page by its url (as returned by search_content).",
	}, getPage)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_projects",
		Description: "List the curated projects and writing featured on danbot lab (title, blurb, link). Optionally filter by category: home, blogs, or games.",
	}, listProjects)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_photos",
		Description: "List photographs from the danbot lab gallery with their locations and descriptions. Optionally filter by location.",
	}, listPhotos)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_training_status",
		Description: "Get the site owner's half-marathon training status: the planned workout calendar, counts by workout type, and the most recent logged runs.",
	}, getTrainingStatus)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_race_result",
		Description: "Get a runner's finish (time, pace, place) from the 2026 PNC Alexandria Half Marathon, plus race summary (event, distance, finisher count, winner). Defaults to the site owner.",
	}, getRaceResult)

	return server
}

func registerMCPRoutes() {
	server := newMCPServer()
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil)
	http.Handle("/mcp", mcpCORS(handler))
	registerRoute("POST", "/mcp", "MCP endpoint (Streamable HTTP, read-only)")
}
