package main

// pmwatch.go — dependency watcher. mixxx mode needs push-manager (screen
// over usb, POST /api/display/direct). Poll GET /api/display/status, log
// only when the state changes, so a missing dependency shows in the log.

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

const (
	pmStatusURL   = "http://127.0.0.1:7701/api/display/status"
	pmWatchPeriod = 30 * time.Second
)

// pmState classifies one status poll. ok means push-manager answers and has
// direct mode; the other values say what is missing.
func pmState(get func(string) (*http.Response, error)) string {
	resp, err := get(pmStatusURL)
	if err != nil {
		return "push-manager unreachable (is it installed and running on port 7701?)"
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "push-manager answered " + resp.Status + " on /api/display/status"
	}
	var st map[string]any
	if json.NewDecoder(resp.Body).Decode(&st) != nil {
		return "push-manager sent an unreadable /api/display/status"
	}
	if _, has := st["direct"]; !has {
		return "push-manager has no direct mode (update Push Hack: needs POST /api/display/direct)"
	}
	return "ok"
}

// watchPushManager checks at start and every pmWatchPeriod. Logs on change.
func watchPushManager() {
	c := &http.Client{Timeout: 3 * time.Second}
	last := ""
	for {
		if s := pmState(c.Get); s != last {
			if s == "ok" {
				log.Printf("push-manager: ok")
			} else {
				log.Printf("push-manager: %s -- mixxx mode cannot drive the screen", s)
			}
			last = s
		}
		time.Sleep(pmWatchPeriod)
	}
}
