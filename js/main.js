/* =========================================================
   main.js — the room, camera, input and book loading

   URL options:
     ?book=books/other.json    which book to load (default books/landen.json)
     &spread=2                 open straight to a spread (0-based)

   Keys:  ← →  turn pages      R  reload the book (keeps your page)
   Mouse: scroll to zoom, click either half of the book to turn
   Drop a .json file anywhere to preview it.
========================================================= */
(function () {
"use strict";

const { PopupBook, Sun, V, SceneLoader } = window.Notebook;

const params = new URLSearchParams(location.search);
let bookURL = params.get("book") || "books/landen.json";
let artBase = new URL(bookURL, location.href).href;   // where dropped books look for art

const world = document.getElementById("world");
const scaler = document.getElementById("scaler");
const pageLabel = document.getElementById("pageLabel");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");

/* ---------------------------------------------------------
   TOAST
--------------------------------------------------------- */
const toastEl = document.getElementById("toast");
let toastTimer;
function toast(msg, isError = false, ms = isError ? 9000 : 2200) {
    toastEl.textContent = msg;
    toastEl.classList.toggle("error", isError);
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

/* ---------------------------------------------------------
   BOOK
--------------------------------------------------------- */
const book = new PopupBook(document.getElementById("book"));

/* Shared with js/toys.js (pen cup, lamp, pull-tabs, snake):
     hotspots  [{ hit(x, y), click(e), cursor? }]   clickable spots, checked before page turns
     drags     [{ start(e) → true if it took the drag }]
     keys      [(e) → true if it used the key]
     camera    focus(element, zoom) / release()
     suppressClickUntil   set after a drag so letting go doesn't turn a page */
const app = window.Notebook.app = {
    book, world: document.getElementById("world"),
    hotspots: [], drags: [], keys: [],
    suppressClickUntil: 0,
    camera: null,
    toast: (...a) => toast(...a),
};

book.onChange = cur => {
    prevBtn.disabled = cur === -1;
    nextBtn.disabled = cur >= book.limit;
    // just the chapter: "Preface · Age 9" → "Preface"
    pageLabel.textContent = cur < 0 ? "Cover" : book.model.spreads[cur].label.split("·")[0].trim();
};

// Build a model and either open the cover with a flourish or go straight to a page
function show(model, spread) {
    book.build(model);
    if (spread == null) {
        setTimeout(() => book.go(1), 600);
    } else {
        book.jump(spread);
    }
}

async function loadURL(url, spread) {
    try {
        const model = await SceneLoader.fromURL(url);
        bookURL = url;
        artBase = new URL(url, location.href).href;
        show(model, spread);
        return true;
    } catch (e) {
        console.error(e);
        toast(e.message, true);
        return false;
    }
}

async function loadText(text, name) {
    try {
        const model = await SceneLoader.fromText(text, artBase);
        show(model, null);
        toast(`Loaded ${name}`);
    } catch (e) {
        console.error(e);
        toast(e.message, true);
    }
}

// R: re-read the current book from disk and stay on the same spread
async function reload() {
    const at = book.current;
    if (await loadURL(bookURL, at)) toast("Reloaded");
}

/* ---------------------------------------------------------
   INPUT
--------------------------------------------------------- */
prevBtn.addEventListener("click", () => book.go(-1));
nextBtn.addEventListener("click", () => book.go(1));

// links on the pages (contents, "back to contents", …)
function follow(id) {
    const i = book.indexOf(id);
    if (i < 0) return;
    history.replaceState(null, "", "#" + id);
    book.goTo(i);
}

function linkAt(x, y) {
    return book.visibleLinks().find(a => {
        const r = a.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
}

// mailto:, https:, etc. (anything that isn't a link inside the book)
function openExternal(a) {
    const href = a.getAttribute("href");
    if (/^(mailto|tel):/i.test(href)) location.href = href;
    else window.open(href, "_blank", "noopener");
}

// small label that follows the cursor and says where a link goes
const linkHint = document.getElementById("linkHint");
function hintFor(a) {
    if (!a || a.dataset.goto) return "";
    const href = a.getAttribute("href");
    if (/^mailto:/i.test(href)) return "✉ " + href.slice(7);
    return href.replace(/^https?:\/\//, "").replace(/\/$/, "") + " ↗";
}

const bookEl = document.getElementById("book");
let hovered = null;
bookEl.addEventListener("pointermove", e => {
    const a = linkAt(e.clientX, e.clientY) || null;
    linkHint.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 18}px)`;
    if (a === hovered) return;
    hovered?.classList.remove("hover");
    a?.classList.add("hover");
    hovered = a;
    bookEl.style.cursor = a ? "pointer" : "";
    const hint = hintFor(a);
    linkHint.textContent = hint;
    linkHint.classList.toggle("show", !!hint);
});
bookEl.addEventListener("pointerleave", () => {
    hovered?.classList.remove("hover");
    hovered = null;
    linkHint.classList.remove("show");
});

bookEl.addEventListener("click", e => {
    const link = linkAt(e.clientX, e.clientY);
    if (link) {
        e.preventDefault();
        if (link.dataset.goto) follow(link.dataset.goto);
        else openExternal(link);
        return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    book.go(e.clientX > r.left + r.width / 2 ? 1 : -1);
});

window.addEventListener("hashchange", () => follow(location.hash.slice(1)));

const isUI = el => el.closest("button, .controls, .tools, a.external-ui");

window.addEventListener("pointerdown", e => {
    if (e.button !== 0 || isUI(e.target)) return;
    for (const d of app.drags) if (d.start(e)) { e.preventDefault(); return; }
}, true);

window.addEventListener("click", e => {
    if (performance.now() < app.suppressClickUntil) { e.stopPropagation(); e.preventDefault(); return; }
    if (isUI(e.target)) return;
    const h = app.hotspots.find(h => h.hit(e.clientX, e.clientY));
    if (h) { e.stopPropagation(); e.preventDefault(); h.click(e); }
}, true);

// pointer cursor over anything clickable that lives in the 3D scene
window.addEventListener("pointermove", e => {
    const h = app.hotspots.find(h => h.hit(e.clientX, e.clientY));
    document.body.style.cursor = h ? (h.cursor || "pointer") : "";
});

window.addEventListener("keydown", e => {
    if (e.target.matches("input, textarea")) return;
    if (app.keys.some(k => k(e))) { e.preventDefault(); return; }
    if (e.key === "ArrowRight") book.go(1);
    if (e.key === "ArrowLeft") book.go(-1);
    if (e.key === "r" || e.key === "R") reload();
});

// drag & drop a .json anywhere
const dropHint = document.getElementById("dropHint");
let dragDepth = 0;
window.addEventListener("dragenter", e => { e.preventDefault(); dragDepth++; dropHint.classList.add("show"); });
window.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; dropHint.classList.remove("show"); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", async e => {
    e.preventDefault();
    dragDepth = 0;
    dropHint.classList.remove("show");
    const f = e.dataTransfer.files[0];
    if (f) loadText(await f.text(), f.name);
});

/* ---------------------------------------------------------
   PAGE-TURN SOUND
   Short, preloaded, played through Web Audio so it fires the
   instant a page lifts. Each play is nudged a little in pitch
   and volume so repeated turns don't sound copy-pasted. A
   riffle plays one soft flick per page (capped).
--------------------------------------------------------- */
(function pageSound() {
    const SRC = "audio/page_turn.wav";
    const VOLUME = 0.55;
    let ctx = null, buf = null, ready = null;

    const raw = fetch(SRC).then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${SRC}: ${r.status}`)))
        .catch(e => { console.warn("page-turn sound unavailable:", e.message); return null; });

    // browsers only allow audio after the visitor interacts, so set up on the first one
    function init() {
        return ready ||= (async () => {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            const data = await raw;
            if (data) buf = await ctx.decodeAudioData(data.slice(0)).catch(() => null);
        })();
    }
    // capture phase: runs before the click/key handlers that turn the page
    window.addEventListener("pointerdown", init, { once: true, capture: true });
    window.addEventListener("keydown", init, { once: true, capture: true });

    function flick(when, vol) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.94 + Math.random() * 0.12;
        const g = ctx.createGain();
        g.gain.value = vol * (0.85 + Math.random() * 0.3);
        src.connect(g).connect(ctx.destination);
        src.start(when);
    }

    book.onTurn = async (pages, gapMs) => {
        if (!ready) return;              // no interaction yet (e.g. the cover opening by itself)
        await ready;
        if (!buf) return;
        if (ctx.state === "suspended") await ctx.resume();
        const now = ctx.currentTime;
        if (pages === 1) { flick(now, VOLUME); return; }
        const n = Math.min(pages, 8);                 // a riffle: a few quick, softer flicks
        const step = (gapMs * pages / n) / 1000;
        for (let i = 0; i < n; i++) flick(now + i * step, VOLUME * 0.55);
    };
})();

