package main

import (
	"encoding/json"
	"fmt"
	"math"
	"math/bits"
	"math/rand"
	"net/http"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Server-side CPU players for Word Hold'em.
//
// A CPU is an ordinary Player with IsCPU=true; the game loop in holdem.go calls
// driveCPU on its turn. All decision-making lives here so holdem.go only holds
// the high-level hooks (driveCPU, cpuObserve, the add/remove endpoints).
//
// Three difficulty branches:
//   low    — cheap heuristic "calling station"; no simulation, exploitable.
//   medium — Monte Carlo win-equity vs pot odds, light bluffing.
//   high   — more simulation + an opponent model (aggression / fold-to-bet)
//            that shifts thresholds and bluff frequency as the game goes on.
//
// All functions here run while the caller holds table.mu (driveCPU is invoked
// from tick(); cpuObserve from applyAction; handlers take the lock themselves).
// ---------------------------------------------------------------------------

const (
	cpuLow    = "low"
	cpuMedium = "medium"
	cpuHigh   = "high"

	// Monte Carlo rollout counts. Higher = more accurate equity, more CPU time.
	cpuSamplesMedium = 150
	cpuSamplesHigh   = 320

	// How long a CPU "thinks" before acting, so turns feel natural rather than
	// instant. The game loop ticks every 500ms, so the real delay is ~this.
	cpuThinkDelay = 1200 * time.Millisecond
)

// ---------------------------------------------------------------------------
// Phase 0 — game-loop hook
// ---------------------------------------------------------------------------

// driveCPU acts for a CPU whose turn it is, once its think delay has elapsed.
// Called from tick() (caller holds table.mu).
func (t *Table) driveCPU(p *Player, now time.Time) {
	if t.Deadline.IsZero() {
		return
	}
	turnStart := t.Deadline.Add(-turnSeconds * time.Second)
	if now.Sub(turnStart) < cpuThinkDelay {
		return // still thinking
	}

	action, amount := t.cpuDecide(p)
	if err := t.applyAction(p, action, amount); err != nil {
		// Decision was somehow illegal — fall back to a guaranteed-legal action.
		// applyAction validates before mutating, so no partial state on error.
		if t.CurrentBet-p.Bet > 0 {
			t.applyAction(p, "fold", 0)
		} else {
			t.applyAction(p, "check", 0)
		}
	}
}

// cpuDecide routes to the difficulty-specific strategy and returns a betting
// action plus (for bet/raise) the total amount the CPU's bet should reach.
func (t *Table) cpuDecide(p *Player) (string, int) {
	toCall := t.CurrentBet - p.Bet
	canRaise := p.Chips > toCall // has chips beyond a flat call

	switch p.Difficulty {
	case cpuLow:
		return t.decideLow(p, toCall, canRaise)
	case cpuHigh:
		return t.decideHigh(p, toCall, canRaise)
	default:
		return t.decideMedium(p, toCall, canRaise)
	}
}

// ---------------------------------------------------------------------------
// Difficulty: LOW — cheap heuristic, no simulation
// ---------------------------------------------------------------------------

// decideLow plays loose-passive: it calls cheap bets readily, rarely folds, and
// only occasionally raises with an obviously strong made word.
func (t *Table) decideLow(p *Player, toCall int, canRaise bool) (string, int) {
	str := t.heuristicStrength(p) + (rand.Float64()-0.5)*0.10

	if toCall == 0 {
		if canRaise && str > 0.70 && rand.Float64() < 0.15 {
			return cpuRaiseTo(t, p, 0.4)
		}
		return "check", 0
	}

	potOdds := float64(toCall) / float64(t.Pot+toCall)
	// Calling station: pays small bets regardless, folds only weak + expensive.
	if toCall <= bigBlind*2 || str > potOdds*0.6 {
		if canRaise && str > 0.80 && rand.Float64() < 0.10 {
			return cpuRaiseTo(t, p, 0.5)
		}
		return "call", 0
	}
	return "fold", 0
}

// heuristicStrength is a crude 0..1 read of the CPU's current made word, used by
// the low branch only. A ~35-point word maps to near 1.0.
func (t *Table) heuristicStrength(p *Player) float64 {
	score := bestScoreOnly(appendTiles(p.Hole, t.Community))
	s := float64(score) / 35.0
	if s > 0.95 {
		s = 0.95
	}
	return s
}

// ---------------------------------------------------------------------------
// Difficulty: MEDIUM — Monte Carlo equity vs pot odds (+ light bluff)
// ---------------------------------------------------------------------------

func (t *Table) decideMedium(p *Player, toCall int, canRaise bool) (string, int) {
	eq := t.cpuEquity(p, cpuSamplesMedium)

	if toCall == 0 {
		switch {
		case canRaise && eq > 0.62:
			return cpuRaiseTo(t, p, 0.6) // value bet
		case canRaise && eq < 0.30 && rand.Float64() < 0.08:
			return cpuRaiseTo(t, p, 0.5) // occasional bluff
		default:
			return "check", 0
		}
	}

	potOdds := float64(toCall) / float64(t.Pot+toCall)
	switch {
	case canRaise && eq > 0.72:
		return cpuRaiseTo(t, p, 0.7) // value raise
	case eq >= potOdds+0.05:
		return "call", 0
	default:
		return "fold", 0
	}
}

// ---------------------------------------------------------------------------
// Difficulty: HIGH — equity + opponent model (Phase 3)
// ---------------------------------------------------------------------------

func (t *Table) decideHigh(p *Player, toCall int, canRaise bool) (string, int) {
	eq := t.cpuEquity(p, cpuSamplesHigh)
	aggr, foldRate, conf := t.fieldRead(p)

	// Shift our effective equity based on the likely bettor's tendencies:
	// against a habitual bettor (bluffy) we call wider; against a nit we respect
	// the bet and fold more. Scaled by how much data we have on them.
	adj := 0.0
	if toCall > 0 {
		switch {
		case aggr > 0.55:
			adj = 0.06 * conf
		case aggr < 0.30:
			adj = -0.07 * conf
		}
	}
	effEq := clamp01(eq + adj)

	// Bluff more into a field that folds a lot.
	bluffFreq := 0.10 + 0.25*foldRate*conf
	if bluffFreq > 0.35 {
		bluffFreq = 0.35
	}

	if toCall == 0 {
		switch {
		case canRaise && eq > 0.60:
			return cpuRaiseTo(t, p, betFracByStrength(eq))
		case canRaise && eq < 0.32 && rand.Float64() < bluffFreq:
			return cpuRaiseTo(t, p, 0.55) // bluff
		default:
			return "check", 0
		}
	}

	potOdds := float64(toCall) / float64(t.Pot+toCall)
	switch {
	case canRaise && effEq > 0.70:
		return cpuRaiseTo(t, p, 0.75) // value raise
	case effEq >= potOdds+0.03:
		return "call", 0
	case canRaise && effEq < potOdds*0.7 && rand.Float64() < bluffFreq*0.5:
		return cpuRaiseTo(t, p, 0.6) // bluff-raise vs a foldy field
	default:
		return "fold", 0
	}
}

// betFracByStrength sizes value bets larger as equity climbs.
func betFracByStrength(eq float64) float64 {
	switch {
	case eq > 0.85:
		return 0.9
	case eq > 0.72:
		return 0.7
	default:
		return 0.55
	}
}

// ---------------------------------------------------------------------------
// Word selection — the word a CPU actually submits at showdown
// ---------------------------------------------------------------------------

// Per-difficulty word skill: `base` is the target word score as a fraction of the
// CPU's best possible word, and `noise` is the +/- random spread around it. A
// weaker CPU aims lower (and more erratically), so it frequently "misses" the
// big word; a hard CPU lands at or near optimal almost every time.
type wordSkill struct{ base, noise float64 }

var wordSkillByDiff = map[string]wordSkill{
	cpuLow:    {base: 0.55, noise: 0.22},
	cpuMedium: {base: 0.78, noise: 0.14},
	cpuHigh:   {base: 0.97, noise: 0.06},
}

// cpuChooseWord picks the word a CPU submits at showdown. It enumerates the words
// the CPU could play, then selects one whose score matches its difficulty-scaled
// target — so easy bots routinely play sub-optimal words while hard bots find the
// best. Returns ("", 0) if no word is possible.
func (t *Table) cpuChooseWord(p *Player) (string, int) {
	words := rankedWords(appendTiles(p.Hole, t.Community))
	if len(words) == 0 {
		return "", 0
	}
	best := words[0].score

	skill, ok := wordSkillByDiff[p.Difficulty]
	if !ok {
		skill = wordSkillByDiff[cpuMedium]
	}
	frac := clamp01(skill.base + (rand.Float64()*2-1)*skill.noise)
	target := int(math.Round(frac * float64(best)))

	// words is sorted high→low, so the first word at or below the target is the
	// strongest word the CPU "found" at its skill level.
	chosen := words[len(words)-1] // weakest, if nothing is at/under target
	for _, wc := range words {
		if wc.score <= target {
			chosen = wc
			break
		}
	}
	return chosen.word, chosen.score
}

// ---------------------------------------------------------------------------
// Phase 1 — Monte Carlo win-equity using the exact word solver
// ---------------------------------------------------------------------------

// cpuEquity estimates P(this CPU wins the pot) by repeatedly dealing the unknown
// tiles (remaining community + each live opponent's 3 hole tiles) from the tiles
// not yet seen, then scoring every contender's best word. Ties split equity.
func (t *Table) cpuEquity(p *Player, samples int) float64 {
	var opps []*Player
	for _, o := range t.inHandNotFolded() {
		if o != p {
			opps = append(opps, o)
		}
	}
	nOpp := len(opps)
	if nOpp == 0 {
		return 1
	}

	seen := appendTiles(p.Hole, t.Community)
	pool := remainingTiles(seen)

	needCommunity := 7 - len(t.Community)
	if needCommunity < 0 {
		needCommunity = 0
	}
	need := needCommunity + 3*nOpp
	if need > len(pool) {
		return t.heuristicStrength(p) // not enough tiles to simulate (shouldn't happen)
	}

	oppScores := make([]int, nOpp)
	total := 0.0
	for s := 0; s < samples; s++ {
		// Partial Fisher-Yates: randomize the first `need` tiles of the pool.
		for i := 0; i < need; i++ {
			j := i + rand.Intn(len(pool)-i)
			pool[i], pool[j] = pool[j], pool[i]
		}
		idx := 0

		comm := make([]Tile, 0, 7)
		comm = append(comm, t.Community...)
		for k := 0; k < needCommunity; k++ {
			comm = append(comm, pool[idx])
			idx++
		}

		myScore := bestScoreOnly(appendTiles(p.Hole, comm))
		bestOpp := 0
		for oi := 0; oi < nOpp; oi++ {
			oh := pool[idx : idx+3]
			idx += 3
			sc := bestScoreOnly(appendTiles(oh, comm))
			oppScores[oi] = sc
			if sc > bestOpp {
				bestOpp = sc
			}
		}

		switch {
		case myScore > bestOpp:
			total += 1
		case myScore == bestOpp:
			tied := 1 // count ourselves
			for oi := 0; oi < nOpp; oi++ {
				if oppScores[oi] == myScore {
					tied++
				}
			}
			total += 1.0 / float64(tied)
		}
	}
	return total / float64(samples)
}

// remainingTiles returns every tile in a fresh bag minus the ones already seen
// (the CPU's hole tiles + the revealed community) — i.e. the tiles that could be
// in opponents' hands or come on later streets. This models letter scarcity.
func remainingTiles(seen []Tile) []Tile {
	var counts, pts [26]int
	for _, spec := range letterSpecs {
		idx := spec.letter[0] - 'A'
		counts[idx] = spec.count
		pts[idx] = spec.points
	}
	for _, tl := range seen {
		if tl.Letter == "" {
			continue
		}
		counts[tl.Letter[0]-'A']--
	}
	var out []Tile
	for c := 0; c < 26; c++ {
		for k := 0; k < counts[c]; k++ {
			out = append(out, Tile{Letter: string(rune('A' + c)), Points: pts[c]})
		}
	}
	return out
}

// bestScoreOnly returns the highest valid-word score formable from `tiles`. It's
// a lean variant of solveTiles: it skips word/tile binding and only checks the
// dictionary when a subset could beat the best score so far, which prunes the
// large majority of lookups.
func bestScoreOnly(tiles []Tile) int {
	n := len(tiles)
	if n < 2 {
		return 0
	}
	full := (1 << n) - 1
	best := 0
	for mask := 1; mask <= full; mask++ {
		if bits.OnesCount(uint(mask)) < 2 {
			continue
		}
		var counts [26]int
		sc := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				counts[tiles[i].Letter[0]-'A']++
				sc += tiles[i].Points
			}
		}
		if sc <= best {
			continue // can't improve, skip the dictionary lookup
		}
		if _, ok := wordSigs[sigFromCounts(counts)]; ok {
			best = sc
		}
	}
	return best
}

