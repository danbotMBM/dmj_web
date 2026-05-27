package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"math/bits"
	mrand "math/rand"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

// ---------------------------------------------------------------------------
// Word Hold'em — a Texas Hold'em style word game played with letter tiles.
// Single shared table, max 10 seats, overflow players wait in a queue.
// State is in-memory only; a restart resets the table (casual game).
// Clients drive the UI by polling GET /holdem/state (~1s).
// ---------------------------------------------------------------------------

const (
	holdemWordsFile = "holdem_words.txt"
	maxSeats        = 10
	startingChips   = 1000
	smallBlind      = 10
	bigBlind        = 20
	turnSeconds     = 25 // per-turn betting timer
	handOverSeconds = 8  // pause to show showdown results
	disconnectGrace = 15 * time.Second
)

// Phases of a hand.
const (
	phaseWaiting    = "WAITING"     // fewer than 2 players — can't start
	phaseReady      = "READY"       // enough players; waiting for someone to start
	phaseBetPreflop = "BET_PREFLOP" // after hole tiles dealt
	phaseBetFlop    = "BET_FLOP"    // after first 2 community tiles
	phaseBetTurn    = "BET_TURN"    // after next 2 community tiles
	phaseBetRiver   = "BET_RIVER"   // after final 3 community tiles
	phaseShowdown   = "SHOWDOWN"    // results shown, brief pause
)

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

type Tile struct {
	Letter string `json:"letter"` // "A".."Z", or "" for a blank
	Points int    `json:"points"`
	Blank  bool   `json:"blank"`
}

// Standard Scrabble distribution, minus blanks (98 tiles).
type letterSpec struct {
	letter string
	points int
	count  int
}

var letterSpecs = []letterSpec{
	{"A", 1, 9}, {"B", 3, 2}, {"C", 3, 2}, {"D", 2, 4}, {"E", 1, 12},
	{"F", 4, 2}, {"G", 2, 3}, {"H", 4, 2}, {"I", 1, 9}, {"J", 8, 1},
	{"K", 5, 1}, {"L", 1, 4}, {"M", 3, 2}, {"N", 1, 6}, {"O", 1, 8},
	{"P", 3, 2}, {"Q", 10, 1}, {"R", 1, 6}, {"S", 1, 4}, {"T", 1, 6},
	{"U", 1, 4}, {"V", 4, 2}, {"W", 4, 2}, {"X", 8, 1}, {"Y", 4, 2},
	{"Z", 10, 1},
}

func newBag() []Tile {
	var bag []Tile
	for _, s := range letterSpecs {
		for i := 0; i < s.count; i++ {
			bag = append(bag, Tile{Letter: s.letter, Points: s.points})
		}
	}
	mrand.Shuffle(len(bag), func(i, j int) { bag[i], bag[j] = bag[j], bag[i] })
	return bag
}

// ---------------------------------------------------------------------------
// Players & table
// ---------------------------------------------------------------------------

type Player struct {
	ID       string
	Name     string
	Seat     int // index into Table.Players, or -1 when queued
	Chips    int
	Hole     []Tile
	Bet      int // chips committed this betting round
	Folded   bool
	AllIn    bool
	HasActed bool // acted at least once in the current betting round
	InHand   bool // dealt into the current hand
	LastSeen time.Time
}

// showdownEntry is one player's result at showdown.
type showdownEntry struct {
	Name  string       `json:"name"`
	Word  string       `json:"word"`
	Score int          `json:"score"`
	Hole  []Tile       `json:"hole"`
	Won   bool         `json:"won"`
	Play  *bestPlayDTO `json:"play"` // best play spelled out in tiles
}

type handResult struct {
	Entries   []showdownEntry `json:"entries"`
	Community []Tile          `json:"community"`
	Pot       int             `json:"pot"`
	WinnerMsg string          `json:"winnerMsg"`
}

type Table struct {
	mu sync.Mutex

	Phase     string
	Players   [maxSeats]*Player
	Queue     []*Player
	Community []Tile
	bag       []Tile

	Pot        int
	CurrentBet int // highest Bet committed this round
	MinRaise   int // minimum raise increment
	Button     int // dealer seat
	Acting     int // seat whose turn it is (-1 if none)

	Deadline   time.Time // turn timer or hand-over timer
	LastResult *handResult

	// Event counters so clients can play sound effects. ActionSeq increments on
	// each betting action (with the action's type); DealSeq increments whenever
	// tiles are dealt (hand start or a community reveal).
	ActionSeq      int
	LastActionType string
	DealSeq        int
}