/* ---------------------------------------------------------
   MUSIC
   Played through Web Audio rather than <audio loop>, because
   only Web Audio loops sample-accurately. Every MP3 also starts
   (and often ends) with a few ms of encoder padding; we find
   where the sound really starts and loop from there, so the
   last beat runs straight into the first.

   Off until the visitor turns it on. The choice is remembered,
   it fades in and out, and it pauses while the tab is hidden.

   <button id="soundBtn" data-src="audio/ambience.mp3"
           data-loop-seconds="22.610068">
   data-loop-seconds is optional: the exact musical length of
   the loop. Without it, the loop runs to the last non-silent
   sample.
--------------------------------------------------------- */
(function music() {
    const btn = document.getElementById("soundBtn");
    const SRC = btn.dataset.src;
    const LOOP_SECONDS = parseFloat(btn.dataset.loopSeconds) || 0;
    const VOLUME = 0.35;

    let wanted = false, ctx = null, gain = null, loading = null;
    try { wanted = localStorage.getItem("notebook-music") === "on"; } catch {}

    // first and last sample louder than -60 dB on any channel
    function soundBounds(buf) {
        const thr = 0.001, chans = [];
        for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
        const loud = i => chans.some(d => Math.abs(d[i]) > thr);
        let a = 0, b = buf.length - 1;
        while (a < b && !loud(a)) a++;
        while (b > a && !loud(b)) b--;
        return [a, b + 1];
    }

    function setup() {
        if (loading) return loading;
        loading = (async () => {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            gain = ctx.createGain();
            gain.gain.value = 0;
            gain.connect(ctx.destination);

            const res = await fetch(SRC);
            if (!res.ok) throw new Error(`Couldn't load ${SRC} (${res.status})`);
            const buf = await ctx.decodeAudioData(await res.arrayBuffer());

            let start, end;
            if (LOOP_SECONDS && Math.abs(buf.duration - LOOP_SECONDS) < 0.002) {
                // the decoder already stripped the padding (Chrome, Safari, Firefox do)
                start = 0; end = buf.duration;
            } else {
                const [a, b] = soundBounds(buf);
                start = a / buf.sampleRate;
                end = LOOP_SECONDS ? Math.min(buf.duration, start + LOOP_SECONDS) : b / buf.sampleRate;
            }

            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.loop = true;
            src.loopStart = start;
            src.loopEnd = end;
            src.connect(gain);
            src.start(0, start);
        })();
        loading.catch(e => {
            console.error(e);
            toast(e.message.startsWith("Couldn't") ? e.message : `Couldn't play ${SRC}. Is the file there?`, true);
            loading = null;
            ctx?.close(); ctx = null;
        });
        return loading;
    }

    function fadeTo(v, seconds) {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(v, now + seconds);
    }

    async function play() {
        try { await setup(); } catch { return; }
        if (!wanted || document.hidden) return;
        await ctx.resume();
        fadeTo(VOLUME, 2.5);
    }

    function stop() {
        if (!ctx) return;
        fadeTo(0, 0.7);
        setTimeout(() => { if (!wanted || document.hidden) ctx.suspend(); }, 750);
    }

    function sync() {
        btn.classList.toggle("on", wanted);
        btn.setAttribute("aria-pressed", wanted);
        btn.title = wanted ? "Music on" : "Music off";
    }

    btn.addEventListener("click", () => {
        wanted = !wanted;
        try { localStorage.setItem("notebook-music", wanted ? "on" : "off"); } catch {}
        sync();
        wanted ? play() : stop();
    });

    // a returning visitor who left it on: start on their first interaction
    if (wanted) {
        const kick = e => { if (e.target !== btn) play(); };
        window.addEventListener("pointerdown", kick, { once: true });
        window.addEventListener("keydown", kick, { once: true });
    }

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) stop();
        else if (wanted && ctx) play();
    });

    sync();
})();