// ---------------------------------------------------------------------------
// Phase 2 — legal bet sizing
// ---------------------------------------------------------------------------

// cpuRaiseTo turns a desired pot-fraction into a legal bet/raise. It returns the
// total amount the CPU's Bet should reach (the form applyAction expects),
// clamped to an all-in and never below the minimum raise. Falls back to
// call/check if a raise isn't actually possible.
func cpuRaiseTo(t *Table, p *Player, potFrac float64) (string, int) {
	maxTotal := p.Bet + p.Chips
	raiseBy := int(math.Round(potFrac * float64(t.Pot)))
	if raiseBy < t.MinRaise {
		raiseBy = t.MinRaise
	}
	amount := t.CurrentBet + raiseBy
	if amount > maxTotal {
		amount = maxTotal // all-in
	}
	if amount <= t.CurrentBet {
		// Can't legally exceed the current bet — just call (or check).
		if t.CurrentBet-p.Bet > 0 {
			return "call", 0
		}
		return "check", 0
	}
	if t.CurrentBet == 0 {
		return "bet", amount
	}
	return "raise", amount
}

// ---------------------------------------------------------------------------
// Phase 3 — opponent model
// ---------------------------------------------------------------------------

// playerModel accumulates simple tendencies for one player across the game.
type playerModel struct {
	aggressive         int // bet / raise actions
	passive            int // call / check actions
	foldsFacingBet     int
	decisionsFacingBet int
}