var table = &Table{Phase: phaseWaiting, Acting: -1}

// ---------------------------------------------------------------------------
// Word list & best-word scoring
// ---------------------------------------------------------------------------

// wordSigs maps a sorted-letter signature (e.g. "AET") to an example word with
// those letters, so any anagram subset of tiles can be validated in O(1).
var wordSigs = map[string]string{}

// sigFromCounts builds the canonical signature for a letter-count histogram:
// each letter repeated count times, in A–Z order.
func sigFromCounts(counts [26]int) string {
	var b strings.Builder
	for c := 0; c < 26; c++ {
		for k := 0; k < counts[c]; k++ {
			b.WriteByte(byte('A' + c))
		}
	}
	return b.String()
}

func loadHoldemWords() {
	f, err := os.Open(holdemWordsFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open holdem words file: %v\n", err)
		return
	}
	defer f.Close()

	count := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		w := strings.ToUpper(strings.TrimSpace(scanner.Text()))
		// A word can use at most 3 hole + 7 community = 10 tiles.
		if len(w) < 2 || len(w) > 10 {
			continue
		}
		var counts [26]int
		ok := true
		for i := 0; i < len(w); i++ {
			if w[i] < 'A' || w[i] > 'Z' {
				ok = false
				break
			}
			counts[w[i]-'A']++
		}
		if !ok {
			continue
		}
		sig := sigFromCounts(counts)
		// Keep the shortest example word per signature for tidy display.
		if ex, seen := wordSigs[sig]; !seen || len(w) < len(ex) {
			wordSigs[sig] = w
		}
		count++
	}
	fmt.Printf("Loaded %d holdem words (%d distinct anagrams)\n", count, len(wordSigs))
}

// solveTiles finds the single highest-scoring valid word formable from `tiles`.
// It returns the chosen word-subset (a bitmask over `tiles`, at most one), an
// example word for every subset (`wword[sub]`), and the word's score (the sum of
// the point values of the tiles it uses). Ties on score prefer the longer word.
func solveTiles(tiles []Tile) (subsets []int, wword []string, score int) {
	n := len(tiles)
	if n == 0 {
		return nil, nil, 0
	}
	full := (1 << n) - 1

	wword = make([]string, 1<<n)
	bestMask := -1
	bestScore := -1
	for mask := 1; mask <= full; mask++ {
		if bits.OnesCount(uint(mask)) < 2 {
			continue // single tiles and the empty set aren't words
		}
		var counts [26]int
		sc := 0
		for i := 0; i < n; i++ {
			if mask&(1<<i) != 0 {
				counts[tiles[i].Letter[0]-'A']++
				sc += tiles[i].Points
			}
		}
		ex, ok := wordSigs[sigFromCounts(counts)]
		if !ok {
			continue
		}
		wword[mask] = ex
		if sc > bestScore || (sc == bestScore && bestMask >= 0 && len(ex) > len(wword[bestMask])) {
			bestScore = sc
			bestMask = mask
		}
	}

	if bestMask < 0 {
		return nil, wword, 0
	}
	return []int{bestMask}, wword, bestScore
}

// bestWord returns the chosen word for display plus its score.
func bestWord(tiles []Tile) (string, int) {
	subsets, wword, score := solveTiles(tiles)
	if len(subsets) == 0 {
		return "", 0
	}
	return wword[subsets[0]], score
}

// bestTileDTO is one tile in a rendered best play.
type bestTileDTO struct {
	Letter string `json:"letter"`
	Points int    `json:"points"`
	River  bool   `json:"river"` // true if the tile came from the community
}

// bestPlayDTO is the structured best play for client rendering: each chosen word
// spelled out in its specific tiles, which community tiles get consumed, and the
// player's leftover (unused) hole tiles.
type bestPlayDTO struct {
	Words         [][]bestTileDTO `json:"words"`
	Leftover      []bestTileDTO   `json:"leftover"`
	Score         int             `json:"score"`
	UsedCommunity []bool          `json:"usedCommunity"`
}

