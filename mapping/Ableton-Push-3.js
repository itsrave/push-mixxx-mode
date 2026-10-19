// Ableton Push 3 standalone -> Mixxx, two decks.
// all inputs registered here with midi.makeInputHandler, xml stays empty.
// pads arrive in MPE (one channel per note, set by Push3 before it stopped),
// so pad handlers listen on all 16 channels. LEDs go out on channel 0.
// button/encoder numbers: ableton-push-hack docs/push3-button-map.md.

var PUSH3 = {};

PUSH3.CC = {
    play: 85, record: 86, quarter: 36, quarterT: 37, // 1/4, 1/4t: color LEDs
    quantize: 116, del: 118,
    tempoTurn: 14, tempoPress: 15, volTurn: 79, volPress: 111,
    jogTurn: 70, jogPress: 94, jogLeft: 93, jogRight: 95,
    left: 44, right: 45, up: 46, down: 47,
    add: 32, swap: 33, // load selected track on left / right deck
    session: 51, // left of the pads, above Layout: library open / closed
    layout: 31,  // above Accent / Repeat: next layout (side by side, top/bottom, four decks)
    undo: 119, save: 82, // left side deck 1 <-> 3, right side deck 2 <-> 4
    settings: 30, // held 1.5 s = back to push (mixxx-bridge, not this script)
    help: 81,     // manual on screen (drawn by mixxx-bridge); jog scrolls it
    shift: 49,    // held = FX mode (search keyboard open: its digits, bridge)
    accent: 57,   // reverb on / off
    lock: 83, stop: 29, mute: 60, solo: 61, // left of the pads: headphone cue deck 1-4 (CUE_BTNS)
    botFirst: 20, // buttons 1-8 below the screen = CC 20-27
    topFirst: 102, // buttons 1-8 above the screen = CC 102-109
};
// [play, cue] buttons per side: left Play / Record, right 1/4 / 1/4t. all
// color LEDs, like a CDJ: play green, solid while playing, blinking while
// stopped; cue yellow, orange while mixxx lights it (pioneer cue mode: solid
// at the cue point, blinking when paused elsewhere). play blinks on mixxx's
// own 250 ms clock ([App],indicator_250ms), the one cue blinks on, so they
// blink together.
PUSH3.TRANSPORT = [[PUSH3.CC.play, PUSH3.CC.record], [PUSH3.CC.quarter, PUSH3.CC.quarterT]];
PUSH3.PLAY_COL = 10; // green
PUSH3.CUE_COL = [7, 3]; // [off yellow, lit orange]
PUSH3.ENC_FIRST = 71; // encoders 1-8 = CC 71-78, touch = note 0-7

// LED palette indices (core/push3/colors.go). button LEDs: value = brightness.
PUSH3.COL = {
    off: 0, dark: 124, white: 120,
    cueEmpty: 124, // hot cue not set; set = HOTCUE[n - 1]
    loopIdle: 6, loopOn: 8, // all loop pads: dark brown / hot cue amber
    // toggles: darkest / brightest of one hue. skin flags use the same hues (style.qss).
    syncIdle: 68, syncOn: 127,       // rekordbox red
    quantizeIdle: 103, quantizeOn: 125, // blue
    keylockIdle: 107, keylockOn: 23, // violet
    pflIdle: 7, pflOn: 3,     // headphone cue buttons: yellow / orange
    jumpBack: 33, jumpFwd: 33, // both cobalt blue
    slipIdle: 113, slipOn: 1,  // very dark crimson / red
    fader: 120, // volume pad lit up to the level: white
};
// hot cue 1-8: red, orange, yellow, green, sky blue, blue, violet, pink
PUSH3.HOTCUE = [1, 3, 7, 10, 16, 17, 23, 36];
// master level meter on the right button column, bottom to top: 1/8, 1/8t,
// 1/16, 1/16t, 1/32, 1/32t. rekordbox colors: 3 green, 2 yellow, red.
// Main above them = clip light, red only while the master clips.
PUSH3.MASTER_VU = [38, 39, 40, 41, 42, 43];
PUSH3.CLIP_CC = 28; // Main button: clip light + master volume (VOL)
PUSH3.MASTER_VU_COL = [10, 10, 10, 7, 7, 127];
PUSH3.vuLit = -1;
PUSH3.BTN_ON = 127;
PUSH3.BTN_DIM = 12;

// feel knobs, tune on the device.
PUSH3.NUDGE = 1;      // jog value per encoder tick when nudging
PUSH3.TEMPO_STEP = 0.006;
PUSH3.TEMPO_FINE = 0.0002;
// Shift + jog = pull-up: holds the record and moves it (mixxx scratch), on
// a playing deck too. ticks per virtual record turn (33 1/3 rpm, 1.8 s of
// audio): fewer = each tick moves further. let go (no tick for
// PULLUP_IDLE_MS, or Shift up) = record released, playback ramps back.
PUSH3.PULLUP_TICKS = 32;
PUSH3.PULLUP_IDLE_MS = 150;
PUSH3.shiftDown = false;
PUSH3.pullup = {}; // deck number -> idle timer while scratching
PUSH3.STEP_TICKS = 3; // encoder ticks per grid / bpm / zoom step
PUSH3.DETENT_MS = 125; // EQ at center: pause this long before turning past it
PUSH3.DETENT_NEAR = 0.1; // closer to center than this (of the full range): turn straight past it
PUSH3.UI_HIDE_MS = 1500; // label rows hide this long after the last touch
PUSH3.UI_H = 10;         // label row height (px), skin.xml
PUSH3.UI_STEP = 2;       // px per 20 ms animation frame: ~100 ms open/close
PUSH3.TAIL_MS = 6000;    // effect knob at 0: reverb / echo ring out this long, then off
PUSH3.tailTimers = {};   // effect group -> timer that disables it after its tail

// library sort columns on the buttons above the screen. Mixxx
// TrackModel::SortColumnId: # = playlist position, title, artist, bpm, key,
// duration, date added, genre. labels in skin.xml.
PUSH3.SORT = [23, 2, 1, 15, 20, 13, 17, 6];

