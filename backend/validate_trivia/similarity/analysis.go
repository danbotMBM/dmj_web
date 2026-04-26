package similarity

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

type PairScore struct {
	IDA        string  `json:"id_a"`
	TextA      string  `json:"text_a"`
	IDB        string  `json:"id_b"`
	TextB      string  `json:"text_b"`
	Similarity float64 `json:"similarity"`
}

// ComputeAllPairs fetches embeddings once and returns all pairwise similarity
// scores, sorted by similarity descending.
func ComputeAllPairs(questions []QuestionRef) ([]PairScore, error) {
	model := EmbedModel()
	fmt.Printf("Fetching embeddings for %d questions (model: %s)...\n", len(questions), model)

	texts := make([]string, len(questions))
	for i, q := range questions {
		texts[i] = q.Text
	}

	embeddings, err := FetchEmbeddings(texts)
	if err != nil {
		return nil, err
	}

	var pairs []PairScore
	for i := 0; i < len(questions); i++ {
		for j := i + 1; j < len(questions); j++ {
			sim := CosineSimilarity(embeddings[i], embeddings[j])
			pairs = append(pairs, PairScore{
				IDA:        questions[i].ID,
				TextA:      questions[i].Text,
				IDB:        questions[j].ID,
				TextB:      questions[j].Text,
				Similarity: sim,
			})
		}
	}

	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i].Similarity > pairs[j].Similarity
	})

	return pairs, nil
}

// SaveReport writes all pairwise scores to a JSON file.
func SaveReport(pairs []PairScore, path string) error {
	data, err := json.MarshalIndent(pairs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

// LoadReport reads a previously saved pairwise report from disk.
func LoadReport(path string) ([]PairScore, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var pairs []PairScore
	if err := json.Unmarshal(data, &pairs); err != nil {
		return nil, err
	}
	return pairs, nil
}

// PrintSummary prints the top N most similar pairs and basic distribution stats.
func PrintSummary(pairs []PairScore, topN int) {
	if len(pairs) == 0 {
		fmt.Println("No pairs to analyze.")
		return
	}

	fmt.Printf("\n=== Similarity Report (%d total pairs) ===\n", len(pairs))

	// Distribution buckets
	buckets := map[string]int{
		"0.90-1.00": 0,
		"0.80-0.90": 0,
		"0.70-0.80": 0,
		"0.60-0.70": 0,
		"< 0.60":    0,
	}
	var sum float64
	for _, p := range pairs {
		sum += p.Similarity
		switch {
		case p.Similarity >= 0.90:
			buckets["0.90-1.00"]++
		case p.Similarity >= 0.80:
			buckets["0.80-0.90"]++
		case p.Similarity >= 0.70:
			buckets["0.70-0.80"]++
		case p.Similarity >= 0.60:
			buckets["0.60-0.70"]++
		default:
			buckets["< 0.60"]++
		}
	}

	avg := sum / float64(len(pairs))
	fmt.Printf("\nDistribution:\n")
	for _, label := range []string{"0.90-1.00", "0.80-0.90", "0.70-0.80", "0.60-0.70", "< 0.60"} {
		fmt.Printf("  %s: %d pairs\n", label, buckets[label])
	}
	fmt.Printf("\nAverage similarity: %.4f\n", avg)
	fmt.Printf("Most similar:  %.4f\n", pairs[0].Similarity)
	fmt.Printf("Least similar: %.4f\n", pairs[len(pairs)-1].Similarity)

	if topN > len(pairs) {
		topN = len(pairs)
	}
	fmt.Printf("\nTop %d most similar pairs:\n", topN)
	for i := 0; i < topN; i++ {
		p := pairs[i]
		fmt.Printf("  %.4f  [%s] %q\n         [%s] %q\n",
			p.Similarity, p.IDA, p.TextA, p.IDB, p.TextB)
	}
}