// playWordString joins a best play's words for text display, e.g. "QUART + ZA".
func playWordString(p *bestPlayDTO) string {
	if p == nil {
		return ""
	}
	parts := make([]string, len(p.Words))
	for i, word := range p.Words {
		var b strings.Builder
		for _, tile := range word {
			b.WriteString(tile.Letter)
		}
		parts[i] = b.String()
	}
	return strings.Join(parts, " + ")
}

// computeBestPlay builds the best play from a player's hole tiles + the revealed
// community tiles, mapping each word's letters back to specific tiles so the
// client can render them and shade the consumed community tiles.
func computeBestPlay(hole, community []Tile) *bestPlayDTO {
	tiles := append(append([]Tile{}, hole...), community...)
	nHole := len(hole)
	n := len(tiles)
	subsets, wword, score := solveTiles(tiles)

	res := &bestPlayDTO{Score: score, UsedCommunity: make([]bool, len(community))}
	usedMask := 0
	for _, sub := range subsets {
		ex := wword[sub]
		assigned := 0
		var wt []bestTileDTO
		// Walk the example word and bind each letter to a concrete tile in `sub`.
		for k := 0; k < len(ex); k++ {
			for i := 0; i < n; i++ {
				if sub&(1<<i) != 0 && assigned&(1<<i) == 0 && tiles[i].Letter[0] == ex[k] {
					assigned |= 1 << i
					river := i >= nHole
					if river {
						res.UsedCommunity[i-nHole] = true
					}
					wt = append(wt, bestTileDTO{tiles[i].Letter, tiles[i].Points, river})
					break
				}
			}
		}
		usedMask |= sub
		res.Words = append(res.Words, wt)
	}

	// Unused hole tiles render to the right of the word(s).
	for i := 0; i < nHole; i++ {
		if usedMask&(1<<i) == 0 {
			res.Leftover = append(res.Leftover, bestTileDTO{tiles[i].Letter, tiles[i].Points, false})
		}
	}
	return res
}

// ---------------------------------------------------------------------------
// Seat / player helpers (caller holds table.mu)
// ---------------------------------------------------------------------------

func (t *Table) findPlayer(id string) *Player {
	for _, p := range t.Players {
		if p != nil && p.ID == id {
			return p
		}
	}
	for _, p := range t.Queue {
		if p.ID == id {
			return p
		}
	}
	return nil
}

func (t *Table) seatedCount() int {
	n := 0
	for _, p := range t.Players {
		if p != nil {
			n++
		}
	}
	return n
}

// firstFreeSeat returns the lowest empty seat index, or -1 if full.
func (t *Table) firstFreeSeat() int {
	for i, p := range t.Players {
		if p == nil {
			return i
		}
	}
	return -1
}

// seatPlayer places a player at a free seat if one exists; otherwise queues.
func (t *Table) seatPlayer(p *Player) {
	seat := t.firstFreeSeat()
	if seat >= 0 {
		p.Seat = seat
		t.Players[seat] = p
	} else {
		p.Seat = -1
		t.Queue = append(t.Queue, p)
	}
}

// removePlayer frees a seat or removes from the queue.
func (t *Table) removePlayer(id string) {
	for i, p := range t.Players {
		if p != nil && p.ID == id {
			t.Players[i] = nil
			return
		}
	}
	for i, p := range t.Queue {
		if p.ID == id {
			t.Queue = append(t.Queue[:i], t.Queue[i+1:]...)
			return
		}
	}
}

// promoteQueue moves queued players into any free seats (preserving order).
func (t *Table) promoteQueue() {
	for len(t.Queue) > 0 {
		seat := t.firstFreeSeat()
		if seat < 0 {
			return
		}
		p := t.Queue[0]
		t.Queue = t.Queue[1:]
		p.Seat = seat
		t.Players[seat] = p
	}
}

// activePlayers returns seated players currently in the hand and not folded.
func (t *Table) inHandNotFolded() []*Player {
	var ps []*Player
	for _, p := range t.Players {
		if p != nil && p.InHand && !p.Folded {
			ps = append(ps, p)
		}
	}
	return ps
}