// decks the Push controls: [left side, right side]. Undo / Save flip them
// to 3 / 4. every handler reads this at press time; LED feedback is rebound
// on each flip (deckConns).
PUSH3.decks = ["[Channel1]", "[Channel2]"];
PUSH3.ALL = ["[Channel1]", "[Channel2]", "[Channel3]", "[Channel4]"];
PUSH3.LAYOUTS = 3; // skin.xml [PushHack],layout pages
PUSH3.deckConns = [];
PUSH3.MODES = ["eq", "fx", "grid", "gain"]; // [PushHack],encoder_mode
PUSH3.PAGES = ["eq", "fx", "grid", "sort", "gain", "vol"]; // [PushHack],top_page
PUSH3.shiftMode = null; // mode to go back to when Shift is let go
PUSH3.encMode = "eq";
PUSH3.master = 0; // side (0 left, 1 right) whose deck the tempo wheel drives
PUSH3.deleteHeld = false;
PUSH3.helpOpen = false; // mixxx-bridge shows the manual; jog belongs to it
// SEARCH (button 1 below the screen) while the library is open = the top 4
// pad rows (notes 68-99) are a search keyboard; again or library closed = off.
// mixxx-bridge types the letters (keyboard.go kbRows, same layout); this
// side lights the pads and puts the focus in the search box.
PUSH3.kbOn = false;
PUSH3.KB_FIRST = 68;
PUSH3.acc = [0, 0, 0, 0, 0, 0, 0, 0]; // per encoder: ticks not yet stepped
PUSH3.held = [0, 0, 0, 0, 0, 0, 0, 0, 0]; // per encoder, 8 = jog on master volume: last tick while held at center
PUSH3.armed = [false, false, false, false, false, false, false, false, false]; // per encoder: was far from center
PUSH3.touched = [false, false, false, false, false, false, false, false];
PUSH3.uiTimer = 0;
PUSH3.uiTarget = 0;
PUSH3.animTimer = 0;
PUSH3.conns = [];

// pad layout per side, 3 columns x 8 rows. row 7 = top. left side uses
// columns 0-2, right side 5-7. each cell: [kind, arg], [] = unused.
PUSH3.PADS = [
    /* row 7 */ [["hotcue", 1], ["hotcue", 2], ["hotcue", 3]],
    /* row 6 */ [["hotcue", 4], ["hotcue", 5], ["hotcue", 6]],
    /* row 5 */ [["hotcue", 7], ["hotcue", 8], []],
    /* row 4 */ [["loop_in"], ["loop_out"], ["reloop"]],
    /* row 3 */ [["beatloop", 4], ["beatloop", 8], ["beatloop", 16]],
    /* row 2 */ [["loop_halve"], ["loop_double"], ["slip"]],
    /* row 1 */ [[], [], []],
    /* row 0 */ [["beatjump_back"], [], ["beatjump_fwd"]],
];
// inner column (3 left, 4 right): rows 0-5 volume fader (initPads), key
// lock, sync on top. quantize = Quantize button.
PUSH3.INNER = { 6: "keylock", 7: "sync" };
PUSH3.FADER_ROWS = 6; // volume fader height in pads, bottom up
// buttons left of the pads, top down: headphone cue of deck 1, 2, 3, 4.
// fixed decks, not the sides: you cue what is coming next on any deck.
PUSH3.CUE_BTNS = [PUSH3.CC.lock, PUSH3.CC.stop, PUSH3.CC.mute, PUSH3.CC.solo];
PUSH3.padFeedback = []; // [side, note, kind, arg], LEDs bound in bindDecks

PUSH3.padNote = function(row, col) { return 36 + row * 8 + col; };
PUSH3.rel = function(v) { return v < 64 ? v : v - 128; };
PUSH3.led = function(note, color, force) {
    if (PUSH3.kbOn && note >= PUSH3.KB_FIRST && !force) { return; } // keyboard owns these
    midi.sendShortMsg(0x90, note, color);
};
// keyboard key color: letters grey, space blue, del / clear red (bridge kbRows).
PUSH3.kbColor = function(note) {
    var i = note - PUSH3.KB_FIRST; // 0-7 = bottom keyboard row: y z sp sp - ' del clear
    if (i === 2 || i === 3) { return 33; }
    if (i === 6 || i === 7) { return 1; }
    return 118;
};
PUSH3.setKb = function(on) {
    if (on === PUSH3.kbOn) { return; }
    PUSH3.kbOn = on;
    engine.setValue("[PushHack]", "kb", on ? 1 : 0); // skin: SEARCH label lit
    PUSH3.btn(PUSH3.CC.botFirst + 0, on);
    if (on) {
        PUSH3.kbLeds();
        engine.setValue("[Library]", "focused_widget", 1);
    } else {
        PUSH3.bindDecks(); // deck pad LEDs back
    }
};
PUSH3.kbLeds = function() {
    for (var n = PUSH3.KB_FIRST; n < 100; n++) { PUSH3.led(n, PUSH3.kbColor(n), true); }
};
PUSH3.btn = function(cc, on) { midi.sendShortMsg(0xB0, cc, on ? PUSH3.BTN_ON : PUSH3.BTN_DIM); };

