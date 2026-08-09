package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// TestMCPSmoke stands up the MCP handler over HTTP and drives each read-only
// tool through a real MCP client, asserting the tools are registered and return
// sensible results from the on-disk content index / data files.
func TestMCPSmoke(t *testing.T) {
	server := newMCPServer()
	handler := mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server { return server }, nil)
	ts := httptest.NewServer(mcpCORS(handler))
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	client := mcp.NewClient(&mcp.Implementation{Name: "smoke-test", Version: "0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: ts.URL}, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer session.Close()

	// tools/list
	tools, err := session.ListTools(ctx, &mcp.ListToolsParams{})
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	got := map[string]bool{}
	for _, tl := range tools.Tools {
		got[tl.Name] = true
	}
	for _, want := range []string{"search_content", "get_page", "list_projects", "list_photos", "get_training_status", "get_race_result"} {
		if !got[want] {
			t.Errorf("missing tool %q", want)
		}
	}

	call := func(name string, args map[string]any) string {
		t.Helper()
		res, err := session.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatalf("call %s: %v", name, err)
		}
		if res.IsError {
			t.Fatalf("call %s returned error: %s", name, text(res))
		}
		return text(res)
	}

	if out := call("search_content", map[string]any{"query": "cosmic ray memory"}); !strings.Contains(out, "/blogs/bitflip/") {
		t.Errorf("search_content did not find bitflip blog; got: %s", out)
	}
	if out := call("get_page", map[string]any{"url": "/blogs/recall/"}); !strings.Contains(strings.ToLower(out), "recall") {
		t.Errorf("get_page recall unexpected: %s", out)
	}
	if out := call("list_projects", map[string]any{}); !strings.Contains(out, "href") {
		t.Errorf("list_projects unexpected: %s", out)
	}
	if out := call("list_photos", map[string]any{"location": "Taiwan"}); !strings.Contains(out, "Taiwan") {
		t.Errorf("list_photos Taiwan unexpected: %s", out)
	}
	if out := call("get_training_status", map[string]any{}); !strings.Contains(out, "counts_by_type") {
		t.Errorf("get_training_status unexpected: %s", out)
	}
	if out := call("get_race_result", map[string]any{}); !strings.Contains(out, "total_finishers") {
		t.Errorf("get_race_result unexpected: %s", out)
	}
}

func text(res *mcp.CallToolResult) string {
	var b strings.Builder
	for _, c := range res.Content {
		if tc, ok := c.(*mcp.TextContent); ok {
			b.WriteString(tc.Text)
		}
	}
	return b.String()
}