// nextOccupiedInHand returns the next seat (clockwise from `from`, exclusive)
// holding a player still in the hand who can act (not folded, not all-in).
func (t *Table) nextActable(from int) int {
	for i := 1; i <= maxSeats; i++ {
		s := (from + i) % maxSeats
		p := t.Players[s]
		if p != nil && p.InHand && !p.Folded && !p.AllIn && p.Chips > 0 {
			return s
		}
	}
	return -1
}

// ---------------------------------------------------------------------------
// Hand progression (caller holds table.mu)
// ---------------------------------------------------------------------------

func (t *Table) eligibleToPlay() []*Player {
	var ps []*Player
	for _, p := range t.Players {
		if p != nil && p.Chips > 0 {
			ps = append(ps, p)
		}
	}
	return ps
}

func (t *Table) startHand() {
	t.promoteQueue()
	eligible := t.eligibleToPlay()
	if len(eligible) < 2 {
		t.Phase = phaseWaiting
		t.Acting = -1
		t.Community = nil
		return
	}

	t.bag = newBag()
	t.Community = nil
	t.Pot = 0
	t.CurrentBet = 0
	t.MinRaise = bigBlind
	t.LastResult = nil

	for _, p := range t.Players {
		if p == nil {
			continue
		}
		p.Bet = 0
		p.Folded = false
		p.AllIn = false
		p.HasActed = false
		p.Hole = nil
		p.InHand = p.Chips > 0
	}

	// Move the button to the next eligible seat.
	t.Button = t.nextInHandSeat(t.Button)

	// Deal 3 hole tiles to each in-hand player.
	for i := 0; i < 3; i++ {
		for _, p := range t.Players {
			if p != nil && p.InHand {
				p.Hole = append(p.Hole, t.draw())
			}
		}
	}
	t.DealSeq++

	// Post blinds. Heads-up: button posts small blind.
	sbSeat := t.nextInHandSeat(t.Button)
	bbSeat := t.nextInHandSeat(sbSeat)
	if t.countInHand() == 2 {
		sbSeat = t.Button
		bbSeat = t.nextInHandSeat(t.Button)
	}
	t.postBlind(sbSeat, smallBlind)
	t.postBlind(bbSeat, bigBlind)
	t.CurrentBet = bigBlind

	t.Phase = phaseBetPreflop
	// First to act is left of the big blind.
	t.Acting = t.nextActable(bbSeat)
	if t.Acting < 0 {
		// Everyone is all-in from blinds; just run it out.
		t.advancePhase()
		return
	}
	t.Deadline = time.Now().Add(turnSeconds * time.Second)
}

func (t *Table) countInHand() int {
	n := 0
	for _, p := range t.Players {
		if p != nil && p.InHand {
			n++
		}
	}
	return n
}

// nextInHandSeat returns the next seat holding an in-hand player.
func (t *Table) nextInHandSeat(from int) int {
	for i := 1; i <= maxSeats; i++ {
		s := (from + i) % maxSeats
		if p := t.Players[s]; p != nil && p.InHand {
			return s
		}
	}
	return from
}

func (t *Table) draw() Tile {
	tile := t.bag[len(t.bag)-1]
	t.bag = t.bag[:len(t.bag)-1]
	return tile
}

func (t *Table) postBlind(seat, amount int) {
	p := t.Players[seat]
	if p == nil {
		return
	}
	if amount >= p.Chips {
		amount = p.Chips
		p.AllIn = true
	}
	p.Chips -= amount
	p.Bet += amount
	t.Pot += amount
}

