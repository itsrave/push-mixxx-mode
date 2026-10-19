// mixxx-bridge: switches push 3 between push mode (stock push3 + live) and
// mixxx mode (push3 stopped, mixxx on the push audio, push-manager drives
// screen over usb). idle in push mode: no alsa, no x, just http.
package main

import (
	"embed"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/federico-pepe/ableton-push-hack/core/hackcfg"
	"github.com/federico-pepe/ableton-push-hack/core/httpx"
)

//go:embed index.html
var ui embed.FS

func main() {
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	cfg, err := hackcfg.Load(filepath.Join(dir, "hack.json"), 7720)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	b := newBridge(dir)
	go watchPushManager() // log when push-manager (screen) is missing

	mux := http.NewServeMux()
	mux.HandleFunc("/", httpx.ServeEmbedded(ui, "index.html"))
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, map[string]string{"mode": b.Mode()})
	})
	// audio settings (cfg.go): GET = current, POST = save. applies at the
	// next mixxx start.
	mux.HandleFunc("/api/settings", func(w http.ResponseWriter, r *http.Request) {
		st := filepath.Join(dir, "settings")
		if r.Method == http.MethodPost {
			var a audioCfg
			if err := json.NewDecoder(r.Body).Decode(&a); err != nil {
				http.Error(w, "invalid JSON body", http.StatusBadRequest)
				return
			}
			if err := saveAudio(st, a); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}
		httpx.JSON(w, loadAudio(st))
	})
	mux.HandleFunc("/api/mode", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var body struct {
			Mode string `json:"mode"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		var err error
		switch body.Mode {
		case modeMixxx:
			err = b.ToMixxx()
		case modePush:
			err = b.ToPush()
		default:
			http.Error(w, `mode must be "mixxx" or "push"`, http.StatusBadRequest)
			return
		}
		if err != nil {
			httpx.Error(w, err)
			return
		}
		httpx.JSON(w, map[string]string{"mode": b.Mode()})
	})

	// shadow ui tab (hack.json shadow_ui): push-manager polls it every
	// 300ms while the tab shows, so it stays out of the request log.
	root := http.NewServeMux()
	root.Handle("/", httpx.WithLogging(mux))
	root.HandleFunc("/api/shadow", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var ev struct{ CC, Value uint8 }
			if json.NewDecoder(r.Body).Decode(&ev) == nil && ev.CC == ccBot1 && ev.Value > 0 && b.Mode() != modeMixxx {
				log.Printf("shadow ui: start mixxx")
				go func() {
					if err := b.ToMixxx(); err != nil {
						log.Printf("shadow ui: %v", err)
					}
				}()
			}
		}
		httpx.JSON(w, map[string]any{
			"title": "MIXXX MODE",
			"rows": []string{
				"Stops Push3 and Live, then starts Mixxx on the Push.",
				"Hold SETTINGS for 1.5 s in Mixxx to come back to Push.",
			},
			"buttons": []string{"START"},
		})
	})

	addr := ":" + strconv.Itoa(cfg.Port)
	log.Printf("%s v%s on %s", cfg.Name, cfg.Version, addr)
	log.Fatal(httpx.NewServer(addr, httpx.WithCORS("GET, POST, OPTIONS", root)).ListenAndServe())
}

// first button under the screen: the tab's START soft-button.
const ccBot1 = 20
