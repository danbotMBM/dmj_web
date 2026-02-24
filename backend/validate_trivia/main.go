package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
)

type TriviaAnswer struct {
	Valid []string `json:"valid"`
}

type TriviaQuestion struct {
	ID       string       `json:"id"`
	Category string       `json:"category"`
	Points   int          `json:"points"`
	Question string       `json:"question"`
	Answer   TriviaAnswer `json:"answer"`
	Display  string       `json:"display"`
}

type TriviaDay struct {
	Date       string           `json:"date"`
	Categories []string         `json:"categories"`
	Questions  []TriviaQuestion `json:"questions"`
}

type TriviaData struct {
	Days []TriviaDay `json:"days"`
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "ERROR: "+format+"\n", args...)
	os.Exit(1)
}

func main() {
	path := "trivia_questions.json"
	if len(os.Args) > 1 {
		path = os.Args[1]
	}

	data, err := os.ReadFile(path)
	if err != nil {
		fail("cannot read %s: %v", path, err)
	}

	var trivia TriviaData
	if err := json.Unmarshal(data, &trivia); err != nil {
		fail("invalid JSON in %s: %v", path, err)
	}

	if len(trivia.Days) == 0 {
		fail("no days found in %s", path)
	}

	seenDates := make(map[string]bool)
	seenIDs := make(map[string]bool)
	errCount := 0

	bad := func(format string, args ...any) {
		fmt.Fprintf(os.Stderr, "  ERROR: "+format+"\n", args...)
		errCount++
	}

	for di, day := range trivia.Days {
		prefix := fmt.Sprintf("day[%d] (%s)", di, day.Date)

		// Date format
		if !dateRe.MatchString(day.Date) {
			bad("%s: invalid date format, expected YYYY-MM-DD", prefix)
		}

		// Duplicate dates
		if seenDates[day.Date] {
			bad("%s: duplicate date", prefix)
		}
		seenDates[day.Date] = true

		// Exactly 3 categories
		if len(day.Categories) != 3 {
			bad("%s: expected 3 categories, got %d", prefix, len(day.Categories))
		}
		for ci, cat := range day.Categories {
			if cat == "" {
				bad("%s: category[%d] is empty", prefix, ci)
			}
		}

		// Exactly 9 questions
		if len(day.Questions) != 9 {
			bad("%s: expected 9 questions, got %d", prefix, len(day.Questions))
		}

		// Build a set of valid categories for quick lookup
		catSet := make(map[string]bool)
		for _, c := range day.Categories {
			catSet[c] = true
		}

		// Track points per category: category -> set of points seen
		catPoints := make(map[string]map[int]bool)
		for _, c := range day.Categories {
			catPoints[c] = make(map[int]bool)
		}

		validPoints := map[int]bool{100: true, 200: true, 300: true}

		for qi, q := range day.Questions {
			qprefix := fmt.Sprintf("%s question[%d] (id=%q)", prefix, qi, q.ID)

			// ID non-empty
			if q.ID == "" {
				bad("%s: id is empty", qprefix)
			}

			// ID uniqueness
			if seenIDs[q.ID] {
				bad("%s: duplicate id", qprefix)
			}
			seenIDs[q.ID] = true

			// Expected ID pattern: YYYY-MM-DD_N
			expectedID := fmt.Sprintf("%s_%d", day.Date, qi)
			if q.ID != expectedID {
				bad("%s: expected id %q", qprefix, expectedID)
			}

			// Category must be in day's categories
			if !catSet[q.Category] {
				bad("%s: category %q not in day categories %v", qprefix, q.Category, day.Categories)
			}

			// Points must be 100, 200, or 300
			if !validPoints[q.Points] {
				bad("%s: invalid points value %d (must be 100, 200, or 300)", qprefix, q.Points)
			}

			// Track points per category for duplicate detection
			if catPoints[q.Category][q.Points] {
				bad("%s: duplicate points value %d for category %q", qprefix, q.Points, q.Category)
			}
			if catSet[q.Category] {
				catPoints[q.Category][q.Points] = true
			}

			// Question text non-empty
			if q.Question == "" {
				bad("%s: question text is empty", qprefix)
			}

			// At least one valid answer, all non-empty
			if len(q.Answer.Valid) == 0 {
				bad("%s: answer.valid is empty", qprefix)
			}
			for ai, ans := range q.Answer.Valid {
				if ans == "" {
					bad("%s: answer.valid[%d] is empty", qprefix, ai)
				}
			}

			// Display non-empty
			if q.Display == "" {
				bad("%s: display is empty", qprefix)
			}
		}

		// Each category must have all three point values
		for _, cat := range day.Categories {
			for _, pts := range []int{100, 200, 300} {
				if !catPoints[cat][pts] {
					bad("%s: category %q missing %d-point question", prefix, cat, pts)
				}
			}
		}
	}

	if errCount > 0 {
		fmt.Fprintf(os.Stderr, "\ntrivia_questions.json validation FAILED: %d error(s) found.\n", errCount)
		os.Exit(1)
	}

	fmt.Printf("trivia_questions.json OK — %d days, %d questions validated.\n", len(trivia.Days), len(trivia.Days)*9)
}