// applyAction applies a validated betting action for the acting player.
func (t *Table) applyAction(p *Player, action string, amount int) error {
	toCall := t.CurrentBet - p.Bet
	switch action {
	case "fold":
		p.Folded = true
	case "check":
		if toCall > 0 {
			return fmt.Errorf("cannot check facing a bet")
		}
	case "call":
		if toCall <= 0 {
			return fmt.Errorf("nothing to call")
		}
		pay := toCall
		if pay >= p.Chips {
			pay = p.Chips
			p.AllIn = true
		}
		p.Chips -= pay
		p.Bet += pay
		t.Pot += pay
	case "bet", "raise":
		// `amount` is the total chips the player wants their Bet to become.
		if amount <= t.CurrentBet {
			return fmt.Errorf("raise must exceed current bet")
		}
		raiseBy := amount - t.CurrentBet
		if raiseBy < t.MinRaise && (amount-p.Bet) < p.Chips {
			return fmt.Errorf("raise too small (min raise %d)", t.MinRaise)
		}
		pay := amount - p.Bet
		if pay >= p.Chips {
			pay = p.Chips
			amount = p.Bet + pay
			p.AllIn = true
		}
		p.Chips -= pay
		p.Bet += pay
		t.Pot += pay
		if p.Bet > t.CurrentBet {
			t.MinRaise = p.Bet - t.CurrentBet
			t.CurrentBet = p.Bet
			// A raise reopens action for everyone else.
			for _, op := range t.Players {
				if op != nil && op.InHand && !op.Folded && !op.AllIn && op != p {
					op.HasActed = false
				}
			}
		}
	default:
		return fmt.Errorf("unknown action %q", action)
	}
	p.HasActed = true
	// Record the event for client sound effects ("bet" plays as "raise").
	t.ActionSeq++
	if action == "bet" {
		t.LastActionType = "raise"
	} else {
		t.LastActionType = action
	}
	t.afterAction()
	return nil
}

// afterAction advances the turn or the phase after a player acts.
func (t *Table) afterAction() {
	// Win by fold-out.
	if len(t.inHandNotFolded()) == 1 {
		t.showdown()
		return
	}
	if t.bettingComplete() {
		t.advancePhase()
		return
	}
	t.Acting = t.nextActable(t.Acting)
	if t.Acting < 0 {
		t.advancePhase()
		return
	}
	t.Deadline = time.Now().Add(turnSeconds * time.Second)
}

// bettingComplete reports whether the current betting round is finished.
func (t *Table) bettingComplete() bool {
	for _, p := range t.Players {
		if p == nil || !p.InHand || p.Folded || p.AllIn {
			continue
		}
		if !p.HasActed || p.Bet != t.CurrentBet {
			return false
		}
	}
	return true
}

// advancePhase reveals the next community tiles or proceeds to showdown.
func (t *Table) advancePhase() {
	// Reset per-round betting state.
	resetRound := func() {
		t.CurrentBet = 0
		t.MinRaise = bigBlind
		for _, p := range t.Players {
			if p != nil {
				p.Bet = 0
				p.HasActed = false
			}
		}
		t.Acting = t.nextActable(t.Button)
		if t.Acting < 0 {
			// No one left to act (all-in) — keep revealing until showdown.
			t.Deadline = time.Time{}
		} else {
			t.Deadline = time.Now().Add(turnSeconds * time.Second)
		}
	}

	switch t.Phase {
	case phaseBetPreflop:
		t.dealCommunity(2)
		t.Phase = phaseBetFlop
		resetRound()
	case phaseBetFlop:
		t.dealCommunity(2)
		t.Phase = phaseBetTurn
		resetRound()
	case phaseBetTurn:
		t.dealCommunity(3)
		t.Phase = phaseBetRiver
		resetRound()
	case phaseBetRiver:
		t.showdown()
		return
	default:
		return
	}

	// If nobody can act (all remaining are all-in), auto-run to the next phase.
	if t.Acting < 0 && t.Phase != phaseShowdown {
		t.advancePhase()
	}
}

func (t *Table) dealCommunity(n int) {
	for i := 0; i < n; i++ {
		t.Community = append(t.Community, t.draw())
	}
	t.DealSeq++
}

