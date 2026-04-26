package similarity

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
)

type QuestionRef struct {
	ID      string
	Text    string
	Answers []string // lowercase valid answers
}

type ollamaEmbedRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type ollamaEmbedResponse struct {
	Embeddings [][]float64 `json:"embeddings"`
}

func OllamaHost() string {
	if h := os.Getenv("OLLAMA_HOST"); h != "" {
		return h
	}
	return "http://localhost:11434"
}

func EmbedModel() string {
	if m := os.Getenv("EMBED_MODEL"); m != "" {
		return m
	}
	return "nomic-embed-text"
}

func SimilarityThreshold() float64 {
	if s := os.Getenv("SIMILARITY_THRESHOLD"); s != "" {
		if v, err := strconv.ParseFloat(s, 64); err == nil {
			return v
		}
	}
	return 0.92
}

func FetchEmbeddings(texts []string) ([][]float64, error) {
	body, err := json.Marshal(ollamaEmbedRequest{Model: EmbedModel(), Input: texts})
	if err != nil {
		return nil, err
	}

	url := OllamaHost() + "/api/embed"
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("cannot reach Ollama at %s: %w", url, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Ollama returned %d: %s", resp.StatusCode, raw)
	}

	var er ollamaEmbedResponse
	if err := json.Unmarshal(raw, &er); err != nil {
		return nil, fmt.Errorf("decode Ollama response: %w", err)
	}
	if len(er.Embeddings) != len(texts) {
		return nil, fmt.Errorf("expected %d embeddings, got %d", len(texts), len(er.Embeddings))
	}
	return er.Embeddings, nil
}

func CosineSimilarity(a, b []float64) float64 {
	var dot, normA, normB float64
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

func shareAnswer(a, b []string) bool {
	for _, ans := range a {
		for _, bans := range b {
			if strings.EqualFold(ans, bans) {
				return true
			}
		}
	}
	return false
}

func CheckSemanticDuplicates(questions []QuestionRef) (warnCount int) {
	threshold := SimilarityThreshold()
	model := EmbedModel()

	fmt.Printf("Fetching embeddings for %d questions (model: %s)...\n", len(questions), model)

	texts := make([]string, len(questions))
	for i, q := range questions {
		texts[i] = q.Text
	}

	embeddings, err := FetchEmbeddings(texts)
	if err != nil {
		fmt.Fprintf(os.Stderr, "WARNING: semantic check skipped: %v\n", err)
		fmt.Fprintf(os.Stderr, "  (Is Ollama running? Try: ollama serve && ollama pull %s)\n", model)
		return 0
	}

	for i := 0; i < len(questions); i++ {
		for j := i + 1; j < len(questions); j++ {
			sim := CosineSimilarity(embeddings[i], embeddings[j])
			if sim >= threshold {
				fmt.Fprintf(os.Stderr,
					"WARNING: near-duplicate questions (similarity=%.3f)\n  [%s] %q\n  [%s] %q\n",
					sim,
					questions[i].ID, questions[i].Text,
					questions[j].ID, questions[j].Text,
				)
				warnCount++
			}

			// Questions that share an answer must be sufficiently distinct (< 0.75).
			if shareAnswer(questions[i].Answers, questions[j].Answers) && sim >= 0.75 {
				fmt.Fprintf(os.Stderr,
					"WARNING: same-answer questions too similar (similarity=%.3f, need < 0.75)\n  [%s] %q\n  [%s] %q\n",
					sim,
					questions[i].ID, questions[i].Text,
					questions[j].ID, questions[j].Text,
				)
				warnCount++
			}
		}
	}
	return warnCount
}