// oppModel is keyed by player ID. Accessed only under table.mu.
var oppModel = map[string]*playerModel{}

func (m *playerModel) observations() int {
	if m == nil {
		return 0
	}
	return m.aggressive + m.passive
}

// aggression is bet+raise share of all actions, with a neutral prior until we've
// seen enough to trust it.
func (m *playerModel) aggression() float64 {
	if m == nil {
		return 0.4
	}
	tot := m.aggressive + m.passive
	if tot < 4 {
		return 0.4
	}
	return float64(m.aggressive) / float64(tot)
}

// foldToBet is how often the player folds when facing a bet (neutral prior with
// little data).
func (m *playerModel) foldToBet() float64 {
	if m == nil || m.decisionsFacingBet < 4 {
		return 0.4
	}
	return float64(m.foldsFacingBet) / float64(m.decisionsFacingBet)
}

// cpuObserve records one player's action into the model. Called from
// applyAction for every player (human and CPU).
func cpuObserve(p *Player, action string, facingBet bool) {
	m := oppModel[p.ID]
	if m == nil {
		m = &playerModel{}
		oppModel[p.ID] = m
	}
	switch action {
	case "bet", "raise":
		m.aggressive++
	case "call", "check":
		m.passive++
	}
	if facingBet {
		m.decisionsFacingBet++
		if action == "fold" {
			m.foldsFacingBet++
		}
	}
}