// register one handler for every channel of a note (MPE pads).
PUSH3.onPad = function(note, fn) {
    var route = function(down) {
        if (PUSH3.kbOn && note >= PUSH3.KB_FIRST) { PUSH3.kbPad(note, down); } else { fn(down); }
    };
    for (var ch = 0; ch < 16; ch++) {
        midi.makeInputHandler(0x90 + ch, note, function(c, n, v) { route(v > 0); });
        midi.makeInputHandler(0x80 + ch, note, function() { route(false); });
    }
};
// keyboard pad: focus the search box (bridge types after ~30 ms), flash.
PUSH3.kbPad = function(note, down) {
    if (down) { engine.setValue("[Library]", "focused_widget", 1); }
    PUSH3.led(note, down ? PUSH3.COL.white : PUSH3.kbColor(note), true);
};
// a mixxx dialog (5, e.g. "Couldn't load track.") or menu (4) has the focus.
// mixxx-bridge shows it on the push screen; the jog drives it: MoveVertical
// = Tab to the next / previous button, GoToItem = click it.
PUSH3.dialogOpen = function() {
    var f = engine.getValue("[Library]", "focused_widget");
    return f === 4 || f === 5;
};
// move the library selection. MoveVertical acts on the focused pane: focus
// on none (lost when a load hid the library), the search box (up / down =
// search history) or anything else = library looks frozen. take the track
// list unless the tree, the list or a dialog already has it.
PUSH3.libMove = function(n) {
    var f = engine.getValue("[Library]", "focused_widget");
    if (f !== 2 && f !== 3 && !PUSH3.dialogOpen()) { engine.setValue("[Library]", "focused_widget", 3); }
    engine.setValue("[Library]", "MoveVertical", n);
};
PUSH3.onCC = function(cc, fn) {
    midi.makeInputHandler(0xB0, cc, function(c, n, v) { fn(v); });
};
PUSH3.onPress = function(cc, fn) {
    // buttons above/below the screen also bring up the label rows
    var labelled = (cc >= 20 && cc <= 27) || (cc >= 102 && cc <= 109);
    PUSH3.onCC(cc, function(v) {
        if (v > 0) {
            if (labelled) { PUSH3.poke(); }
            fn();
        }
    });
};

// label rows (encoder names on top, button names below) show while you use
// them, then hide so the waveforms get the full height. library open = shown.
// they slide: [PushHack],ui_h is the rows' height in px, stepped by a timer.
PUSH3.showUi = function(on) {
    PUSH3.uiTarget = on ? PUSH3.UI_H : 0;
    if (!PUSH3.animTimer) { PUSH3.animTimer = engine.beginTimer(20, PUSH3.animStep); }
};
PUSH3.animStep = function() {
    var h = engine.getValue("[PushHack]", "ui_h"), t = PUSH3.uiTarget;
    if (h === t) {
        engine.stopTimer(PUSH3.animTimer);
        PUSH3.animTimer = 0;
        return;
    }
    engine.setValue("[PushHack]", "ui_h", h < t ? Math.min(t, h + PUSH3.UI_STEP) : Math.max(t, h - PUSH3.UI_STEP));
};
PUSH3.poke = function() {
    PUSH3.showUi(true);
    if (PUSH3.uiTimer) { engine.stopTimer(PUSH3.uiTimer); }
    PUSH3.uiTimer = engine.beginTimer(PUSH3.UI_HIDE_MS, function() {
        PUSH3.uiTimer = 0;
        if (PUSH3.touched.indexOf(true) < 0 && !PUSH3.libOpen() && !PUSH3.VOL.on) { PUSH3.showUi(false); }
    }, true);
};
PUSH3.touch = function(e, on) {
    PUSH3.touched[e] = on;
    PUSH3.poke(); // release starts the hide timer
};
// missing control (renamed in a mixxx update): makeConnection returns
// undefined. skip it, else the throw aborts init and every pad stays dark.
PUSH3.watch = function(group, key, fn) {
    var c = engine.makeConnection(group, key, fn);
    if (!c) { return; }
    c.trigger();
    PUSH3.conns.push(c);
};
// like watch, for the deck on a side; rebound when that side flips.
PUSH3.dwatch = function(d, key, fn) {
    var c = engine.makeConnection(PUSH3.decks[d], key, fn);
    if (!c) { return; }
    c.trigger();
    PUSH3.deckConns.push(c);
};
PUSH3.deckNum = function(d) { return PUSH3.ALL.indexOf(PUSH3.decks[d]) + 1; };
PUSH3.nudge = function(group, key, delta, step) {
    engine.setParameter(group, key, Math.max(0, Math.min(1, engine.getParameter(group, key) + delta * step)));
};
// like nudge, but stops at center (0.5). endless encoder, so the stop is
// in time: crossing center lands on it, and it stays while the knob keeps
// turning. pause DETENT_MS, then turn again to go past. only stops when the
// knob was DETENT_NEAR or further from center since the last stop (armed):
// a small trim around center just crosses it. per tick that can't be told,
// a slow turn is always one tick from center when it crosses.
PUSH3.nudgeDetent = function(e, group, key, delta, step) {
    var v = engine.getParameter(group, key), now = Date.now();
    var n = Math.max(0, Math.min(1, v + delta * step));
    var off = Math.abs(v - 0.5);
    if (off >= PUSH3.DETENT_NEAR) { PUSH3.armed[e] = true; }
    if (off < 0.005 && now - PUSH3.held[e] < PUSH3.DETENT_MS) {
        PUSH3.held[e] = now; // stopped at center: stays while the knob keeps turning
        return;
    }
    if (PUSH3.armed[e] && off >= 0.005 && (v - 0.5) * (n - 0.5) <= 0) {
        n = 0.5;
        PUSH3.held[e] = now;
        PUSH3.armed[e] = false;
    }
    engine.setParameter(group, key, n);
};
// one press of up/down per STEP_TICKS ticks.
PUSH3.step = function(e, delta, group, down, up) {
    PUSH3.acc[e] += delta;
    for (; PUSH3.acc[e] >= PUSH3.STEP_TICKS; PUSH3.acc[e] -= PUSH3.STEP_TICKS) { engine.setValue(group, up, 1); }
    for (; PUSH3.acc[e] <= -PUSH3.STEP_TICKS; PUSH3.acc[e] += PUSH3.STEP_TICKS) { engine.setValue(group, down, 1); }
};
// temporary pitch bend, like a CDJ jog edge. stopped deck: moves position.
// Shift held: pull-up (see PULLUP_TICKS).
PUSH3.jog = function(group, delta) {
    if (!PUSH3.shiftDown) {
        engine.setValue(group, "jog", engine.getValue(group, "jog") + delta * PUSH3.NUDGE);
        return;
    }
    var d = parseInt(group.replace(/\D/g, ""), 10);
    if (PUSH3.pullup[d]) {
        engine.stopTimer(PUSH3.pullup[d]);
    } else {
        engine.scratchEnable(d, PUSH3.PULLUP_TICKS, 33 + 1 / 3, 1 / 8, 1 / 8 / 32, true);
    }
    engine.scratchTick(d, delta);
    PUSH3.pullup[d] = engine.beginTimer(PUSH3.PULLUP_IDLE_MS, function() { PUSH3.pullupEnd(d); }, true);
};
PUSH3.pullupEnd = function(d) {
    if (!PUSH3.pullup[d]) { return; }
    engine.stopTimer(PUSH3.pullup[d]);
    delete PUSH3.pullup[d];
    engine.scratchDisable(d, true);
};
PUSH3.libOpen = function() { return engine.getValue("[Skin]", "show_maximized_library") > 0; };