/* ---------------------------------------------------------
   DESK LIGHT + LIGHT SHAFTS
--------------------------------------------------------- */
document.getElementById("desk").insertAdjacentHTML("afterbegin",
    Sun.svg(-2200, -140, 5600, 2340, -10, 0.18, 0.34));

// a shaft is a flat sheet hanging from a window edge, running along the sun
const W = Sun.WIN;
for (const [z, alpha] of [[W.z0, 1], [W.z1, 0.6], [(W.z0 + W.z1) / 2, 0.5]]) {
    const b = document.createElement("div");
    b.className = "beam";
    const Y = V.norm(Sun.DIR), X = [1, 0, 0], Z = V.norm(V.cross(X, Y));
    b.style.width = (W.x1 - W.x0) + "px";
    b.style.height = V.len(Sun.DIR) * (z + 10) / -Sun.DIR[2] + "px";
    b.style.setProperty("--a", alpha);
    b.style.transform = `matrix3d(${X},0, ${Y},0, ${Z},0, ${W.x0},${W.y},${z},1)`;
    world.appendChild(b);
}

/* ---------------------------------------------------------
   CAMERA: fit to screen, scroll to zoom, pointer parallax
--------------------------------------------------------- */
let scale = 1;
function fit() {
    scale = Math.min(window.innerWidth * 0.86 / 1200, window.innerHeight * 0.95 / 620);
}
window.addEventListener("resize", fit);
fit();