// showdown determines the winner(s), awards the pot, and pauses.
func (t *Table) showdown() {
	contenders := t.inHandNotFolded()

	// Make sure all community tiles are out (e.g. fold-out before the river).
	for len(t.Community) < 7 && len(t.bag) > 0 {
		t.Community = append(t.Community, t.draw())
	}

	res := &handResult{Community: append([]Tile{}, t.Community...), Pot: t.Pot}

	type scored struct {
		p     *Player
		word  string
		score int
		play  *bestPlayDTO
	}
	var results []scored
	best := -1
	for _, p := range contenders {
		w, s := "", 0
		var play *bestPlayDTO
		if len(contenders) > 1 {
			// Reveal every contender's best play at showdown.
			play = computeBestPlay(p.Hole, t.Community)
			s = play.Score
			w = playWordString(play)
		}
		results = append(results, scored{p, w, s, play})
		if len(contenders) > 1 && s > best {
			best = s
		}
	}

	// Determine winners (highest score; ties split). Fold-out: sole contender.
	var winners []*Player
	if len(contenders) == 1 {
		winners = contenders
	} else {
		for _, r := range results {
			if r.score == best {
				winners = append(winners, r.p)
			}
		}
	}

	share := 0
	if len(winners) > 0 {
		share = t.Pot / len(winners)
	}
	rem := t.Pot - share*len(winners)
	// Sort winners by seat so the remainder goes to the earliest seat.
	sort.Slice(winners, func(i, j int) bool { return winners[i].Seat < winners[j].Seat })
	for i, w := range winners {
		w.Chips += share
		if i == 0 {
			w.Chips += rem
		}
	}

	winnerSet := map[*Player]bool{}
	for _, w := range winners {
		winnerSet[w] = true
	}
	for _, r := range results {
		res.Entries = append(res.Entries, showdownEntry{
			Name:  r.p.Name,
			Word:  r.word,
			Score: r.score,
			Hole:  append([]Tile{}, r.p.Hole...),
			Won:   winnerSet[r.p],
			Play:  r.play,
		})
	}

	names := make([]string, len(winners))
	for i, w := range winners {
		names[i] = w.Name
	}
	if len(contenders) == 1 {
		res.WinnerMsg = fmt.Sprintf("%s wins %d (everyone folded)", names[0], t.Pot)
	} else if len(winners) == 1 {
		for _, r := range results {
			if r.p == winners[0] {
				res.WinnerMsg = fmt.Sprintf("%s wins %d with %q (%d pts)", r.p.Name, t.Pot, r.word, r.score)
			}
		}
	} else {
		res.WinnerMsg = fmt.Sprintf("Split pot (%d each) between %s — %d pts", share, strings.Join(names, ", "), best)
	}

	t.LastResult = res
	t.Pot = 0
	t.Phase = phaseShowdown
	t.Acting = -1
	t.Deadline = time.Now().Add(handOverSeconds * time.Second)
}

// ---------------------------------------------------------------------------
// Game loop — advances timers even when no one is polling.
// ---------------------------------------------------------------------------

func runGameLoop() {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		table.tick()
	}
}

