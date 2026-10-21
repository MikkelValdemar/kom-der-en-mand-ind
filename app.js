(() => {
  "use strict";

  const CONFIG_KEY = "escape.config";
  const DEFAULT_CONFETTI = ["#f2c14e", "#e8743b", "#7cc6a4", "#f7a1c4", "#8ab6f9", "#ffffff"];
  const CHARSETS = {
    digits: "0-9",
    alnum: "0-9A-ZÆØÅÄÖÜ",
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const normalize = (s) => String(s ?? "").replace(/[\s-]/g, "").toUpperCase();

  // Dashes in an answer split the code boxes into groups: "1A-2B-3C" → [2, 2, 2].
  // Symbols in an answer that its charset doesn't cover (e.g. "#") can still be typed.
  function extraChars(answer, charset) {
    const base = new RegExp(`[${CHARSETS[charset] || CHARSETS.alnum}]`);
    return [...new Set(normalize(answer))].filter((c) => !base.test(c)).join("");
  }

  function groupsOf(answer) {
    const groups = String(answer ?? "").split("-").map((part) => normalize(part).length).filter(Boolean);
    return groups.length ? groups : [1];
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function roman(n) {
    const map = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
      [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
    return out;
  }

  // Restart a CSS animation class on an element.
  function replay(node, cls, duration) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
    if (duration) setTimeout(() => node.classList.remove(cls), duration);
  }

  /* ---------- Storage ---------- */

  // Only the setup is stored, so the admin page survives a reload.
  // Progress lives in memory: reloading the page starts the game over.
  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
  };

  const newId = () => "p" + Math.random().toString(36).slice(2, 9);

  // Each puzzle has a stable id so its recording follows it when puzzles are reordered.
  function blankPuzzle() {
    return { id: newId(), title: "", helpText: "", answer: "", charset: "digits", successText: "", failureText: "", audioFile: "", hint: "", gateCode: "" };
  }

  function normalizeConfig(raw) {
    const base = clone(window.DEFAULT_CONFIG);
    if (!raw || typeof raw !== "object") return base;
    const text = (key) => (typeof raw[key] === "string" ? raw[key] : base[key]);
    return {
      title: text("title"),
      introTitle: text("introTitle"),
      introText: text("introText"),
      puzzles: Array.isArray(raw.puzzles)
        ? raw.puzzles.map((p) => ({ ...blankPuzzle(), ...p }))
        : base.puzzles,
      breach: { ...base.breach, ...(raw.breach || {}) },
      final: { ...base.final, ...(raw.final || {}) },
    };
  }

  function loadConfig() {
    const raw = store.get(CONFIG_KEY);
    const config = normalizeConfig(raw);
    // Persist ids handed out to an older setup, so the game and admin agree on them.
    if (Array.isArray(raw?.puzzles) && raw.puzzles.some((p) => !p.id)) store.set(CONFIG_KEY, config);
    return config;
  }

  let progress = 0;
  let started = false;
  const loadProgress = () => progress;
  const saveProgress = (index) => { progress = index; };

  const pad = (n) => String(n).padStart(2, "0");

  // The game's stages in order: the puzzles, then the CPR-register hack, then the card.
  // In a real CPR number the last digit is odd for a boy and even for a girl.
  const isBoy = (final) => Number(normalize(final.cpr).slice(-1)) % 2 === 1;

  function stagesOf(cfg) {
    const stages = cfg.puzzles.map((puzzle, i) => ({
      kind: "puzzle",
      puzzle,
      key: puzzle.id,
      label: pad(i + 1),
      name: `Puzzle ${roman(i + 1)}${puzzle.title ? " – " + puzzle.title : ""}`,
    }));
    if (cfg.breach.enabled) stages.push({ kind: "breach", key: "breach", label: pad(cfg.puzzles.length + 1), name: "CPR-register hack" });
    if (cfg.final.enabled) stages.push({ kind: "final", key: "final", label: "???", name: "Final card (Sundhedskort)" });
    return stages;
  }
  const stageCount = (cfg) => stagesOf(cfg).length;

  function parseColors(str) {
    const colors = String(str || "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c && CSS.supports("color", c));
    return colors.length ? colors : DEFAULT_CONFETTI;
  }

  /* ---------- Confetti ---------- */

  const confetti = (() => {
    const canvas = $("#confetti");
    const ctx = canvas.getContext("2d");
    let parts = [];
    let raf = 0;
    let w = 0;
    let h = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener("resize", resize);
    resize();

    function burst(x, y, angle, spread, count, colors, power) {
      for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * spread;
        const v = power * (0.55 + Math.random() * 0.65);
        parts.push({
          x, y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          size: 6 + Math.random() * 7,
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.35,
          tilt: Math.random() * Math.PI * 2,
          vt: 0.06 + Math.random() * 0.12,
          wobble: Math.random() * 10,
          color: colors[(Math.random() * colors.length) | 0],
          round: Math.random() < 0.22,
        });
      }
      if (!raf) raf = requestAnimationFrame(tick);
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      parts = parts.filter((p) => p.y < h + 40 && p.x > -60 && p.x < w + 60);
      for (const p of parts) {
        p.vx *= 0.986;
        p.vy = p.vy * 0.986 + 0.24;
        if (p.vy > 5.5) p.vy = 5.5;
        p.wobble += 0.08;
        p.x += p.vx + Math.sin(p.wobble) * 0.6;
        p.y += p.vy;
        p.rot += p.vr;
        p.tilt += p.vt;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.cos(p.tilt));
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6);
        }
        ctx.restore();
      }
      if (parts.length) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        ctx.clearRect(0, 0, w, h);
      }
    }

    async function celebrate(colors) {
      const power = Math.sqrt(h) * 0.85;
      burst(0, h, -Math.PI / 3, 0.7, 140, colors, power);
      burst(w, h, (-2 * Math.PI) / 3, 0.7, 140, colors, power);
      await wait(650);
      burst(w / 2, h * 0.35, -Math.PI / 2, Math.PI * 1.6, 160, colors, power * 0.55);
      await wait(900);
      burst(0, h, -Math.PI / 2.6, 0.6, 90, colors, power);
      burst(w, h, -Math.PI + Math.PI / 2.6, 0.6, 90, colors, power);
      for (let i = 0; i < 4; i++) {
        await wait(500);
        for (let k = 0; k < 40; k++) {
          burst(Math.random() * w, -20, Math.PI / 2, 0.6, 1, colors, 2);
        }
      }
    }

    return { celebrate };
  })();

  /* ---------- Recordings ---------- */

  // Recordings are stored in IndexedDB (localStorage is too small for audio), keyed by puzzle id or "final".
  const clips = (() => {
    let dbPromise = null;
    const open = () => (dbPromise ||= new Promise((resolve, reject) => {
      const req = indexedDB.open("escape-audio", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("clips");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    async function run(mode, fn) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction("clips", mode);
        const req = fn(tx.objectStore("clips"));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
      });
    }
    return {
      get: (key) => run("readonly", (s) => s.get(key)).catch(() => null),
      keys: () => run("readonly", (s) => s.getAllKeys()).catch(() => []),
      set: (key, clip) => run("readwrite", (s) => s.put(clip, key)),
      remove: (key) => run("readwrite", (s) => s.delete(key)),
    };
  })();

  // Recordings can also be put in the audio/ folder next to index.html and named in the admin page.
  const audioFileUrl = (name) =>
    "audio/" + String(name).trim().replace(/^(\.\/)?audio\//, "").split("/").map(encodeURIComponent).join("/");

  function audioFileExists(name) {
    return new Promise((resolve) => {
      const probe = new Audio();
      probe.preload = "metadata";
      probe.addEventListener("loadedmetadata", () => resolve(true), { once: true });
      probe.addEventListener("error", () => resolve(false), { once: true });
      setTimeout(() => resolve(false), 5000);
      probe.src = audioFileUrl(name);
    });
  }

  const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

  const player = (() => {
    const audio = new Audio();
    let url = null;
    let button = null;
    let unlocked = false;

    const sync = () => button?.classList.toggle("playing", !audio.paused);
    for (const ev of ["play", "pause", "ended"]) audio.addEventListener(ev, sync);

    function stop() {
      audio.pause();
      try { audio.currentTime = 0; } catch { /* no source yet */ }
    }

    function play(btn) {
      if (btn && btn !== button) return;
      try { audio.currentTime = 0; } catch { /* no source yet */ }
      audio.play().then(
        () => button?.classList.remove("nudge"),
        () => button?.classList.add("nudge"),
      );
    }

    return {
      // Browsers only allow sound after a click; playing silence inside one unlocks later playback.
      unlock() {
        if (unlocked) return;
        unlocked = true;
        if (!audio.paused) return;
        audio.src = SILENT_WAV;
        audio.play().catch(() => {});
      },
      // An uploaded recording wins; otherwise the named file in the audio/ folder is used.
      async load(key, btn, file) {
        stop();
        button = btn;
        const clip = await clips.get(key);
        let src = null;
        if (clip?.blob) {
          if (url) URL.revokeObjectURL(url);
          url = URL.createObjectURL(clip.blob);
          src = url;
        } else if (String(file || "").trim() && (await audioFileExists(file))) {
          src = audioFileUrl(file);
        }
        if (!src || button !== btn) return false;
        audio.src = src;
        btn.hidden = false;
        return true;
      },
      play,
      stop,
      toggle() {
        if (audio.paused) play();
        else stop();
      },
    };
  })();

  const SPEAKER_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cone" d="M3.5 9h3.8L12 5v14l-4.7-4H3.5z"/><path class="wave w1" d="M15.3 9.3a3.8 3.8 0 0 1 0 5.4"/><path class="wave w2" d="M17.9 6.7a7.5 7.5 0 0 1 0 10.6"/></svg>';

  function audioButton() {
    const button = el("button", "audio-btn");
    button.type = "button";
    button.hidden = true;
    button.title = "Afspil igen";
    button.setAttribute("aria-label", "Afspil igen");
    button.innerHTML = SPEAKER_SVG;
    return button;
  }

  async function attachAudio(content, key, autoplay, file) {
    const button = content.querySelector(".audio-btn");
    if (!button || !(await player.load(key, button, file))) return;
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      player.toggle();
    });
    if (content.audioGate) {
      button.hidden = true;
      await content.audioGate;
      button.hidden = false;
      button.classList.add("fade-in");
      player.play(button);
      return;
    }
    if (autoplay) setTimeout(() => player.play(button), 650);
  }

  /* ---------- PIN input ---------- */

  function createPinInput({ groups, charset, variant, extra = "" }) {
    const total = groups.reduce((a, b) => a + b, 0);
    const escaped = extra.replace(/[\\\]^-]/g, "\\$&");
    const filter = new RegExp(`[^${CHARSETS[charset] || CHARSETS.alnum}${escaped}]`, "g");
    const root = el("div", "pin" + (variant ? " " + variant : ""));
    const row = el("div", "slots");
    row.style.setProperty("--n", total);
    const slots = [];

    groups.forEach((len, g) => {
      if (g > 0) row.append(el("span", "sep", "–"));
      for (let i = 0; i < len; i++) {
        const slot = el("span", "slot");
        slot.style.setProperty("--i", slots.length);
        slots.push(slot);
        row.append(slot);
      }
    });

    const input = document.createElement("input");
    input.className = "pin-input";
    input.type = "text";
    input.maxLength = total;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "characters");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("aria-label", "Kode");
    // The phone keypad ("tel") also has # * +, the plain number pad doesn't.
    input.inputMode = charset !== "digits" ? "text" : !extra ? "numeric" : /^[#*+]+$/.test(extra) ? "tel" : "text";
    row.append(input);
    root.append(row);

    let handler = () => {};

    function render() {
      const value = input.value;
      const focused = document.activeElement === input && !input.disabled;
      slots.forEach((slot, i) => {
        const ch = value[i] || "";
        if (slot.textContent !== ch) {
          slot.textContent = ch;
          if (ch) replay(slot, "pop");
        }
        slot.classList.toggle("filled", !!ch);
        slot.classList.toggle("active", focused && i === Math.min(value.length, total - 1) && value.length < total);
      });
    }

    const toEnd = () => {
      const n = input.value.length;
      try { input.setSelectionRange(n, n); } catch { /* not supported */ }
    };

    input.addEventListener("input", () => {
      const clean = input.value.toUpperCase().replace(filter, "").slice(0, total);
      if (clean !== input.value) input.value = clean;
      render();
      if (clean.length === total) handler(clean);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && input.value.length === total) {
        e.preventDefault();
        handler(input.value);
      }
    });
    input.addEventListener("focus", () => { toEnd(); render(); });
    input.addEventListener("click", toEnd);
    input.addEventListener("blur", render);

    return {
      el: root,
      input,
      onComplete(fn) { handler = fn; },
      focus() { if (!input.disabled) input.focus({ preventScroll: true }); },
      clear() { input.value = ""; render(); },
      setValue(v) { input.value = v; render(); },
      lock(locked) { input.disabled = locked; render(); },
      setState(state) { root.dataset.state = state || ""; },
    };
  }

  /* ---------- Game ---------- */

  const stage = $("#stage");
  const titleEl = $("#game-title");
  const statusEl = $("#game-status");
  const nodesEl = $("#nodes");

  let config = loadConfig();
  let activePin = null;
  let busy = false;
  let stageToken = 0;

  // Fills a node with invisible "ghost" text so the layout is final before typing starts.
  function setGhost(node, text) {
    node.replaceChildren(el("span", "typed"), el("span", "ghost", String(text ?? "")));
  }

  // Types text into a node one character at a time; stops quietly if the stage changes.
  async function typeText(node, text, speed = 28) {
    const token = stageToken;
    text = String(text ?? "");
    setGhost(node, text);
    if (!text) return;
    const [typed, ghost] = node.children;
    node.classList.add("typing");
    for (let i = 1; i <= text.length; i++) {
      if (token !== stageToken) return;
      typed.textContent = text.slice(0, i);
      ghost.textContent = text.slice(i);
      const ch = text[i - 1];
      await wait(ch === "\n" ? speed * 8 : /[.,!?:]/.test(ch) ? speed * 4 : speed);
    }
    node.classList.remove("typing");
  }

  function renderNodes(solved) {
    const labels = stagesOf(config).map((s) => s.label);
    const n = labels.length;
    if ([...nodesEl.children].map((c) => c.textContent).join() !== labels.join()) {
      nodesEl.replaceChildren(...labels.map((label) => el("div", "node", label)));
    }
    [...nodesEl.children].forEach((node, k) => {
      node.classList.toggle("lit", k < solved);
      node.classList.toggle("current", k === solved);
    });
    statusEl.textContent = n ? `${pad(Math.min(solved, n))}/${pad(n)}` : "";
  }

  function unlockNode(k) {
    const node = nodesEl.children[k];
    if (!node) return;
    node.classList.remove("current");
    node.classList.add("lit");
    replay(node, "unlocking", 1200);
    const n = stageCount(config);
    statusEl.textContent = `${pad(k + 1)}/${pad(n)}`;
  }

  function showBanner(node, granted, text) {
    node.textContent = text || (granted ? "KORREKT" : "FORKERT");
    node.dataset.text = node.textContent;
    node.className = "banner " + (granted ? "granted" : "denied");
    replay(node, "show");
  }

  function showMessage(node, text, kind, speed = 22) {
    node.className = "message " + kind;
    return typeText(node, text, speed);
  }

  async function swapStage(content, animate) {
    const scene = el("div", "scene");
    scene.append(content);
    const old = stage.firstElementChild;
    if (old && animate) {
      old.classList.add("leaving");
      await wait(420);
    }
    stage.replaceChildren(scene);
    activePin?.focus();
  }

  // Recolors the whole page: "girl", "boy" or "" for the default green.
  function setTheme(theme) {
    document.documentElement.classList.toggle("girl", theme === "girl");
    document.documentElement.classList.toggle("boy", theme === "boy");
  }

  function renderGame({ animate = false } = {}) {
    config = loadConfig();
    setTheme("");
    stageToken++;
    const stages = stagesOf(config);
    const n = stages.length;
    const index = Math.min(loadProgress(), n);
    const current = stages[index];
    busy = false;
    activePin = null;

    titleEl.textContent = config.title;
    titleEl.dataset.text = config.title;
    document.title = config.title || "Escape";
    renderNodes(index);

    let content;
    let audioKey = current?.key ?? null;
    if (index === 0 && !started && n > 0) {
      content = startPanel();
      audioKey = null;
    } else if (current?.kind === "puzzle") {
      content = puzzlePanel(current.puzzle, index);
    } else if (current?.kind === "breach") {
      content = breachPanel(index);
    } else if (current?.kind === "final") {
      content = cardStage(false);
    } else if (stages[n - 1]?.kind === "final") {
      content = cardStage(true);
      audioKey = "final";
    } else {
      content = endPanel(n === 0);
    }

    // Scanlines are switched off while the card is shown so it stays sharp.
    document.body.classList.toggle("card-mode", content.classList.contains("card-stage"));
    player.stop();
    swapStage(content, animate).then(() => content.onShow?.());
    const audioFile = current?.kind === "puzzle" ? current.puzzle.audioFile : config[current?.kind ?? "final"]?.audioFile;
    if (audioKey) attachAudio(content, audioKey, index < n, audioFile);
  }

  function terminal(id, title, status = "● SECURE") {
    const term = el("section", "term");
    const bar = el("div", "term-bar");
    bar.append(el("span", "term-id", id), el("span", "term-title", title), el("span", "term-secure", status));
    const body = el("div", "term-body");
    term.append(bar, body);
    return { term, body };
  }

  function startPanel() {
    const { term, body } = terminal("BOOT", "secure-shell v2.6");
    const log = el("div", "boot-log");
    const title = el("h2", "puzzle-title");
    const help = el("p", "help");
    const actions = el("div", "actions");
    const button = el("button", "btn", "Begynd");
    button.type = "button";
    button.hidden = true;
    button.addEventListener("click", () => {
      started = true;
      player.unlock();
      renderGame({ animate: true });
    }, { once: true });
    actions.append(button);
    body.append(log, title, help, actions);
    setGhost(title, config.introTitle);
    setGhost(help, config.introText);

    const lines = [
      ["INITIALIZING SECURE SHELL", "OK"],
      ["LOADING DECRYPTION MODULES", "OK"],
      ["ESTABLISHING CONNECTION", "OK"],
      ["SCANNING FOR LOCKS", `${stageCount(config)} FOUND`],
    ];

    term.onShow = async () => {
      const token = stageToken;
      for (const [text, result] of lines) {
        const line = el("div", "boot-line");
        const label = el("span", "label");
        const dots = el("span", "dots");
        const res = el("span", "res", result);
        res.hidden = true;
        line.append(label, dots, res);
        log.append(line);
        await typeText(label, "> " + text, 14);
        for (let i = 0; i < 8; i++) {
          if (token !== stageToken) return;
          dots.textContent += " . . .";
          await wait(45);
        }
        res.hidden = false;
        await wait(140);
      }
      if (token !== stageToken) return;
      await typeText(title, config.introTitle, 45);
      await typeText(help, config.introText, 24);
      if (token !== stageToken) return;
      button.hidden = false;
      button.focus({ preventScroll: true });
    };
    return term;
  }

  function breachPanel(index) {
    const b = config.breach;
    const code = normalize(b.code) || "123456";
    const panel = puzzlePanel({
      title: b.title,
      helpText: String(b.helpText || "").replaceAll("{code}", code),
      answer: code,
      charset: /\D/.test(code) ? "alnum" : "digits",
      successText: b.successText,
      failureText: b.failureText,
    }, index, { id: "CPR-REG", bar: "/// TOP HEMMELIGT", status: "⚠ RESTRICTED", solvedStatus: "● BREACHED", afterSolve: runHack });
    panel.classList.add("breach");
    return panel;
  }

  const SURNAMES = ["HANSEN", "JENSEN", "NIELSEN", "PEDERSEN", "ANDERSEN", "CHRISTENSEN", "LARSEN", "SØRENSEN", "RASMUSSEN", "JØRGENSEN", "PETERSEN", "MADSEN", "KRISTENSEN", "OLSEN"];
  const hex = (len) => Array.from({ length: len }, () => "0123456789ABCDEF"[(Math.random() * 16) | 0]).join("");

  // The fake "hacking" sequence shown after the CPR-register code is accepted.
  async function runHack(log) {
    const token = stageToken;
    const alive = () => token === stageToken;
    const line = (text, cls) => {
      const node = el("div", "hack-line" + (cls ? " " + cls : ""), text);
      log.append(node);
      return node;
    };
    log.hidden = false;

    for (const step of ["BYPASSING FIREWALL", "INJECTING PAYLOAD", "ESCALATING PRIVILEGES", "DECRYPTING CPR DATABASE"]) {
      const node = line("> " + step + " ");
      for (let i = 0; i < 10; i++) {
        if (!alive()) return;
        node.textContent += ".";
        await wait(40);
      }
      node.append(el("span", "res", " OK"));
    }

    const bar = line("", "bar");
    for (let p = 0; p <= 100; p += 4) {
      if (!alive()) return;
      bar.textContent = `[${"█".repeat(p / 4)}${"░".repeat(25 - p / 4)}] ${String(p).padStart(3)}%  DOWNLOADING RECORDS`;
      await wait(55);
    }

    for (let i = 0; i < 34; i++) {
      if (!alive()) return;
      const name = SURNAMES[(Math.random() * SURNAMES.length) | 0];
      line(`0x${hex(6)}  ██████-████  ${name.padEnd(12)} NO MATCH`, "dim");
      await wait(38);
    }
    if (!alive()) return;
    line("> MATCH FOUND :: 1 RECORD", "hit");
    await wait(450);
    line("> EXTRACTING SUNDHEDSKORT.DAT ... OK", "hit");
    await wait(300);
  }

  function puzzlePanel(puzzle, index, extra = {}) {
    const { term, body } = terminal(extra.id || `LOCK ${pad(index + 1)}`, extra.bar || "/// encrypted", extra.status);
    const title = el("h2", "puzzle-title keep-case");
    const help = el("p", "help");
    const banner = el("div", "banner");
    const message = el("p", "message");
    message.setAttribute("aria-live", "polite");
    const actions = el("div", "actions");

    const pin = createPinInput({ groups: groupsOf(puzzle.answer), charset: puzzle.charset, extra: extraChars(puzzle.answer, puzzle.charset) });
    activePin = pin;

    // An optional gate code has to be entered before the real code boxes and the recording appear.
    const gateCode = String(puzzle.gateCode || "").trim();
    const gate = gateCode ? createPinInput({ groups: groupsOf(gateCode), charset: "alnum", extra: extraChars(gateCode, "alnum") }) : null;
    const revealer = el("div", "gate-reveal");
    let openGate = () => {};
    if (gate) {
      revealer.append(pin.el);
      activePin = gate;
      term.audioGate = new Promise((resolve) => (openGate = resolve));
    }

    const hackLog = el("div", "hack-log");
    hackLog.hidden = true;
    body.append(audioButton(), title, help, el("div", "prompt", "INDTAST KODE"), ...(gate ? [gate.el, revealer] : [pin.el]), banner, hackLog, message, actions);
    if (puzzle.hint === "hex") body.append(hexHint());
    setGhost(title, puzzle.title);
    setGhost(help, puzzle.helpText);
    term.onShow = async () => {
      await typeText(title, puzzle.title, 45);
      await typeText(help, puzzle.helpText, 22);
    };

    const reject = (input) => {
      input.setState("wrong");
      showBanner(banner, false);
      showMessage(message, puzzle.failureText, "fail");
      replay(term, "wrong", 700);
      replay(document.body, "glitch", 500);
      setTimeout(() => {
        input.clear();
        input.setState("");
        input.lock(false);
        input.focus();
        busy = false;
      }, 900);
    };

    gate?.onComplete((value) => {
      if (busy) return;
      busy = true;
      gate.lock(true);
      if (normalize(value) !== normalize(gateCode)) return reject(gate);

      // The gate stays unlocked in green while the real code boxes slide open below it.
      const token = stageToken;
      gate.setState("correct");
      banner.className = "banner";
      message.replaceChildren();
      setTimeout(() => {
        if (token !== stageToken) return;
        revealer.classList.add("open");
        revealer.addEventListener("transitionend", () => revealer.classList.add("done"), { once: true });
        activePin = pin;
        pin.focus();
        openGate();
        busy = false;
      }, 500);
    });

    pin.onComplete((value) => {
      if (busy) return;
      busy = true;
      pin.lock(true);

      if (normalize(value) !== normalize(puzzle.answer)) return reject(pin);

      const token = stageToken;
      pin.setState("correct");
      term.classList.add("solved");
      if (extra.solvedStatus) term.querySelector(".term-secure").textContent = extra.solvedStatus;
      showBanner(banner, true);
      message.replaceChildren();
      unlockNode(index);
      saveProgress(index + 1);

      const next = () => {
        player.unlock();
        renderGame({ animate: true });
      };
      if (puzzle.successText.trim() || extra.afterSolve) {
        const button = el("button", "btn", "Fortsæt");
        button.type = "button";
        button.addEventListener("click", next, { once: true });
        wait(500)
          .then(() => extra.afterSolve?.(hackLog))
          .then(() => token === stageToken && showMessage(message, puzzle.successText, "ok"))
          .then(() => {
            if (token !== stageToken) return;
            actions.append(button);
            button.focus({ preventScroll: true });
          });
      } else {
        setTimeout(next, 1900);
      }
    });

    term.addEventListener("click", () => activePin?.focus());
    return term;
  }

  /* ---------- Hint ---------- */

  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const HEX_GROUPS = [
    ["0–9", range(0x30, 0x39)],
    ["A–Z", range(0x41, 0x5a)],
    ["a–z", range(0x61, 0x7a)],
    ["Æ Ø Å", [0xc6, 0xd8, 0xc5, 0xe6, 0xf8, 0xe5]],
  ];

  // A hint button that asks for confirmation before showing a hex → ASCII table.
  function hexHint() {
    const wrap = el("div", "hint-box");
    const button = el("button", "hint-btn", "? Hint");
    button.type = "button";
    button.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await confirmHint())) return;
      button.replaceWith(hexTable());
      wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    wrap.append(button);
    return wrap;
  }

  function confirmHint() {
    return new Promise((resolve) => {
      const dialog = el("dialog", "warn");
      const yes = el("button", "btn", "Ja, vis hint");
      const no = el("button", "btn", "Nej");
      yes.type = no.type = "button";
      const buttons = el("div", "warn-actions");
      buttons.append(no, yes);
      dialog.append(
        el("div", "warn-title", "⚠ Advarsel"),
        el("p", "warn-text", "Dette er et hint – er du sikker på, at du vil fortsætte?"),
        buttons,
      );
      const close = (value) => {
        dialog.close();
        dialog.remove();
        resolve(value);
      };
      yes.addEventListener("click", () => close(true));
      no.addEventListener("click", () => close(false));
      dialog.addEventListener("cancel", (e) => {
        e.preventDefault();
        close(false);
      });
      document.body.append(dialog);
      dialog.showModal();
      no.focus();
    });
  }

  function hexTable() {
    const table = el("div", "hex-table");
    table.append(el("div", "hex-head", "HEX → ASCII"));
    for (const [label, codes] of HEX_GROUPS) {
      const grid = el("div", "hex-grid");
      for (const code of codes) {
        const cell = el("div", "hex-cell");
        cell.append(el("b", "", code.toString(16).toUpperCase().padStart(2, "0")), el("span", "", String.fromCharCode(code)));
        grid.append(cell);
      }
      table.append(el("div", "hex-label", label), grid);
    }
    return table;
  }

  function cardStage(solved) {
    const f = config.final;
    const wrap = el("section", "card-stage");
    const head = el("div", "card-head");
    const title = el("h2", "puzzle-title keep-case");
    const help = el("p", "card-help");
    const banner = el("div", "banner");
    const message = el("p", "message");
    message.setAttribute("aria-live", "polite");

    const card = el("div", "hc");
    card.innerHTML = `
      <div class="hc-region">
        <svg class="hc-logo" viewBox="0 0 48 48" aria-hidden="true">
          <rect width="48" height="48" fill="#e3e6f0"/>
          <rect width="13" height="48" fill="#4b5789"/>
          <text x="6.5" y="24" transform="rotate(-90 6.5 24)" fill="#fff" font-size="6" font-weight="700" letter-spacing=".5" text-anchor="middle" dominant-baseline="central">REGION</text>
          <text class="hc-logo-letter" x="30.5" y="26" fill="#56639c" font-size="38" font-weight="700" text-anchor="middle" dominant-baseline="central"></text>
        </svg>
        <div class="hc-region-name" data-f="region"></div>
      </div>
      <div class="hc-muni">
        <div class="hc-muni-name" data-f="municipality"></div>
        <div data-f="municipalityPhone"></div>
      </div>
      <div class="hc-side left">SUNDHEDSKORT</div>
      <div class="hc-side right">SUNDHEDSKORT</div>
      <div class="hc-panel">
        <div class="hc-doctor">
          <div class="hc-small">Læge:</div>
          <div class="hc-doc-name" data-f="doctor"></div>
          <div class="hc-doc-row"><span data-f="doctorAddress"></span><span data-f="doctorPhone"></span></div>
        </div>
        <div class="hc-person">
          <div class="hc-cpr"></div>
          <div class="hc-group"><span class="hc-small">Sikr.<br>gr.</span><b data-f="group"></b></div>
          <div class="hc-valid"><span class="hc-small">Gyldig fra:</span><span data-f="validFrom"></span></div>
          <div class="hc-addr"><div data-f="name"></div><div data-f="address"></div></div>
          <div class="hc-akut"><b data-f="emergencyNumber"></b><span>AKUTTELEFONEN</span></div>
        </div>
      </div>
      <div class="hc-barcode">${barcodeSvg()}</div>`;

    const phone = (v) => {
      const digits = String(v || "").trim().replace(/^tlf\.?\s*/i, "");
      return digits ? "Tlf. " + digits : "";
    };
    const text = { ...f, municipalityPhone: phone(f.municipalityPhone), doctorPhone: phone(f.doctorPhone) };
    card.querySelectorAll("[data-f]").forEach((node) => { node.textContent = text[node.dataset.f] ?? ""; });
    const regionWords = String(f.region || "").trim().split(/\s+/);
    card.querySelector(".hc-logo-letter").textContent = (regionWords[regionWords.length - 1] || "H")[0].toUpperCase();
    card.querySelector(".hc-akut").hidden = !String(f.emergencyNumber || "").trim();

    const answer = normalize(f.cpr);
    const groups = answer.length === 10 ? [6, 4] : [Math.max(1, answer.length)];
    const pin = createPinInput({ groups, charset: "digits", variant: "card" });
    card.querySelector(".hc-cpr").append(pin.el);
    wrap.append(head, title, help, audioButton(), card, banner, message);

    const headText = "> DECRYPTING RECORD :: SUNDHEDSKORT.DAT";
    setGhost(head, headText);
    setGhost(title, f.title);
    setGhost(help, f.helpText);

    const win = (celebrate) => {
      pin.setValue(answer);
      pin.lock(true);
      pin.setState("correct");
      card.classList.add("won");
      const boy = isBoy(f);
      // U+FE0E keeps the sign as a text glyph instead of an emoji.
      showBanner(banner, true, boy ? "♂\uFE0E" : "♀\uFE0E");
      banner.classList.add("sign");
      showMessage(message, boy ? f.successTextBoy : f.successTextGirl, "ok", 60);
      setTimeout(() => message.scrollIntoView({ behavior: "smooth", block: "nearest" }), 400);
      const colors = parseColors(boy ? f.confettiColorsBoy : f.confettiColorsGirl);
      setTimeout(() => setTheme(boy ? "boy" : "girl"), 250);
      if (celebrate) setTimeout(() => confetti.celebrate(colors), 250);
    };

    const reveal = () => {
      card.classList.add("revealed");
      setTimeout(() => card.classList.add("done"), 1400);
    };

    if (solved) {
      card.classList.add("revealed", "done");
      wrap.onShow = () => {
        setGhost(head, "");
        head.textContent = headText;
        setGhost(title, "");
        title.textContent = f.title;
        setGhost(help, "");
        help.textContent = f.helpText;
        win(true);
      };
      return wrap;
    }

    wrap.onShow = async () => {
      await typeText(head, headText, 18);
      await typeText(title, f.title, 45);
      reveal();
      await wait(900);
      await typeText(help, f.helpText, 22);
    };

    activePin = pin;
    pin.onComplete((value) => {
      if (busy) return;
      busy = true;
      pin.lock(true);

      if (normalize(value) === answer) {
        unlockNode(stageCount(config) - 1);
        saveProgress(stageCount(config));
        win(true);
        return;
      }

      pin.setState("wrong");
      showBanner(banner, false);
      showMessage(message, f.failureText, "fail");
      replay(card, "wrong", 900);
      replay(document.body, "glitch", 500);
      setTimeout(() => {
        pin.clear();
        pin.setState("");
        pin.lock(false);
        pin.focus();
        busy = false;
      }, 900);
    });

    card.addEventListener("click", () => pin.focus());
    return wrap;
  }

  // Decorative only: the bars come from a fixed seed and never encode the CPR answer.
  function barcodeSvg() {
    let seed = 1813;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const widths = [1, 1, 1, 1];
    while (widths.length < 64) widths.push(1 + Math.floor(rnd() * 3));
    widths.push(1, 1, 1, 1);
    let x = 0;
    let rects = "";
    widths.forEach((w, i) => {
      if (i % 2 === 0) rects += `<rect x="${x}" width="${w}" height="40"/>`;
      x += w;
    });
    return `<svg viewBox="0 0 ${x} 40" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
  }

  function endPanel(empty) {
    const { term, body } = terminal("SYSTEM", "/// status");
    const title = el("h2", "puzzle-title");
    body.append(title);
    const text = empty ? "NO LOCKS CONFIGURED" : "ALL";
    setGhost(title, text);
    term.onShow = () => typeText(title, text, 45);
    if (!empty) term.classList.add("solved");
    return term;
  }

  // Typing anywhere on the game screen goes to the code input.
  document.addEventListener("keydown", (e) => {
    if ($("#game").hidden || !activePin || e.metaKey || e.ctrlKey || e.altKey) return;
    const focused = document.activeElement;
    if (focused?.tagName === "INPUT" || focused?.tagName === "TEXTAREA") return;
    if (focused?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " " || focused.classList.contains("btn"))) return;
    activePin.focus();
  });

  // Faint falling hex characters behind everything.
  function startRain() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = $("#rain");
    const ctx = canvas.getContext("2d");
    const size = 18;
    let cols = [];
    let w = 0;
    let h = 0;

    function resize() {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      cols = Array.from({ length: Math.ceil(w / size) }, () => Math.floor(Math.random() * -60));
    }
    window.addEventListener("resize", resize);
    resize();

    setInterval(() => {
      // Colours come from the theme tokens so the rain follows the pink/blue reveal.
      const css = getComputedStyle(document.documentElement);
      const fg = css.getPropertyValue("--fg").trim();
      const soft = css.getPropertyValue("--fg-soft").trim();
      ctx.fillStyle = "rgba(1, 2, 2, 0.14)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = `${size}px VT323, monospace`;
      cols.forEach((row, i) => {
        if (row >= 0) {
          ctx.fillStyle = Math.random() < 0.08 ? soft : fg;
          ctx.fillText("0123456789ABCDEF"[(Math.random() * 16) | 0], i * size, row * size);
        }
        cols[i] = row * size > h && Math.random() > 0.97 ? Math.floor(Math.random() * -20) : row + 1;
      });
    }, 75);
  }

  /* ---------- Admin ---------- */

  const admin = (() => {
    const root = $("#admin");
    const list = $("#puzzle-list");
    const status = $("#save-status");
    const saveButton = root.querySelector('[data-act="save"]');
    const jumpSelect = $("#jump-select");
    const importFile = $("#import-file");
    const audioFile = $("#audio-file");
    let draft = null;
    let dirty = false;

    const getPath = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
    function setPath(obj, path, value) {
      const keys = path.split(".");
      const last = keys.pop();
      keys.reduce((o, k) => o[k], obj)[last] = value;
    }

    function setStatus(text, kind = "") {
      status.textContent = text;
      status.className = "save-status " + kind;
    }

    function markDirty() {
      dirty = true;
      saveButton.classList.add("dirty");
      setStatus("Unsaved changes", "dirty");
    }

    function answerHint(p) {
      const v = normalize(p.answer);
      if (!v) return { text: "An answer is required", bad: true };
      if (p.charset === "digits" && /[A-ZÆØÅÄÖÜ]/.test(v)) return { text: "Contains letters – choose “Letters + digits”", bad: true };
      const extra = extraChars(p.answer, p.charset);
      const symbols = extra ? ` · also allows ${[...extra].join(" ")}` : "";
      const groups = groupsOf(p.answer);
      if (groups.length > 1) return { text: `${v.length} characters in ${groups.length} groups (${groups.join("-")})${symbols}`, bad: false };
      return { text: `${v.length}-character code${symbols}`, bad: false };
    }

    function cprHint(f) {
      const v = normalize(f.cpr);
      if (!/^\d{10}$/.test(v)) return { text: "Must be 10 digits (DDMMYY-XXXX)", bad: true };
      const odd = Number(v[9]) % 2 === 1;
      return {
        text: `${v.slice(0, 6)}-${v.slice(6)} · born ${v.slice(0, 2)}.${v.slice(2, 4)}.${v.slice(4, 6)} · last digit ${odd ? "odd → boy" : "even → girl"}`,
        bad: false,
      };
    }

    function validate() {
      const errors = [];
      draft.puzzles.forEach((p, i) => {
        const hint = answerHint(p);
        if (hint.bad) errors.push(`Puzzle ${i + 1}: ${hint.text.toLowerCase()}`);
      });
      if (draft.breach.enabled && !normalize(draft.breach.code)) errors.push("CPR-register hack: a code is required");
      if (draft.final.enabled && cprHint(draft.final).bad) errors.push("Final card: CPR must be 10 digits");
      return errors;
    }

    function updateHints() {
      draft.puzzles.forEach((p, i) => {
        const node = list.querySelector(`[data-hint="${i}"]`);
        if (!node) return;
        const hint = answerHint(p);
        node.textContent = hint.text;
        node.classList.toggle("bad", hint.bad);
      });
      const cpr = cprHint(draft.final);
      const cprNode = $("#cpr-hint");
      cprNode.textContent = cpr.text;
      cprNode.classList.toggle("bad", cpr.bad);
      const gender = cpr.bad ? "" : isBoy(draft.final) ? "boy" : "girl";
      root.querySelectorAll("[data-gender]").forEach((b) => b.classList.toggle("active", b.dataset.gender === gender));

      for (const g of ["Boy", "Girl"]) {
        $(`#confetti-swatches-${g.toLowerCase()}`).replaceChildren(...parseColors(draft.final[`confettiColors${g}`]).map((c) => {
          const dot = el("i");
          dot.style.background = c;
          return dot;
        }));
      }
    }

    function puzzleCard(i, count) {
      const card = el("article", "pz");
      card.innerHTML = `
        <header class="pz-head">
          <span class="pz-num">${roman(i + 1)}</span>
          <input data-path="puzzles.${i}.title" placeholder="Puzzle title" aria-label="Puzzle title" autocomplete="off">
          <div class="pz-tools">
            <button type="button" class="btn-admin" data-act="up" data-i="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
            <button type="button" class="btn-admin" data-act="down" data-i="${i}" title="Move down" ${i === count - 1 ? "disabled" : ""}>↓</button>
            <button type="button" class="btn-admin danger" data-act="remove" data-i="${i}" title="Delete puzzle">✕</button>
          </div>
        </header>
        <div class="grid">
          <label class="field span2"><span>Help text</span><textarea data-path="puzzles.${i}.helpText" rows="3"></textarea></label>
          <label class="field"><span>Answer</span><input data-path="puzzles.${i}.answer" class="mono" autocomplete="off"><small class="hint" data-hint="${i}"></small></label>
          <label class="field"><span>Allowed characters</span>
            <select data-path="puzzles.${i}.charset">
              <option value="digits">Digits only (0–9)</option>
              <option value="alnum">Letters + digits</option>
            </select>
          </label>
          <label class="field"><span>Success text</span><textarea data-path="puzzles.${i}.successText" rows="2" placeholder="Empty = continue automatically"></textarea></label>
          <label class="field"><span>Failure text</span><textarea data-path="puzzles.${i}.failureText" rows="2"></textarea></label>
          <label class="field"><span>Gate code (must be typed before the code boxes and recording appear)</span><input data-path="puzzles.${i}.gateCode" class="mono" autocomplete="off" placeholder="Empty = no gate"></label>
          <label class="field"><span>Hint button (asks “are you sure?” before showing)</span>
            <select data-path="puzzles.${i}.hint">
              <option value="">No hint</option>
              <option value="hex">Hex → ASCII table</option>
            </select>
          </label>
          <div class="field span2"><span>Recording (plays when this puzzle opens)</span><div class="audio-row"></div>
            <input data-path="puzzles.${i}.audioFile" data-audio-file class="mono" autocomplete="off" placeholder="…or a file name in the audio/ folder, e.g. egmont.m4a"><small class="hint"></small></div>
        </div>`;
      card.querySelector(".audio-row").dataset.audio = draft.puzzles[i].id;
      return card;
    }

    function actionButton(label, act, key, extraClass) {
      const button = el("button", "btn-admin" + (extraClass ? " " + extraClass : ""), label);
      button.type = "button";
      button.dataset.act = act;
      button.dataset.key = key;
      return button;
    }

    async function renderAudioRows() {
      for (const row of root.querySelectorAll("[data-audio]")) {
        const key = row.dataset.audio;
        const clip = await clips.get(key);
        if (!row.isConnected) continue;
        if (clip) {
          row.replaceChildren(
            el("span", "audio-name", clip.name || "Recording"),
            actionButton(previewKey === key && !preview.paused ? "■ Stop" : "▶ Play", "audio-play", key),
            actionButton("Replace", "audio-upload", key),
            actionButton("Remove", "audio-remove", key, "danger"),
          );
        } else {
          row.replaceChildren(actionButton("Upload recording", "audio-upload", key));
        }
      }
    }

    const preview = new Audio();
    let previewKey = null;
    let previewUrl = null;
    preview.addEventListener("ended", () => { previewKey = null; renderAudioRows(); });

    async function togglePreview(key) {
      if (previewKey === key && !preview.paused) {
        preview.pause();
        previewKey = null;
      } else {
        const clip = await clips.get(key);
        if (!clip) return;
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(clip.blob);
        preview.src = previewUrl;
        previewKey = key;
        await preview.play().catch(() => { previewKey = null; });
      }
      renderAudioRows();
    }

    const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });

    const audioKeys = () => [...draft.puzzles.map((p) => p.id), "breach", "final"];

    function renderProgress() {
      const stages = stagesOf(loadConfig());
      const n = stages.length;
      const index = Math.min(loadProgress(), n);
      const options = stages.map((s, i) => [i, s.name]);
      options.push([n, "Finished"]);

      jumpSelect.replaceChildren(...options.map(([value, label]) => {
        const opt = el("option", null, label);
        opt.value = value;
        return opt;
      }));
      jumpSelect.value = index;
      const current = index === 0 && !started ? "the start screen" : options.find(([v]) => v === index)?.[1];
      $("#progress-info").textContent = `The game is currently at: ${current}. Progress is not saved – reloading the page starts over.`;
    }

    function render() {
      list.replaceChildren(...draft.puzzles.map((_, i) => puzzleCard(i, draft.puzzles.length)));
      if (!draft.puzzles.length) list.append(el("p", "empty-note", "No puzzles – the game goes straight to the final card."));
      root.querySelectorAll("[data-path]").forEach((field) => {
        const value = getPath(draft, field.dataset.path);
        if (field.type === "checkbox") field.checked = !!value;
        else field.value = value ?? "";
      });
      updateHints();
      renderProgress();
      renderAudioRows();
      checkAudioFiles();
    }

    // Shows next to each "audio/ folder" field whether the file can be found.
    async function checkAudioFiles() {
      for (const input of root.querySelectorAll("[data-audio-file]")) {
        const hint = input.nextElementSibling;
        const name = input.value.trim();
        if (!name) {
          hint.textContent = "";
          continue;
        }
        const found = await audioFileExists(name);
        if (input.value.trim() !== name) continue;
        hint.textContent = found ? `✓ Found ${audioFileUrl(name)}` : `✗ Not found – put the file in the audio/ folder next to index.html`;
        hint.classList.toggle("bad", !found);
      }
    }
    let fileCheckTimer = 0;

    function save() {
      const errors = validate();
      if (errors.length) {
        setStatus(errors[0] + (errors.length > 1 ? ` (+${errors.length - 1} more)` : ""), "error");
        return false;
      }
      if (!store.set(CONFIG_KEY, draft)) {
        setStatus("Could not save – is browser storage blocked?", "error");
        return false;
      }
      dirty = false;
      saveButton.classList.remove("dirty");
      setStatus("Saved ✓", "ok");
      renderProgress();

      // Drop recordings that belong to deleted puzzles.
      const keep = new Set(audioKeys());
      clips.keys().then((keys) => keys.filter((k) => !keep.has(k)).forEach((k) => clips.remove(k)));
      return true;
    }

    function goToGame(index, showStart = false) {
      if (dirty && !save()) return;
      saveProgress(index);
      started = !showStart;
      preview.pause();
      location.hash = "";
    }

    root.addEventListener("input", (e) => {
      const path = e.target.dataset?.path;
      if (!path) return;
      setPath(draft, path, e.target.type === "checkbox" ? e.target.checked : e.target.value);
      markDirty();
      updateHints();
      if (e.target.matches("[data-audio-file]")) {
        clearTimeout(fileCheckTimer);
        fileCheckTimer = setTimeout(checkAudioFiles, 400);
      }
    });

    root.addEventListener("click", (e) => {
      const button = e.target.closest("[data-act]");
      if (!button) return;
      const i = Number(button.dataset.i);
      const puzzles = draft.puzzles;

      switch (button.dataset.act) {
        case "add":
          puzzles.push(blankPuzzle());
          markDirty();
          render();
          list.lastElementChild?.querySelector("input")?.focus();
          break;
        case "up":
        case "down": {
          const j = button.dataset.act === "up" ? i - 1 : i + 1;
          [puzzles[i], puzzles[j]] = [puzzles[j], puzzles[i]];
          markDirty();
          render();
          break;
        }
        case "remove":
          if (!confirm(`Delete puzzle ${i + 1}${puzzles[i].title ? ` “${puzzles[i].title}”` : ""}?`)) return;
          puzzles.splice(i, 1);
          markDirty();
          render();
          break;
        case "gender":
          draft.final.cpr = normalize(draft.final.cpr).slice(0, 6) + (button.dataset.gender === "boy" ? "0001" : "0002");
          root.querySelector('[data-path="final.cpr"]').value = draft.final.cpr;
          markDirty();
          updateHints();
          break;
        case "save":
          save();
          break;
        case "play":
          goToGame(0, true);
          break;
        case "jump":
          goToGame(Number(jumpSelect.value));
          break;
        case "reset":
          saveProgress(0);
          started = false;
          renderProgress();
          setStatus("Progress reset to the start screen", "ok");
          break;
        case "audio-play":
          togglePreview(button.dataset.key);
          break;
        case "audio-upload":
          pendingAudioKey = button.dataset.key;
          audioFile.click();
          break;
        case "audio-remove":
          if (!confirm("Remove this recording?")) return;
          if (previewKey === button.dataset.key) preview.pause();
          clips.remove(button.dataset.key).then(renderAudioRows);
          break;
        case "export":
          exportSetup();
          break;
        case "import":
          importFile.click();
          break;
        case "defaults":
          if (!confirm("Replace the whole setup with the built-in example? (Not saved until you press Save.)")) return;
          draft = clone(window.DEFAULT_CONFIG);
          render();
          markDirty();
          break;
      }
    });

    async function exportSetup() {
      setStatus("Preparing export…");
      const audio = {};
      for (const key of audioKeys()) {
        const clip = await clips.get(key);
        if (clip) audio[key] = { name: clip.name, data: await blobToDataUrl(clip.blob) };
      }
      const blob = new Blob([JSON.stringify({ ...draft, audio }, null, 2)], { type: "application/json" });
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "escape-room-config.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setStatus(dirty ? "Exported (includes unsaved changes)" : "Exported ✓", "ok");
    }

    importFile.addEventListener("change", async () => {
      const file = importFile.files[0];
      importFile.value = "";
      if (!file) return;
      try {
        const raw = JSON.parse(await file.text());
        for (const [key, clip] of Object.entries(raw.audio || {})) {
          const blob = await (await fetch(clip.data)).blob();
          await clips.set(key, { blob, name: clip.name });
        }
        draft = normalizeConfig(raw);
        render();
        markDirty();
        setStatus("Imported – press Save to keep it", "dirty");
      } catch {
        setStatus("That file is not a valid setup (JSON)", "error");
      }
    });

    let pendingAudioKey = null;
    audioFile.addEventListener("change", async () => {
      const file = audioFile.files[0];
      audioFile.value = "";
      if (!file || !pendingAudioKey) return;
      try {
        await clips.set(pendingAudioKey, { blob: file, name: file.name });
        setStatus(dirty ? "Recording stored – remember to Save the puzzles" : "Recording stored ✓", dirty ? "dirty" : "ok");
      } catch {
        setStatus("Could not store the recording", "error");
      }
      renderAudioRows();
    });

    return {
      open() {
        draft = loadConfig();
        dirty = false;
        saveButton.classList.remove("dirty");
        setStatus("");
        render();
      },
    };
  })();

  /* ---------- Routing ---------- */

  function route() {
    const isAdmin = location.hash.replace("#", "") === "admin";
    $("#game").hidden = isAdmin;
    $("#admin").hidden = !isAdmin;
    document.body.classList.toggle("is-admin", isAdmin);
    player.stop();
    if (isAdmin) {
      setTheme("");
      activePin = null;
      document.title = "Game master";
      admin.open();
    } else {
      renderGame();
    }
  }

  // Keep a game tab in sync when the admin page saves in another tab.
  window.addEventListener("storage", (e) => {
    if (e.key === CONFIG_KEY && !$("#game").hidden) renderGame();
  });

  window.addEventListener("hashchange", route);
  startRain();
  route();
})();