PUSH3.init = function() {
    var C = PUSH3.CC;

    // button LEDs: push3 leaves them lit. all off, then light only buttons
    // that do something here (watched ones light themselves below).
    for (var cc = 0; cc < 128; cc++) { midi.sendShortMsg(0xB0, cc, 0); }
    [C.del, C.add, C.swap, C.up, C.down, C.settings].forEach(function(cc) { PUSH3.btn(cc, false); });

    // transport: left Play/Record = deck 1 play/cue, right Shift/Select = deck 2.
    PUSH3.TRANSPORT.forEach(function(b, i) {
        PUSH3.onPress(b[0], function() { script.toggleControl(PUSH3.decks[i], "play"); });
        PUSH3.onCC(b[1], function(v) { engine.setValue(PUSH3.decks[i], "cue_default", v > 0 ? 1 : 0); });
    });

    // beatmatch: tempo wheel = master deck tempo (press = original tempo),
    // shift + tempo wheel = fine steps
    PUSH3.onCC(C.tempoTurn, function(v) {
        var step = PUSH3.shiftDown ? PUSH3.TEMPO_FINE : PUSH3.TEMPO_STEP;
        PUSH3.nudge(PUSH3.decks[PUSH3.master], "rate", -PUSH3.rel(v), step);
    });
    // volume wheel above it nudges deck 1, big jog nudges deck 2 (scrolls
    // the library while it is open). bottom button 3 swaps the master.
    PUSH3.onPress(C.tempoPress, function() { engine.setValue(PUSH3.decks[PUSH3.master], "rate_set_zero", 1); });
    PUSH3.onCC(C.volTurn, function(v) { PUSH3.jog(PUSH3.decks[0], PUSH3.rel(v)); });
    PUSH3.onPress(C.botFirst + 2, function() { PUSH3.setMaster(1 - PUSH3.master); });

    // top encoders: 1-4 deck 1, 5-8 deck 2. mode switched with buttons below the screen.
    for (var e = 0; e < 8; e++) {
        (function(e) {
            PUSH3.onCC(PUSH3.ENC_FIRST + e, function(v) {
                PUSH3.poke();
                var d = Math.floor(e / 4), slot = e % 4, g = PUSH3.decks[d], delta = PUSH3.rel(v);
                if (PUSH3.encMode === "grid") {
                    if (slot === 0) { PUSH3.step(e, delta, g, "beats_translate_earlier", "beats_translate_later"); }
                    if (slot === 1) { PUSH3.step(e, delta, g, "beats_adjust_slower", "beats_adjust_faster"); }
                    // higher waveform_zoom = more track on screen, so clockwise = zoom in = down
                    if (slot === 2) { PUSH3.step(e, delta, g, "waveform_zoom_up", "waveform_zoom_down"); }
                    return;
                }
                var t = PUSH3.encTarget(d, slot);
                if (!t) { return; }
                if (PUSH3.encMode === "fx") { PUSH3.nudge(t[0], t[1], delta, 0.01); } else { PUSH3.nudgeDetent(e, t[0], t[1], delta, 0.01); }
            });
            // hold Delete + touch = reset: EQ to 0 dB, filter to center, effect off, FX mix to full,
            // grid/bpm: undo the last grid change, zoom: default, gain: 0 dB.
            midi.makeInputHandler(0x80, e, function() { PUSH3.touch(e, false); });
            midi.makeInputHandler(0x90, e, function(c, n, v) {
                PUSH3.touch(e, v > 0);
                if (v === 0 || !PUSH3.deleteHeld) { return; }
                var d = Math.floor(e / 4), slot = e % 4;
                if (PUSH3.encMode === "grid") {
                    if (slot < 2) { engine.setValue(PUSH3.decks[d], "beats_undo_adjustment", 1); }
                    if (slot === 2) { engine.setValue(PUSH3.decks[d], "waveform_zoom_set_default", 1); }
                    return;
                }
                var t = PUSH3.encTarget(d, slot);
                if (!t) { return; }
                if (t[1] === "mix") { engine.setValue(t[0], "mix", 1); } else if (t[1] === "meta") { engine.setParameter(t[0], "meta", 0); } else { engine.setValue(t[0], t[1] + "_set_default", 1); }
            });
        })(e);
    }
    PUSH3.onPress(C.botFirst + 4, function() { PUSH3.setEncMode("gain"); });
    PUSH3.onPress(C.botFirst + 5, function() { PUSH3.setEncMode("grid"); });
    PUSH3.onPress(C.botFirst + 6, function() { PUSH3.setEncMode("eq"); });
    PUSH3.onPress(C.botFirst + 7, function() { PUSH3.setEncMode("fx"); });

    // buttons above the screen: library open = sort (again = reverse),
    // FX = next effect (Delete held = previous), GRID = grid starts here,
    // GAIN: button 2 / 6 = auto gain (ReplayGain, all decks) on / off.
    for (var t = 0; t < 8; t++) {
        (function(t) { PUSH3.onPress(C.topFirst + t, function() { PUSH3.topPress(t); }); })(t);
    }
    PUSH3.watch("[Library]", "sort_column", function() { PUSH3.updateTop(); });
    PUSH3.watch("[ReplayGain]", "ReplayGainEnabled", function() { PUSH3.updateTop(); });

    // hold Shift = FX mode, let go = back. the search keyboard uses Shift
    // for its digits, so not while it is open.
    PUSH3.onCC(C.shift, function(v) {
        PUSH3.btn(C.shift, v > 0);
        PUSH3.shiftDown = v > 0;
        if (v === 0) { Object.keys(PUSH3.pullup).forEach(function(d) { PUSH3.pullupEnd(+d); }); }
        if (v > 0 && !PUSH3.kbOn) {
            PUSH3.shiftMode = PUSH3.encMode;
            PUSH3.setEncMode("fx");
            PUSH3.poke();
        } else if (v === 0 && PUSH3.shiftMode) {
            PUSH3.setEncMode(PUSH3.shiftMode);
            PUSH3.shiftMode = null;
            PUSH3.poke();
        }
    });
    PUSH3.btn(C.shift, false);

    // Accent = reverb (effect 1) at 75% on both decks the Push controls,
    // again = off. lit while either is on (initFx, bindDecks).
    PUSH3.onPress(C.accent, function() {
        var v = PUSH3.reverbOn() ? 0 : 0.75;
        [0, 1].forEach(function(d) { engine.setParameter(PUSH3.reverb(d), "meta", v); });
    });

    // Session = library open / closed. Layout = next deck layout.
    // Undo / Save = left side deck 1 <-> 3, right side deck 2 <-> 4.
    PUSH3.onPress(C.session, function() { script.toggleControl("[Skin]", "show_maximized_library"); });
    PUSH3.onPress(C.layout, function() {
        engine.setValue("[PushHack]", "layout", (engine.getValue("[PushHack]", "layout") + 1) % PUSH3.LAYOUTS);
    });
    PUSH3.onPress(C.undo, function() { PUSH3.flip(0); });
    PUSH3.onPress(C.save, function() { PUSH3.flip(1); });
    PUSH3.btn(C.layout, true);
    PUSH3.onPress(C.botFirst + 0, function() { if (PUSH3.libOpen()) { PUSH3.setKb(!PUSH3.kbOn); } });
    // IMPORT (button 2) = mixxx's "Import as Playlist" on the selected tree
    // item (patched mixxx; Rekordbox playlists only). mixxx-bridge sees the
    // same press and copies the tracks to the Push (import.go).
    PUSH3.onPress(C.botFirst + 1, function() { if (PUSH3.libOpen()) { engine.setValue("[Library]", "import_playlist", 1); } });
    PUSH3.watch("[Skin]", "show_maximized_library", function(v) {
        PUSH3.btn(C.session, v);
        if (!v) { PUSH3.setKb(false); }
        midi.sendShortMsg(0xB0, C.botFirst + 0, v ? PUSH3.BTN_DIM : 0); // SEARCH, IMPORT only in the library
        midi.sendShortMsg(0xB0, C.botFirst + 1, v ? PUSH3.BTN_DIM : 0);
        if (v) { PUSH3.showUi(true); } else { PUSH3.poke(); }
        PUSH3.updateTop();
    });

    // library: jog scrolls, press opens (on Rekordbox item: rescans drives),
    // click left = tree, click right = track list. Add / Swap load deck 1 / 2.
    // focused_widget: 2 = sidebar tree, 3 = tracks table.
    PUSH3.onPress(C.help, function() {
        PUSH3.helpOpen = !PUSH3.helpOpen;
        PUSH3.btn(C.help, PUSH3.helpOpen);
    });
    PUSH3.btn(C.help, false);
    PUSH3.onCC(C.jogTurn, function(v) {
        if (PUSH3.helpOpen) { return; }
        if (PUSH3.VOL.on && !PUSH3.dialogOpen()) {
            PUSH3.volTurn(PUSH3.rel(v));
            return;
        }
        if (PUSH3.libOpen() || PUSH3.dialogOpen()) {
            PUSH3.libMove(PUSH3.rel(v));
        } else { PUSH3.jog(PUSH3.decks[1], PUSH3.rel(v)); }
    });
    PUSH3.onPress(C.jogPress, function() { if (!PUSH3.helpOpen) { engine.setValue("[Library]", "GoToItem", 1); } });
    PUSH3.onPress(C.jogLeft, function() { engine.setValue("[Library]", "focused_widget", 2); });
    PUSH3.onPress(C.jogRight, function() { engine.setValue("[Library]", "focused_widget", 3); });
    PUSH3.onPress(C.up, function() { PUSH3.libMove(-1); });
    PUSH3.onPress(C.down, function() { PUSH3.libMove(1); });
    // loading closes the library and goes back to the decks.
    [C.add, C.swap].forEach(function(cc, d) {
        PUSH3.onPress(cc, function() {
            engine.setValue(PUSH3.decks[d], "LoadSelectedTrack", 1);
            engine.setValue("[Skin]", "show_maximized_library", 0);
        });
    });

    PUSH3.CUE_BTNS.forEach(function(cc, i) {
        PUSH3.onPress(cc, function() { script.toggleControl(PUSH3.ALL[i], "pfl"); });
        PUSH3.watch(PUSH3.ALL[i], "pfl", function(v) { midi.sendShortMsg(0xB0, cc, v ? PUSH3.COL.pflOn : PUSH3.COL.pflIdle); });
    });

    // quantize button: all decks follow deck 1.
    PUSH3.onPress(C.quantize, function() {
        var q = engine.getValue("[Channel1]", "quantize") ? 0 : 1;
        PUSH3.ALL.forEach(function(g) { engine.setValue(g, "quantize", q); });
    });
    PUSH3.watch("[Channel1]", "quantize", function(v) { PUSH3.btn(C.quantize, v); });

    // hold Delete + hot cue pad = clear that cue.
    PUSH3.onCC(C.del, function(v) { PUSH3.deleteHeld = v > 0; });

    // touch strip = crossfader. pitch bend ch 0; data1 is the LSB, so listen
    // on every value of it and use the MSB.
    for (var lsb = 0; lsb < 128; lsb++) {
        midi.makeInputHandler(0xE0, lsb, function(c, n, v) {
            engine.setValue("[Master]", "crossfader", v / 63.5 - 1);
        });
    }
    // let go = crossfader back to center, like the pitch bend strip in Push
    // mode. touch = note 12, any channel (MPE).
    var center = function() { engine.setValue("[Master]", "crossfader", 0); };
    for (var ch = 0; ch < 16; ch++) {
        midi.makeInputHandler(0x80 + ch, 12, center);
        midi.makeInputHandler(0x90 + ch, 12, function(c, n, v) { if (v === 0) { center(); } });
    }

    PUSH3.watch("[Main]", "vu_meter", PUSH3.masterVu);
    PUSH3.watch("[Main]", "peak_indicator", PUSH3.volLed);
    PUSH3.onPress(PUSH3.CLIP_CC, function() { PUSH3.volSet(!PUSH3.VOL.on); });
    PUSH3.initPads();
    PUSH3.initFx();
    PUSH3.setEncMode("eq");
    PUSH3.watch("[App]", "indicator_250ms", function() { PUSH3.playLed(0); PUSH3.playLed(1); });
    // keylock + sync on by default; deck 1 is master (sync leader). pioneer
    // cue mode (1): cue_indicator blinks / lights like a CDJ.
    PUSH3.ALL.forEach(function(g) {
        engine.setValue(g, "cue_mode", 1);
        engine.setValue(g, "keylock", 1);
        engine.setValue(g, "sync_enabled", 1);
    });
    PUSH3.bindDecks();
};

