package main

import (
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func fake(code int, body string, err error) func(string) (*http.Response, error) {
	return func(string) (*http.Response, error) {
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: code, Status: http.StatusText(code), Body: io.NopCloser(strings.NewReader(body))}, nil
	}
}

func TestPMState(t *testing.T) {
	cases := []struct {
		name string
		get  func(string) (*http.Response, error)
		want string
	}{
		{"down", fake(0, "", errors.New("refused")), "unreachable"},
		{"500", fake(500, "", nil), "answered"},
		{"junk", fake(200, "x", nil), "unreadable"},
		{"old", fake(200, `{"connected":true}`, nil), "no direct mode"},
		{"ok", fake(200, `{"connected":false,"direct":false}`, nil), "ok"},
	}
	for _, c := range cases {
		if got := pmState(c.get); !strings.Contains(got, c.want) {
			t.Errorf("%s: got %q, want it to contain %q", c.name, got, c.want)
		}
	}
}
