package main

import (
	"math/rand"
	"testing"
)

func init() { loadHoldemWords() }

func randTiles(n int) []Tile {
	bag := newBag()
	return bag[:n]
}

// bestScoreOnly must agree with the existing solveTiles score.
func TestBestScoreOnlyMatchesSolver(t *testing.T) {
	for i := 0; i < 500; i++ {
		tiles := randTiles(2 + rand.Intn(9)) // 2..10 tiles
		_, _, want := solveTiles(tiles)
		got := bestScoreOnly(tiles)
		if got != want {
			t.Fatalf("score mismatch: got %d want %d tiles=%v", got, want, tiles)
		}
	}
}

// remainingTiles must exclude exactly the seen tiles, leaving the rest of the
// bag. We derive the expected count from the bag itself so the test tracks the
// letter distribution rather than a hardcoded total.
func TestRemainingTiles(t *testing.T) {
	bag := newBag()
	seen := bag[:10]
	rem := remainingTiles(seen)
	if len(rem) != len(bag)-len(seen) {
		t.Fatalf("remaining count = %d, want %d", len(rem), len(bag)-len(seen))
	}
}

func newTableWithCPUs(diffs ...string) *Table {
	tbl := &Table{Phase: phaseWaiting, Acting: -1}
	for _, d := range diffs {
		if _, err := tbl.addCPU(d); err != nil {
			panic(err)
		}
	}
	return tbl
}

func totalChips(t *Table) int {
	sum := t.Pot
	for _, p := range t.Players {
		if p != nil {
			sum += p.Chips
		}
	}
	return sum
}

// A full CPU-only hand should complete with only legal actions and conserve
// chips. We drive decisions directly to bypass the wall-clock think delay.
func TestCPUHandCompletesAndConservesChips(t *testing.T) {
	for trial := 0; trial < 40; trial++ {
		tbl := newTableWithCPUs(cpuLow, cpuMedium, cpuHigh)
		want := totalChips(tbl)
		tbl.startHand()

		guard := 0
		for tbl.Phase != phaseShowdown {
			if tbl.Acting < 0 {
				t.Fatalf("trial %d: no actor in phase %s", trial, tbl.Phase)
			}
			p := tbl.Players[tbl.Acting]
			action, amount := tbl.cpuDecide(p)
			if err := tbl.applyAction(p, action, amount); err != nil {
				t.Fatalf("trial %d: illegal action %s/%d by %s: %v", trial, action, amount, p.Name, err)
			}
			if guard++; guard > 500 {
				t.Fatalf("trial %d: hand did not terminate (phase %s)", trial, tbl.Phase)
			}
		}
		if got := totalChips(tbl); got != want {
			t.Fatalf("trial %d: chips not conserved: got %d want %d", trial, got, want)
		}
	}
}

// Equity is always a probability, and a CPU holding three high-value tiles
// should beat a baseline of three 1-point tiles on a neutral board.
func TestEquityWellFormedAndOrdered(t *testing.T) {
	strong := []Tile{{"Q", 10, false}, {"U", 1, false}, {"I", 1, false}}
	weak := []Tile{{"V", 4, false}, {"V", 4, false}, {"W", 4, false}}

	tbl := &Table{Phase: phaseBetFlop, Acting: -1}
	tbl.Players[0] = &Player{ID: "a", Name: "A", Chips: 1000, Hole: strong, InHand: true}
	tbl.Players[1] = &Player{ID: "b", Name: "B", Chips: 1000, Hole: weak, InHand: true}
	tbl.Community = []Tile{{"A", 1, false}, {"T", 1, false}}

	eqStrong := tbl.cpuEquity(tbl.Players[0], 1200)
	eqWeak := tbl.cpuEquity(tbl.Players[1], 1200)

	for _, e := range []float64{eqStrong, eqWeak} {
		if e < 0 || e > 1 {
			t.Fatalf("equity out of range: %v", e)
		}
	}
	if eqStrong <= eqWeak {
		t.Fatalf("expected strong hole (QUI) to out-equity weak (VVW): %.3f vs %.3f", eqStrong, eqWeak)
	}
}