// fieldRead summarizes the live opponents (excluding self): the most aggressive
// one's aggression (a stand-in for the likely bettor), the average fold-to-bet,
// and a 0..1 confidence based on the least-observed opponent.
func (t *Table) fieldRead(self *Player) (aggr, foldRate, conf float64) {
	maxAgg, sumFold := 0.0, 0.0
	n, minObs := 0, 1<<30
	for _, o := range t.inHandNotFolded() {
		if o == self {
			continue
		}
		m := oppModel[o.ID]
		if a := m.aggression(); a > maxAgg {
			maxAgg = a
		}
		sumFold += m.foldToBet()
		if obs := m.observations(); obs < minObs {
			minObs = obs
		}
		n++
	}
	if n == 0 {
		return 0.4, 0.4, 0
	}
	c := float64(minObs) / 12.0
	if c > 1 {
		c = 1
	}
	return maxAgg, sumFold / float64(n), c
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

func appendTiles(a, b []Tile) []Tile {
	out := make([]Tile, 0, len(a)+len(b))
	out = append(out, a...)
	out = append(out, b...)
	return out
}

func clamp01(x float64) float64 {
	if x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

func normalizeDifficulty(d string) string {
	switch strings.ToLower(strings.TrimSpace(d)) {
	case "low", "easy", "l":
		return cpuLow
	case "high", "hard", "h":
		return cpuHigh
	default:
		return cpuMedium
	}
}

func diffTag(d string) string {
	switch d {
	case cpuLow:
		return "easy"
	case cpuHigh:
		return "hard"
	default:
		return "med"
	}
}

var cpuNames = []string{"Ada", "Bo", "Cleo", "Dot", "Echo", "Fox", "Gus", "Hex", "Iris", "Jet"}

// uniqueCPUName picks a bot name not already in use at the table, tagged with
// difficulty (caller holds table.mu).
func (t *Table) uniqueCPUName(diff string) string {
	tag := diffTag(diff)
	used := map[string]bool{}
	for _, p := range t.Players {
		if p != nil {
			used[p.Name] = true
		}
	}
	for _, p := range t.Queue {
		used[p.Name] = true
	}
	for _, i := range rand.Perm(len(cpuNames)) {
		nm := fmt.Sprintf("%s (%s)", cpuNames[i], tag)
		if !used[nm] {
			return nm
		}
	}
	return fmt.Sprintf("CPU%d (%s)", rand.Intn(1000), tag)
}

// ---------------------------------------------------------------------------
// Phase 0 — table management (caller holds table.mu)
// ---------------------------------------------------------------------------

// betweenRounds reports whether it's safe to add/remove players without
// disturbing a live hand.
func (t *Table) betweenRounds() bool {
	return t.Phase == phaseWaiting || t.Phase == phaseReady || t.Phase == phaseShowdown
}

// addCPU seats (or queues) a new CPU player of the given difficulty.
func (t *Table) addCPU(difficulty string) (*Player, error) {
	if t.seatedCount() >= maxSeats && t.firstFreeSeat() < 0 {
		return nil, fmt.Errorf("table is full")
	}
	diff := normalizeDifficulty(difficulty)
	p := &Player{
		ID:         "cpu-" + newPlayerID(),
		Name:       t.uniqueCPUName(diff),
		Chips:      startingChips,
		Seat:       -1,
		IsCPU:      true,
		Difficulty: diff,
		LastSeen:   time.Now(),
	}
	t.seatPlayer(p)
	return p, nil
}

// removeCPUSeat removes the CPU sitting at `seat`.
func (t *Table) removeCPUSeat(seat int) error {
	if seat < 0 || seat >= maxSeats {
		return fmt.Errorf("invalid seat")
	}
	p := t.Players[seat]
	if p == nil || !p.IsCPU {
		return fmt.Errorf("no CPU at seat %d", seat)
	}
	t.removePlayer(p.ID)
	delete(oppModel, p.ID)
	return nil
}

// refreshLobbyPhase recomputes WAITING/READY after the roster changes (leaves a
// SHOWDOWN pause untouched).
func (t *Table) refreshLobbyPhase() {
	if t.Phase == phaseWaiting || t.Phase == phaseReady {
		if len(t.eligibleToPlay()) >= 2 {
			t.Phase = phaseReady
		} else {
			t.Phase = phaseWaiting
		}
	}
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

func registerCPURoutes() {
	http.HandleFunc("/holdem/addcpu", cors(holdemAddCPU))
	registerRoute("POST", "/holdem/addcpu", "Add a CPU player (between rounds)")

	http.HandleFunc("/holdem/removecpu", cors(holdemRemoveCPU))
	registerRoute("POST", "/holdem/removecpu", "Remove a CPU player (between rounds)")
}

// holdemAddCPU adds a CPU to the table. Any seated player may do this while the
// table is between rounds.
func holdemAddCPU(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.Header.Get("X-Player-ID")
	var body struct {
		Difficulty string `json:"difficulty"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	table.mu.Lock()
	defer table.mu.Unlock()

	requester := table.findPlayer(id)
	if requester == nil || requester.Seat < 0 {
		http.Error(w, "Must be seated to manage CPUs", http.StatusForbidden)
		return
	}
	if !table.betweenRounds() {
		http.Error(w, "Can only add CPUs between rounds", http.StatusConflict)
		return
	}
	requester.LastSeen = time.Now()

	p, err := table.addCPU(body.Difficulty)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	table.refreshLobbyPhase()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"seat":       p.Seat,
		"name":       p.Name,
		"difficulty": p.Difficulty,
	})
}

// holdemRemoveCPU removes the CPU at the given seat.
func holdemRemoveCPU(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.Header.Get("X-Player-ID")
	var body struct {
		Seat int `json:"seat"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	table.mu.Lock()
	defer table.mu.Unlock()

	requester := table.findPlayer(id)
	if requester == nil || requester.Seat < 0 {
		http.Error(w, "Must be seated to manage CPUs", http.StatusForbidden)
		return
	}
	if !table.betweenRounds() {
		http.Error(w, "Can only remove CPUs between rounds", http.StatusConflict)
		return
	}
	requester.LastSeen = time.Now()

	if err := table.removeCPUSeat(body.Seat); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	table.refreshLobbyPhase()

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}
