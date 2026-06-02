package main

import (
	"math"
	"testing"
)

func TestPointBlocked(t *testing.T) {
	cases := []struct {
		name    string
		x, y    float64
		blocked bool
	}{
		{"open left-top room", 150, 120, false},
		{"inside vertical divider 1", 300, 40, true},
		{"inside horizontal divider", 300, 270, true},
		{"doorway in divider 1 (y gap)", 300, 135, false},
		{"doorway in horizontal (x gap)", 150, 270, false},
		{"open right-bottom room", 760, 450, false},
	}
	for _, c := range cases {
		if got := pointBlocked(c.x, c.y); got != c.blocked {
			t.Errorf("%s: pointBlocked(%g,%g)=%v, want %v", c.name, c.x, c.y, got, c.blocked)
		}
	}
}

func TestSpawnNeverInWall(t *testing.T) {
	for i := 0; i < 2000; i++ {
		x, y := voiceSpawn()
		if pointBlocked(x, y) {
			t.Fatalf("voiceSpawn returned a blocked position (%g,%g)", x, y)
		}
	}
}

func TestDoorwaysArePassable(t *testing.T) {
	// Each doorway's clear center span must exceed the avatar diameter so a
	// player can actually fit through.
	const diameter = 2 * voicePlayerRadius
	doors := []struct {
		name           string
		fixed          float64 // the coordinate held constant across the doorway
		from, to       float64 // the gap span to scan
		horizontalScan bool    // true: vary x at fixed y; false: vary y at fixed x
	}{
		{"divider 1 top gap", 300, 85, 185, false},
		{"divider 2 top gap", 600, 85, 185, false},
		{"horizontal left gap", 270, 100, 200, true},
		{"horizontal middle gap", 270, 400, 500, true},
		{"horizontal right gap", 270, 700, 800, true},
	}
	for _, d := range doors {
		clear := 0.0
		for v := d.from; v <= d.to; v++ {
			var blocked bool
			if d.horizontalScan {
				blocked = pointBlocked(v, d.fixed)
			} else {
				blocked = pointBlocked(d.fixed, v)
			}
			if !blocked {
				clear++
			}
		}
		if clear < diameter {
			t.Errorf("%s: only %g clear units, need >= %d", d.name, clear, diameter)
		}
	}
}

func TestProximityGain(t *testing.T) {
	at := func(x, y float64) *voicePlayer { return &voicePlayer{x: x, y: y} }
	l := at(0, 0)

	if g := proximityGain(l, at(50, 0)); g != 1 {
		t.Errorf("inside full radius: got %v, want 1", g)
	}
	if g := proximityGain(l, at(500, 0)); g != 0 {
		t.Errorf("beyond silence radius: got %v, want 0", g)
	}
	// Midpoint of the falloff band: t=0.5 -> smoothstep=0.5 -> gain=0.5.
	mid := (voiceFullRadius + voiceSilenceRadius) / 2.0
	if g := proximityGain(l, at(mid, 0)); math.Abs(g-0.5) > 1e-9 {
		t.Errorf("falloff midpoint: got %v, want 0.5", g)
	}
	// Gain must decrease monotonically with distance across the band.
	prev := 1.1
	for d := float64(voiceFullRadius); d <= voiceSilenceRadius; d += 5 {
		g := proximityGain(l, at(d, 0))
		if g > prev+1e-9 {
			t.Errorf("gain not monotonic at d=%g: %v > %v", d, g, prev)
		}
		prev = g
	}
}