// master volume: press Main, turn the jog. mixxx 2.5 keeps the main gain in
// [Master] ([Main],gain does not exist; only the meter moved to [Main]).
// -14..+14 dB, 0.5 = 0 dB, stops there like the EQ. ends on Main again or
// VOL.ms without a turn, so a forgotten mode can't eat a nudge.
PUSH3.VOL = { group: "[Master]", key: "gain", ms: 3000, on: false, timer: 0 };
PUSH3.volSet = function(on) {
    var V = PUSH3.VOL;
    if (V.timer) { engine.stopTimer(V.timer); V.timer = 0; }
    if (on) { V.timer = engine.beginTimer(V.ms, function() { V.timer = 0; PUSH3.volSet(false); }, true); }
    if (on === V.on) { return; }
    V.on = on;
    PUSH3.volLed();
    PUSH3.updateTop();
    PUSH3.poke();
};
PUSH3.volTurn = function(delta) {
    PUSH3.nudgeDetent(8, PUSH3.VOL.group, PUSH3.VOL.key, delta, 0.01);
    PUSH3.volSet(true); // restart the timeout
};
// Main LED: red while the master clips, white while VOL is on, else off.
PUSH3.volLed = function() {
    var clip = engine.getValue("[Main]", "peak_indicator") > 0;
    midi.sendShortMsg(0xB0, PUSH3.CLIP_CC, clip ? PUSH3.MASTER_VU_COL[5] : PUSH3.VOL.on ? PUSH3.COL.white : 0);
};

