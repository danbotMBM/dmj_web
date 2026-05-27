package main

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func tiles(letters ...string) []Tile {
	out := make([]Tile, len(letters))
	for i, l := range letters {
		out[i] = Tile{Letter: l, Points: letterPoints[l[0]-'A']}
	}
	return out
}

func TestValidateWord(t *testing.T) {
	hole := tiles("C", "A", "T")
	community := tiles("S", "D", "O", "G", "E", "R", "N")

	// A real word formable from the tiles, scored as the sum of letter points.
	word, score, err := validateWord("cats", hole, community)
	if err != nil {
		t.Fatalf("CATS should be valid: %v", err)
	}
	if word != "CATS" {
		t.Fatalf("normalized word = %q, want CATS", word)
	}
	if want := scoreWord("CATS"); score != want {
		t.Fatalf("score = %d, want %d", score, want)
	}

	// Not in the dictionary.
	if _, _, err := validateWord("ctas", hole, community); err == nil {
		t.Fatalf("CTAS should be rejected as a non-word")
	}

	// A real word, but we don't hold the tiles for it.
	if _, _, err := validateWord("zebra", hole, community); err == nil {
		t.Fatalf("ZEBRA should be rejected — tiles unavailable")
	}

	// Too short.
	if _, _, err := validateWord("a", hole, community); err == nil {
		t.Fatalf("single letter should be rejected")
	}
}

func TestComputePlayForWord(t *testing.T) {
	hole := tiles("C", "A", "T")
	community := tiles("S", "D", "O")
	play := computePlayForWord("CATS", hole, community)
	if play == nil {
		t.Fatal("expected a play for CATS")
	}
	if play.Score != scoreWord("CATS") {
		t.Fatalf("play score = %d, want %d", play.Score, scoreWord("CATS"))
	}
	// S is the only community tile used (index 0).
	if !play.UsedCommunity[0] || play.UsedCommunity[1] || play.UsedCommunity[2] {
		t.Fatalf("unexpected community usage: %v", play.UsedCommunity)
	}
	if len(play.Words) != 1 || len(play.Words[0]) != 4 {
		t.Fatalf("expected one 4-tile word, got %v", play.Words)
	}
}

// A 2+ contender showdown opens the submit window (CPU words assigned, human's
// pending), and finalizing scores the kept words and conserves chips.
func TestShowdownSubmitFlow(t *testing.T) {
	tbl := &Table{Phase: phaseBetRiver, Acting: -1}
	human := &Player{ID: "h", Name: "Human", Chips: 980, InHand: true, Hole: tiles("C", "A", "T")}
	cpu := &Player{ID: "c", Name: "Bot", Chips: 980, InHand: true,
		IsCPU: true, Difficulty: cpuHigh, Hole: tiles("D", "O", "G")}
	tbl.Players[0] = human
	tbl.Players[1] = cpu
	tbl.Community = tiles("S", "E", "R", "N", "I", "P", "L")
	tbl.Pot = 40
	want := totalChips(tbl)

	tbl.enterShowdown()
	if tbl.Phase != phaseShowdownSubmit {
		t.Fatalf("phase = %s, want SHOWDOWN_SUBMIT", tbl.Phase)
	}
	if cpu.SubmittedWord == "" {
		t.Fatalf("CPU should have locked a word at showdown")
	}
	if human.SubmittedWord != "" {
		t.Fatalf("human word should still be pending")
	}

	// Human submits a strong word.
	w, s, err := validateWord("cares", human.Hole, tbl.Community)
	if err != nil {
		t.Fatalf("CARES should validate: %v", err)
	}
	human.SubmittedWord, human.SubmittedScore = w, s

	tbl.finalizeShowdown()
	if tbl.Phase != phaseShowdown {
		t.Fatalf("phase = %s, want SHOWDOWN", tbl.Phase)
	}
	if tbl.Pot != 0 {
		t.Fatalf("pot should be awarded, got %d", tbl.Pot)
	}
	if got := totalChips(tbl); got != want {
		t.Fatalf("chips not conserved: got %d want %d", got, want)
	}
	if tbl.LastResult == nil || len(tbl.LastResult.Entries) != 2 {
		t.Fatalf("expected 2 showdown entries")
	}
}

// The server keeps the highest-scoring submission; lower words are rejected and
// a tie replaces the stored word.
func TestSubmitKeepsHighest(t *testing.T) {
	table = &Table{Phase: phaseBetRiver, Acting: -1}
	table.Players[0] = &Player{ID: "h", Name: "H", Chips: 1000, InHand: true, Hole: tiles("C", "A", "T")}
	table.Community = tiles("S", "E", "R", "N", "I", "P", "L")

	submit := func(word string) (int, map[string]any) {
		body, _ := json.Marshal(map[string]string{"word": word})
		req := httptest.NewRequest("POST", "/holdem/word", bytes.NewReader(body))
		req.Header.Set("X-Player-ID", "h")
		rec := httptest.NewRecorder()
		holdemWord(rec, req)
		var out map[string]any
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	if code, out := submit("cat"); code != 200 || out["word"] != "CAT" {
		t.Fatalf("CAT submit: code=%d out=%v", code, out)
	}
	// Higher word replaces.
	if code, out := submit("cares"); code != 200 || out["word"] != "CARES" {
		t.Fatalf("CARES submit: code=%d out=%v", code, out)
	}
	// Lower word is kept out (CAT < CARES).
	if code, out := submit("cat"); code != 200 || out["word"] != "CARES" || out["replaced"] != false {
		t.Fatalf("lower resubmit should keep CARES: code=%d out=%v", code, out)
	}
	// A tie (RACES == CARES) substitutes the stored word.
	if code, out := submit("races"); code != 200 || out["word"] != "RACES" || out["replaced"] != true {
		t.Fatalf("tie should replace with RACES: code=%d out=%v", code, out)
	}
	// A non-word is rejected.
	if code, _ := submit("ctas"); code != 400 {
		t.Fatalf("non-word should be 400, got %d", code)
	}
}

// Across many deals, the average word a CPU submits should rise with difficulty.
func TestCPUWordScalesWithDifficulty(t *testing.T) {
	avg := func(diff string) float64 {
		tbl := &Table{Phase: phaseBetRiver, Acting: -1}
		p := &Player{ID: "x", Difficulty: diff, InHand: true,
			Hole: tiles("Q", "U", "A")}
		tbl.Players[0] = p
		tbl.Community = tiles("R", "T", "Z", "E", "S", "I", "N")

		const trials = 400
		total := 0
		for i := 0; i < trials; i++ {
			_, sc := tbl.cpuChooseWord(p)
			total += sc
		}
		return float64(total) / trials
	}

	low, med, high := avg(cpuLow), avg(cpuMedium), avg(cpuHigh)
	if !(low < med && med < high) {
		t.Fatalf("expected low < medium < high average word scores, got %.1f / %.1f / %.1f",
			low, med, high)
	}
}