func (t *Table) tick() {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Drop disconnected players (haven't polled within the grace period).
	now := time.Now()
	for _, p := range t.Players {
		if p != nil && now.Sub(p.LastSeen) > disconnectGrace {
			t.handlePlayerLeaving(p)
		}
	}
	var keep []*Player
	for _, p := range t.Queue {
		if now.Sub(p.LastSeen) <= disconnectGrace {
			keep = append(keep, p)
		}
	}
	t.Queue = keep

	switch t.Phase {
	case phaseWaiting, phaseReady:
		// Seat any queued players; a hand only begins when someone hits Start.
		t.promoteQueue()
		if len(t.eligibleToPlay()) >= 2 {
			t.Phase = phaseReady
		} else {
			t.Phase = phaseWaiting
		}
	case phaseShowdown:
		if now.After(t.Deadline) {
			// Hand over — park until someone starts the next one (bust = spectate).
			t.promoteQueue()
			t.Acting = -1
			if len(t.eligibleToPlay()) >= 2 {
				t.Phase = phaseReady
			} else {
				t.Phase = phaseWaiting
			}
		}
	default: // a betting phase
		if t.Acting >= 0 && !t.Deadline.IsZero() && now.After(t.Deadline) {
			t.autoAct()
		}
	}
}

// autoAct performs the default action for a player who timed out: check if
// possible, otherwise fold.
func (t *Table) autoAct() {
	p := t.Players[t.Acting]
	if p == nil {
		t.Acting = t.nextActable(t.Acting)
		return
	}
	if t.CurrentBet-p.Bet > 0 {
		t.applyAction(p, "fold", 0)
	} else {
		t.applyAction(p, "check", 0)
	}
}

// handlePlayerLeaving removes a player; if they were in a live hand it folds
// them first so the hand can continue.
func (t *Table) handlePlayerLeaving(p *Player) {
	wasActing := p.Seat == t.Acting
	inLiveHand := p.InHand && !p.Folded && t.Phase != phaseWaiting && t.Phase != phaseShowdown
	if inLiveHand {
		p.Folded = true
		p.HasActed = true
	}
	t.removePlayer(p.ID)
	if inLiveHand {
		if len(t.inHandNotFolded()) == 1 {
			t.showdown()
		} else if wasActing {
			t.Acting = t.nextActable(t.Acting)
			if t.Acting < 0 || t.bettingComplete() {
				t.advancePhase()
			} else {
				t.Deadline = time.Now().Add(turnSeconds * time.Second)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// HTTP handlers
// ---------------------------------------------------------------------------

func registerHoldemRoutes() {
	loadHoldemWords()
	go runGameLoop()

	http.HandleFunc("/holdem/join", cors(holdemJoin))
	registerRoute("POST", "/holdem/join", "Join the word hold'em table")

	http.HandleFunc("/holdem/state", cors(holdemState))
	registerRoute("GET", "/holdem/state", "Get personalized table state (poll)")

	http.HandleFunc("/holdem/action", cors(holdemAction))
	registerRoute("POST", "/holdem/action", "Submit a betting action")

	http.HandleFunc("/holdem/leave", cors(holdemLeave))
	registerRoute("POST", "/holdem/leave", "Leave the table")

	http.HandleFunc("/holdem/start", cors(holdemStart))
	registerRoute("POST", "/holdem/start", "Deal the next hand (any seated player)")
}

// holdemStart deals the next hand. Any seated player may trigger it once the
// table is READY (at least two players with chips, no hand in progress).
func holdemStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.Header.Get("X-Player-ID")

	table.mu.Lock()
	defer table.mu.Unlock()

	p := table.findPlayer(id)
	if p == nil || p.Seat < 0 {
		http.Error(w, "Must be seated to start", http.StatusForbidden)
		return
	}
	if table.Phase != phaseReady {
		http.Error(w, "Cannot start now", http.StatusConflict)
		return
	}
	if len(table.eligibleToPlay()) < 2 {
		http.Error(w, "Need at least 2 players", http.StatusConflict)
		return
	}
	p.LastSeen = time.Now()
	table.startHand()

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func newPlayerID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func sanitizeName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		// random-ish fallback
		n, _ := rand.Int(rand.Reader, big.NewInt(9000))
		return fmt.Sprintf("Player%d", n.Int64()+1000)
	}
	if len(name) > 16 {
		name = name[:16]
	}
	return name
}

func holdemJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	id := r.Header.Get("X-Player-ID")
	if id == "" {
		id = newPlayerID()
	}

	table.mu.Lock()
	defer table.mu.Unlock()

	p := table.findPlayer(id)
	if p == nil {
		p = &Player{ID: id, Name: sanitizeName(body.Name), Chips: startingChips, Seat: -1}
		p.LastSeen = time.Now()
		table.seatPlayer(p)
	} else {
		// Already at the table: update name and refresh heartbeat.
		if body.Name != "" {
			p.Name = sanitizeName(body.Name)
		}
		p.LastSeen = time.Now()
	}

	seated := p.Seat >= 0
	queuePos := 0
	if !seated {
		for i, qp := range table.Queue {
			if qp.ID == id {
				queuePos = i + 1
				break
			}
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"playerId": id,
		"name":     p.Name,
		"seated":   seated,
		"seat":     p.Seat,
		"queuePos": queuePos,
	})
}

// --- state snapshot DTOs ---

type seatDTO struct {
	Seat     int    `json:"seat"`
	Name     string `json:"name"`
	Chips    int    `json:"chips"`
	Bet      int    `json:"bet"`
	Folded   bool   `json:"folded"`
	AllIn    bool   `json:"allIn"`
	InHand   bool   `json:"inHand"`
	IsYou    bool   `json:"isYou"`
	IsTurn   bool   `json:"isTurn"`
	IsButton bool   `json:"isButton"`
	Hole     []Tile `json:"hole"` // populated only for you (or at showdown)
}

type stateDTO struct {
	Phase      string      `json:"phase"`
	Seats      []seatDTO   `json:"seats"`
	Community  []Tile      `json:"community"`
	Pot        int         `json:"pot"`
	CurrentBet int         `json:"currentBet"`
	Joined     bool        `json:"joined"`
	Seated     bool        `json:"seated"`
	QueuePos   int         `json:"queuePos"`
	QueueLen   int         `json:"queueLen"`
	YourTurn   bool        `json:"yourTurn"`
	ToCall     int         `json:"toCall"`
	MinRaise   int         `json:"minRaise"`
	MaxBet     int         `json:"maxBet"`
	YourChips  int         `json:"yourChips"`
	TimeLeftMs int64       `json:"timeLeftMs"`
	Result     *handResult `json:"result"`
	MaxSeats   int         `json:"maxSeats"`
	CanStart   bool        `json:"canStart"` // you may deal the next hand
	// Your current best play (words spelled in tiles) from your hole tiles + the
	// revealed community tiles.
	BestPlay *bestPlayDTO `json:"bestPlay"`
	// Event counters for client sound effects.
	ActionSeq      int    `json:"actionSeq"`
	LastActionType string `json:"lastActionType"`
	DealSeq        int    `json:"dealSeq"`
}

func holdemState(w http.ResponseWriter, r *http.Request) {
	id := r.Header.Get("X-Player-ID")

	table.mu.Lock()
	defer table.mu.Unlock()

	me := table.findPlayer(id)
	if me != nil {
		me.LastSeen = time.Now()
	}

	st := stateDTO{
		Phase:          table.Phase,
		Community:      table.Community,
		Pot:            table.Pot,
		CurrentBet:     table.CurrentBet,
		MinRaise:       table.MinRaise,
		MaxSeats:       maxSeats,
		Result:         table.LastResult,
		ActionSeq:      table.ActionSeq,
		LastActionType: table.LastActionType,
		DealSeq:        table.DealSeq,
	}
	if st.Community == nil {
		st.Community = []Tile{}
	}

	showdownOpen := table.Phase == phaseShowdown
	for i, p := range table.Players {
		if p == nil {
			continue
		}
		s := seatDTO{
			Seat:     i,
			Name:     p.Name,
			Chips:    p.Chips,
			Bet:      p.Bet,
			Folded:   p.Folded,
			AllIn:    p.AllIn,
			InHand:   p.InHand,
			IsYou:    me != nil && p.ID == me.ID,
			IsTurn:   table.Acting == i,
			IsButton: table.Button == i && table.Phase != phaseWaiting,
		}
		// Reveal hole tiles only to the owner, or to everyone at showdown
		// for players who reached the showdown (in hand, not folded).
		if s.IsYou || (showdownOpen && p.InHand && !p.Folded) {
			s.Hole = p.Hole
		}
		st.Seats = append(st.Seats, s)
	}

	if me != nil {
		st.Joined = true
		st.Seated = me.Seat >= 0
		st.YourChips = me.Chips
		st.CanStart = st.Seated && table.Phase == phaseReady && len(table.eligibleToPlay()) >= 2
		// Best play right now from your hole tiles + the revealed community.
		if me.InHand && !me.Folded && len(me.Hole) > 0 {
			st.BestPlay = computeBestPlay(me.Hole, table.Community)
		}
		if !st.Seated {
			for qi, qp := range table.Queue {
				if qp.ID == me.ID {
					st.QueuePos = qi + 1
				}
			}
		}
		if table.Acting >= 0 && table.Players[table.Acting] == me {
			st.YourTurn = true
			st.ToCall = table.CurrentBet - me.Bet
			st.MaxBet = me.Bet + me.Chips // total your bet can reach
			if !table.Deadline.IsZero() {
				st.TimeLeftMs = time.Until(table.Deadline).Milliseconds()
				if st.TimeLeftMs < 0 {
					st.TimeLeftMs = 0
				}
			}
		}
	}
	st.QueueLen = len(table.Queue)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(st)
}

func holdemAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	id := r.Header.Get("X-Player-ID")
	var body struct {
		Action string `json:"action"`
		Amount int    `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	table.mu.Lock()
	defer table.mu.Unlock()

	if table.Acting < 0 || table.Players[table.Acting] == nil || table.Players[table.Acting].ID != id {
		http.Error(w, "Not your turn", http.StatusConflict)
		return
	}
	p := table.Players[table.Acting]
	p.LastSeen = time.Now()
	if err := table.applyAction(p, body.Action, body.Amount); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}

func holdemLeave(w http.ResponseWriter, r *http.Request) {
	id := r.Header.Get("X-Player-ID")
	table.mu.Lock()
	defer table.mu.Unlock()
	if p := table.findPlayer(id); p != nil {
		table.handlePlayerLeaving(p)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}