// play LED of a side: green while playing, else green / off on the 250 ms clock.
PUSH3.playLed = function(d) {
    var on = engine.getValue(PUSH3.decks[d], "play") > 0 || engine.getValue("[App]", "indicator_250ms") > 0;
    midi.sendShortMsg(0xB0, PUSH3.TRANSPORT[d][0], on ? PUSH3.PLAY_COL : 0);
};

// master level -> lit segments; sends only when the count changes.
PUSH3.masterVu = function(v) {
    var n = Math.round(v * PUSH3.MASTER_VU.length);
    if (n === PUSH3.vuLit) { return; }
    PUSH3.vuLit = n;
    PUSH3.MASTER_VU.forEach(function(cc, i) {
        midi.sendShortMsg(0xB0, cc, i < n ? PUSH3.MASTER_VU_COL[i] : 0);
    });
};

// flip one side between its two decks (left 1 <-> 3, right 2 <-> 4).
PUSH3.flip = function(d) {
    var n = PUSH3.deckNum(d);
    PUSH3.decks[d] = PUSH3.ALL[(n + 1) % 4]; // 1->3, 3->1, 2->4, 4->2
    PUSH3.acc = [0, 0, 0, 0, 0, 0, 0, 0];
    PUSH3.bindDecks();
    PUSH3.poke();
};

// everything that shows the controlled decks: skin pages + badges, master,
// transport / pad / side-button LEDs. called at start and on every flip.
PUSH3.bindDecks = function() {
    var C = PUSH3.CC, COL = PUSH3.COL;
    PUSH3.deckConns.forEach(function(c) { c.disconnect(); });
    PUSH3.deckConns = [];
    engine.setValue("[PushHack]", "left_page", PUSH3.deckNum(0) === 3 ? 1 : 0);
    engine.setValue("[PushHack]", "right_page", PUSH3.deckNum(1) === 4 ? 1 : 0);
    for (var i = 1; i <= 4; i++) {
        engine.setValue("[PushHack]", "active" + i, i === PUSH3.deckNum(0) || i === PUSH3.deckNum(1) ? 1 : 0);
    }
    PUSH3.btn(C.undo, PUSH3.deckNum(0) === 3);
    PUSH3.btn(C.accent, PUSH3.reverbOn());
    PUSH3.btn(C.save, PUSH3.deckNum(1) === 4);
    PUSH3.setMaster(PUSH3.master);

    PUSH3.TRANSPORT.forEach(function(b, d) {
        PUSH3.dwatch(d, "play", function() { PUSH3.playLed(d); });
        PUSH3.dwatch(d, "cue_indicator", function(v) { midi.sendShortMsg(0xB0, b[1], PUSH3.CUE_COL[v ? 1 : 0]); });
    });
    [0, 1].forEach(function(d) {
        var fcol = 3 + d;
        PUSH3.dwatch(d, "volume", function(v) {
            var lit = Math.round(v * (PUSH3.FADER_ROWS - 1));
            for (var r = 0; r < PUSH3.FADER_ROWS; r++) {
                PUSH3.led(PUSH3.padNote(r, fcol), v > 0 && r <= lit ? COL.fader : COL.dark);
            }
        });
    });
    PUSH3.padFeedback.forEach(function(p) { PUSH3.padLed(p[0], p[1], p[2], p[3]); });
};