let zoom = 0.72;                    // the zoom we're heading to
let panX = 0, panY = 0, focusEl = null, savedZoom = null;

// The zoom/pan is handed to the browser as a CSS transition (see .scaler in
// style.css). Animating it ourselves frame by frame made Chrome re-render
// every page at every in-between size, which is what made zooming laggy.
let lastScaler = "", queued = false;
function applyCamera() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
        queued = false;
        const s = scale * zoom;
        const t = `translate(${panX.toFixed(1)}px, ${(60 * s + panY).toFixed(1)}px) scale(${s.toFixed(4)})`;
        if (t !== lastScaler) { scaler.style.transform = t; lastScaler = t; }
    });
}
window.addEventListener("resize", () => { fit(); applyCamera(); });
applyCamera();

window.addEventListener("wheel", e => {
    e.preventDefault();
    if (focusEl) return;                                      // a game has the camera
    zoom *= Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0012));
    zoom = Math.min(1.6, Math.max(0.4, zoom));
    applyCamera();
}, { passive: false });

let mx = 0, my = 0, cx = 0, cy = 0;
window.addEventListener("pointermove", e => {
    mx = e.clientX / window.innerWidth - 0.5;
    my = e.clientY / window.innerHeight - 0.5;
});

// focus: zoom to z and pan so an element sits in the middle of the screen
// (screen = centre + pan + (0, 60s) + s·u, so solve for the pan that puts u at the centre)
app.camera = {
    focus(el, z) {
        const r = el.getBoundingClientRect(), s0 = scale * zoom;
        const ux = (r.left + r.width / 2 - innerWidth / 2 - panX) / s0;
        const uy = (r.top + r.height / 2 - innerHeight / 2 - panY - 60 * s0) / s0;
        if (savedZoom == null) savedZoom = zoom;
        focusEl = el;
        zoom = z;
        const s1 = scale * zoom;
        panX = -s1 * ux;
        panY = -60 * s1 - s1 * uy;
        applyCamera();
    },
    release() {
        focusEl = null;
        if (savedZoom != null) zoom = savedZoom;
        savedZoom = null;
        panX = panY = 0;
        applyCamera();
    },
    scale: () => scale * zoom,
};

// gentle tilt toward the pointer; only written when it actually changes
let lastWorld = "";
(function camera() {
    cx += (mx - cx) * 0.06;
    cy += (my - cy) * 0.06;
    const t = `rotateX(${(58 + cy * 6).toFixed(2)}deg) rotateZ(${(cx * -4).toFixed(2)}deg)`;
    if (t !== lastWorld) { world.style.transform = t; lastWorld = t; }
    requestAnimationFrame(camera);
})();

/* ---------------------------------------------------------
   DUST MOTES drifting through the sunbeam
   Small dots animated purely with CSS transforms/opacity, so
   the compositor moves them without repainting anything. (A
   canvas redrawn every frame on top of the 3D scene was the
   single most expensive thing on the page.)
--------------------------------------------------------- */
(function dust() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = document.getElementById("dust");
    const rnd = (a, b) => a + Math.random() * (b - a);
    // two sheets of motes, each drawn once as an SVG and then only slid around
    const sheet = n => {
        let dots = "";
        for (let i = 0; i < n; i++) {
            const a = rnd(0, Math.PI * 2), d = Math.sqrt(Math.random());
            const x = 400 + Math.cos(a) * d * 360, y = 350 + Math.sin(a) * d * 320;
            dots += `<circle cx='${x.toFixed(0)}' cy='${y.toFixed(0)}' r='${rnd(1, 2.6).toFixed(1)}' fill='rgba(255,228,180,${rnd(.35, .85).toFixed(2)})'/>`;
        }
        return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 800 700'>${dots}</svg>`)}")`;
    };
    box.innerHTML = `<i class="motes a"></i><i class="motes b"></i>`;
    box.querySelector(".a").style.backgroundImage = sheet(26);
    box.querySelector(".b").style.backgroundImage = sheet(18);
})();

/* ---------------------------------------------------------
   BOOT
--------------------------------------------------------- */
// ?spread=N or #id opens straight to a page; otherwise the cover swings open
(async () => {
    const startSpread = params.has("spread") ? parseInt(params.get("spread"), 10) : null;
    const hash = location.hash.slice(1);
    if (!(await loadURL(bookURL, startSpread ?? (hash ? -1 : null)))) return;
    if (startSpread == null && hash && book.indexOf(hash) >= 0) book.jump(book.indexOf(hash));
})();
})();
