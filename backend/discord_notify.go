package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	defaultDiscordWebhookFile = "discord_webhook.txt"
	joinNotifyCooldown        = 10 * time.Minute
	discordMaxContent         = 2000
)

func discordWebhookFile() string {
	if p := os.Getenv("DISCORD_WEBHOOK_FILE"); p != "" {
		return p
	}
	return defaultDiscordWebhookFile
}

var (
	discordOnce    sync.Once
	discordURL     string
	discordLoadErr error
)

func discordWebhookURL() (string, error) {
	discordOnce.Do(func() {
		data, err := os.ReadFile(discordWebhookFile())
		if err != nil {
			discordLoadErr = fmt.Errorf("read %s: %w", discordWebhookFile(), err)
			return
		}
		url := strings.TrimSpace(string(data))
		if url == "" {
			discordLoadErr = fmt.Errorf("%s is empty", discordWebhookFile())
			return
		}
		if !strings.HasPrefix(url, "https://discord.com/") &&
			!strings.HasPrefix(url, "https://discordapp.com/") {
			discordLoadErr = fmt.Errorf("webhook URL doesn't look like a Discord webhook: %q", url)
			return
		}
		discordURL = url
	})
	return discordURL, discordLoadErr
}

type rosterEntry struct {
	Name       string
	IsCPU      bool
	Difficulty string
	Seated     bool
}

var (
	joinNotifyMu   sync.Mutex
	joinNotifyLast = map[string]time.Time{}
)

// notifyPlayerJoined posts to a Discord webhook that joinerName took a seat.
// Throttled per playerID. Fire-and-forget: never blocks gameplay.
func notifyPlayerJoined(joinerID, joinerName string, others []rosterEntry) {
	joinNotifyMu.Lock()
	if last, ok := joinNotifyLast[joinerID]; ok && time.Since(last) < joinNotifyCooldown {
		joinNotifyMu.Unlock()
		return
	}
	joinNotifyLast[joinerID] = time.Now()
	joinNotifyMu.Unlock()

	content := buildJoinMessage(joinerName, others)

	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Fprintf(os.Stderr, "notifyPlayerJoined panic: %v\n", r)
			}
		}()
		if err := postDiscord(content); err != nil {
			fmt.Fprintf(os.Stderr, "discord notify error: %v\n", err)
		}
	}()
}

func buildJoinMessage(joinerName string, others []rosterEntry) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "**%s** joined Texas Tile Tussle.\n\n", joinerName)
	if len(others) == 0 {
		sb.WriteString("They're the only one at the table right now.\n")
	} else {
		fmt.Fprintf(&sb, "Players at the table now (%d):\n", len(others))
		for _, r := range others {
			label := r.Name
			if label == "" {
				label = "(unnamed)"
			}
			where := "seated"
			if !r.Seated {
				where = "queued"
			}
			if r.IsCPU {
				diff := r.Difficulty
				if diff == "" {
					diff = "bot"
				}
				fmt.Fprintf(&sb, "• %s (%s, CPU %s)\n", label, where, diff)
			} else {
				fmt.Fprintf(&sb, "• %s (%s)\n", label, where)
			}
		}
	}
	sb.WriteString("\n<https://danbotlab/games/holdem/>")

	msg := sb.String()
	if len(msg) > discordMaxContent {
		msg = msg[:discordMaxContent-1] + "…"
	}
	return msg
}

func postDiscord(content string) error {
	url, err := discordWebhookURL()
	if err != nil {
		return err
	}
	body, _ := json.Marshal(map[string]string{
		"content":  content,
		"username": "Texas Tile Tussle",
	})
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("discord webhook %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}