// encoder slot (0-3) of a deck (0-1) -> [group, key] for the current mode,
// null = nothing on that encoder. GRID is handled by the caller.
PUSH3.encTarget = function(d, slot) {
    var g = PUSH3.decks[d];
    if (PUSH3.encMode === "gain") { return slot === 0 ? [g, "pregain"] : null; }
    if (PUSH3.encMode === "eq") {
        var eq = "[EqualizerRack1_" + g + "_Effect1]";
        return [[eq, "parameter3"], [eq, "parameter2"], [eq, "parameter1"],
            ["[QuickEffectRack1_" + g + "]", "super1"]][slot];
    }
    var unit = "[EffectRack1_EffectUnit" + PUSH3.deckNum(d);
    if (slot === 3) { return [unit + "]", "mix"]; }
    return [unit + "_Effect" + (slot + 1) + "]", "meta"];
};

PUSH3.setEncMode = function(m) {
    PUSH3.encMode = m;
    PUSH3.acc = [0, 0, 0, 0, 0, 0, 0, 0];
    engine.setValue("[PushHack]", "encoder_mode", PUSH3.MODES.indexOf(m)); // skin labels
    PUSH3.btn(PUSH3.CC.botFirst + 4, m === "gain");
    PUSH3.btn(PUSH3.CC.botFirst + 5, m === "grid");
    PUSH3.btn(PUSH3.CC.botFirst + 6, m === "eq");
    PUSH3.btn(PUSH3.CC.botFirst + 7, m === "fx");
    PUSH3.updateTop();
};

// master = the deck the tempo wheel drives. with SYNC on it is also mixxx's
// sync leader, so the other deck follows its tempo.
PUSH3.setMaster = function(d) {
    PUSH3.master = d;
    engine.setValue("[PushHack]", "master", PUSH3.deckNum(d)); // skin flag
    var g = PUSH3.decks[d];
    if (engine.getValue(g, "sync_enabled")) { engine.setValue(g, "sync_leader", 2); }
    PUSH3.btn(PUSH3.CC.botFirst + 2, true);
};

PUSH3.topPress = function(t) {
    if (PUSH3.libOpen()) {
        engine.setValue("[Library]", "sort_column_toggle", PUSH3.SORT[t]);
        return;
    }
    var d = Math.floor(t / 4), slot = t % 4;
    if (PUSH3.encMode === "fx" && slot < 3) {
        var fx = "[EffectRack1_EffectUnit" + PUSH3.deckNum(d) + "_Effect" + (slot + 1) + "]";
        engine.setValue(fx, PUSH3.deleteHeld ? "prev_effect" : "next_effect", 1);
        engine.setParameter(fx, "meta", 0); // new effect starts off, not at its preset amount
    }
    if (PUSH3.encMode === "grid" && slot === 0) { engine.setValue(PUSH3.decks[d], "beats_translate_curpos", 1); }
    if (PUSH3.encMode === "gain" && slot === 1) { script.toggleControl("[ReplayGain]", "ReplayGainEnabled"); }
};

// top page (skin) + LEDs of the buttons above the screen: 0 off, 1 dim, 2 lit.
PUSH3.updateTop = function() {
    var lib = PUSH3.libOpen();
    engine.setValue("[PushHack]", "top_page", PUSH3.PAGES.indexOf(PUSH3.VOL.on ? "vol" : lib ? "sort" : PUSH3.encMode));
    var auto = engine.getValue("[ReplayGain]", "ReplayGainEnabled") > 0;
    var sortCol = engine.getValue("[Library]", "sort_column");
    for (var t = 0; t < 8; t++) {
        var slot = t % 4, s = 0;
        if (PUSH3.VOL.on) { s = 0; } else if (lib) { s = PUSH3.SORT[t] === sortCol ? 2 : 1; } else if (PUSH3.encMode === "fx") { s = slot < 3 ? 1 : 0; } else if (PUSH3.encMode === "grid") { s = slot === 0 ? 1 : 0; } else if (PUSH3.encMode === "gain") { s = slot === 1 ? (auto ? 2 : 1) : 0; }
        midi.sendShortMsg(0xB0, PUSH3.CC.topFirst + t, [0, PUSH3.BTN_DIM, PUSH3.BTN_ON][s]);
    }
};

// effect unit N on deck N (1-4), mix at full. the knob is the amount:
// reverb / echo link it to Send (input into the effect), so at 0 nothing new
// goes in but what is in rings out, like rekordbox. the effect stays on for
// TAIL_MS after the knob hits 0, then turns off; untouched effects are bypassed (all three on in series = flanger comb + smear,
// "phasey"). FX MIX fades all of them. which effects are loaded:
// effects.xml, written by mixxx-bridge (reverb, echo, flanger).
PUSH3.initFx = function() {
    [1, 2, 3, 4].forEach(function(u) {
        var unit = "[EffectRack1_EffectUnit" + u + "]";
        engine.setValue(unit, "group_[Channel" + u + "]_enable", 1);
        engine.setValue(unit, "mix", 1);
        for (var fx = 1; fx <= 3; fx++) {
            (function(slot, fx) {
                engine.setParameter(slot, "meta", 0);
                PUSH3.watch(slot, "meta", function(v) {
                    if (PUSH3.tailTimers[slot]) {
                        engine.stopTimer(PUSH3.tailTimers[slot]);
                        delete PUSH3.tailTimers[slot];
                    }
                    if (v > 0) {
                        engine.setValue(slot, "enabled", 1);
                    } else if (engine.getValue(slot, "enabled")) {
                        PUSH3.tailTimers[slot] = engine.beginTimer(PUSH3.TAIL_MS, function() {
                            delete PUSH3.tailTimers[slot];
                            engine.setValue(slot, "enabled", 0);
                        }, true);
                    }
                    if (fx === 1) { PUSH3.btn(PUSH3.CC.accent, PUSH3.reverbOn()); }
                });
            })("[EffectRack1_EffectUnit" + u + "_Effect" + fx + "]", fx);
        }
    });
};

// reverb = effect 1 of the deck's effect unit (seedEffects loads Reverb there).
PUSH3.reverb = function(d) { return "[EffectRack1_EffectUnit" + PUSH3.deckNum(d) + "_Effect1]"; };
PUSH3.reverbOn = function() {
    return engine.getParameter(PUSH3.reverb(0), "meta") > 0 || engine.getParameter(PUSH3.reverb(1), "meta") > 0;
};

PUSH3.initPads = function() {
    var COL = PUSH3.COL;
    // pads off first, then light what is mapped.
    for (var n = 36; n < 100; n++) { PUSH3.led(n, COL.off); }

    [0, 1].forEach(function(d) {
        // volume fader: column 3 left, 4 right, bottom FADER_ROWS pads.
        // press row r = r / (rows - 1): bottom = silent, top = full.
        var fcol = 3 + d;
        for (var r = 0; r < PUSH3.FADER_ROWS; r++) {
            (function(r) {
                PUSH3.onPad(PUSH3.padNote(r, fcol), function(down) {
                    if (down) { engine.setValue(PUSH3.decks[d], "volume", r / (PUSH3.FADER_ROWS - 1)); }
                });
            })(r);
        }
        var col0 = d === 0 ? 0 : 5;
        PUSH3.PADS.forEach(function(cells, i) {
            var row = 7 - i;
            cells.forEach(function(cell, c) {
                if (cell.length) { PUSH3.addPad(d, PUSH3.padNote(row, col0 + c), cell[0], cell[1]); }
            });
        });
        Object.keys(PUSH3.INNER).forEach(function(row) {
            PUSH3.addPad(d, PUSH3.padNote(+row, fcol), PUSH3.INNER[row]);
        });
    });
};

PUSH3.addPad = function(d, note, kind, arg) {
    PUSH3.bindPad(d, note, kind, arg);
    PUSH3.padFeedback.push([d, note, kind, arg]);
};

// press handler for one pad function. d = side; the deck is read at press time.
PUSH3.bindPad = function(d, note, kind, arg) {
    var g = function() { return PUSH3.decks[d]; };
    var hold = function(key) { PUSH3.onPad(note, function(down) { engine.setValue(g(), key, down ? 1 : 0); }); };
    var tap = function(key) { PUSH3.onPad(note, function(down) { if (down) { engine.setValue(g(), key, 1); } }); };
    var toggle = function(key) { PUSH3.onPad(note, function(down) { if (down) { script.toggleControl(g(), key); } }); };

    switch (kind) {
    case "hotcue":
        PUSH3.onPad(note, function(down) {
            if (PUSH3.deleteHeld) {
                if (down) { engine.setValue(g(), "hotcue_" + arg + "_clear", 1); }
                return;
            }
            engine.setValue(g(), "hotcue_" + arg + "_activate", down ? 1 : 0);
        });
        break;
    case "beatloop": tap("beatloop_" + arg + "_toggle"); break;
    case "reloop": tap("reloop_toggle"); break;
    case "loop_in": case "loop_out": hold(kind); break;
    case "loop_halve": case "loop_double": case "beatjump_back": case "beatjump_fwd":
        tap(kind === "beatjump_fwd" ? "beatjump_forward" : kind === "beatjump_back" ? "beatjump_backward" : kind);
        break;
    case "sync": toggle("sync_enabled"); break;
    case "slip": toggle("slip_enabled"); break;
    case "pfl": case "keylock": case "quantize": toggle(kind); break;
    }
};

// LED feedback for one pad function, on the deck the side controls now.
PUSH3.padLed = function(d, note, kind, arg) {
    var COL = PUSH3.COL;
    var light = function(key, idle, on) {
        PUSH3.dwatch(d, key, function(v) { PUSH3.led(note, v ? on : idle); });
    };
    switch (kind) {
    case "hotcue": light("hotcue_" + arg + "_status", COL.cueEmpty, PUSH3.HOTCUE[arg - 1]); break;
    case "beatloop": light("beatloop_" + arg + "_enabled", COL.loopIdle, COL.loopOn); break;
    case "reloop": light("loop_enabled", COL.loopIdle, COL.loopOn); break;
    case "beatjump_back": PUSH3.led(note, COL.jumpBack); break;
    case "beatjump_fwd": PUSH3.led(note, COL.jumpFwd); break;
    case "sync": light("sync_enabled", COL.syncIdle, COL.syncOn); break;
    case "slip": light("slip_enabled", COL.slipIdle, COL.slipOn); break;
    case "pfl": light("pfl", COL.pflIdle, COL.pflOn); break;
    case "keylock": light("keylock", COL.keylockIdle, COL.keylockOn); break;
    case "quantize": light("quantize", COL.quantizeIdle, COL.quantizeOn); break;
    default: PUSH3.led(note, COL.loopIdle);
    }
};

PUSH3.shutdown = function() {
    PUSH3.conns.concat(PUSH3.deckConns).forEach(function(c) { c.disconnect(); });
    for (var n = 36; n < 100; n++) { PUSH3.led(n, PUSH3.COL.off); }
    for (var cc = 0; cc < 128; cc++) { midi.sendShortMsg(0xB0, cc, 0); }
};
