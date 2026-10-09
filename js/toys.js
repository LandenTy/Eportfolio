/* =========================================================
   toys.js — small things to play with that live in the scene

     • a pen cup on the desk you can knock over (and pick up)
     • a desk lamp, and a window that cycles the time of day
     • pull-tabs on pages that move parts of the pop-ups
     • Snake, playable on the little handheld's screen

   Everything in the 3D scene is hit-tested by hand (screen
   rectangles) because Chrome won't hit-test inside 3D-turned
   pages. main.js routes clicks/drags/keys through
   Notebook.app.hotspots / .drags / .keys.
========================================================= */
(function () {
"use strict";

const app = window.Notebook.app;
const { book, world } = app;
const DESK_Z = -10;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const inRect = (r, x, y, pad = 0) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function tween(ms, fn) {
    return new Promise(done => {
        const t0 = performance.now();
        (function step(now) {
            const k = Math.min(1, (now - t0) / ms);
            fn(k);
            k < 1 ? requestAnimationFrame(step) : done();
        })(t0);
    });
}

/* ---------------------------------------------------------
   SOUND: tiny synthesized clicks, thumps and paper noises
--------------------------------------------------------- */
const Sfx = (() => {
    let ctx = null, noise = null;
    function ensure() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
            const d = noise.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
    }
    // filtered noise burst: pen clicks, paper rustle
    function tick(when, freq, dur, vol, q = 6) {
        const c = ensure(), t = c.currentTime + when;
        const src = c.createBufferSource(); src.buffer = noise;
        const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        src.connect(f).connect(g).connect(c.destination);
        src.start(t, Math.random() * 0.2); src.stop(t + dur + 0.02);
    }
    // a soft low knock: the cup landing, a lamp switch
    function thump(when, freq = 150, vol = 0.45) {
        const c = ensure(), t = c.currentTime + when;
        const o = c.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(freq, t);
        o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.12);
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.2);
    }
    // a short beep for the game
    function beep(when, freq, dur = 0.06, vol = 0.08) {
        const c = ensure(), t = c.currentTime + when;
        const o = c.createOscillator(); o.type = "square"; o.frequency.value = freq;
        const g = c.createGain();
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        o.connect(g).connect(c.destination); o.start(t); o.stop(t + dur + 0.02);
    }
    return { tick, thump, beep };
})();

/* ---------------------------------------------------------
   DESK PROPS: standing cut-outs on the desk plane
--------------------------------------------------------- */
function prop(cls, w, h, src) {
    const el = document.createElement("div");
    el.className = "prop " + cls;
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.innerHTML = `<img src="${src}" alt="" draggable="false">`;
    world.appendChild(el);
    return el;
}
function shadow(x, y, w, h) {
    const el = document.createElement("div");
    el.className = "prop-shadow";
    el.style.width = w + "px";
    el.style.height = h + "px";
    el.style.transform = `translate3d(${x - w / 2}px, ${y - h / 2}px, ${DESK_Z + 0.5}px)`;
    world.appendChild(el);
    return el;
}
// a point in the scene we can find on screen (for lighting)
function marker(x, y, z, parent = world) {
    const el = document.createElement("div");
    el.className = "marker";
    el.style.transform = `translate3d(${x}px, ${y}px, ${z}px)`;
    parent.appendChild(el);
    return el;
}

/* =========================================================
   PEN CUP — knock it over, the pens spill; click again to tidy up
========================================================= */
(function penCup() {
    const X = 1262, Y = 440;             // right of the book, set back a little: left edge, front edge
    const W = 150, H = 245;              // matches room/pen-cup.svg (120 × 196)
    const CUP_H = H * (196 - 92) / 196;  // rim height above the desk
    const PEN_LEN = 112, PEN_W = 16;

    // standing cup; it tips toward the viewer over its front edge
    const cup = prop("pen-cup", W, H, "room/pen-cup.svg");
    cup.style.transformOrigin = `${W / 2}px ${H}px`;
    const shade = shadow(X + W / 2, Y, W * 1.1, 34);

    // the same cup lying on its side, seen from above
    const fallen = document.createElement("div");
    fallen.className = "prop pen-cup-fallen";
    fallen.style.width = W + "px";
    fallen.style.height = (112 * W / 120) + "px";
    fallen.innerHTML = `<img src="room/pen-cup-fallen.svg" alt="" draggable="false">`;
    fallen.style.transform = `translate3d(${X}px, ${Y - 4}px, ${DESK_Z + 1}px)`;
    world.appendChild(fallen);

    let angle = 0, state = "up", pens = [];
    function place() {
        cup.style.transform = `translate3d(${X}px, ${Y - H}px, ${DESK_Z}px) rotateX(${-90 - angle}deg)`;
        shade.style.opacity = 1 - angle / 120;
    }
    function lying(on) {
        cup.style.visibility = on ? "hidden" : "visible";
        fallen.style.visibility = on ? "visible" : "hidden";
    }
    place(); lying(false);

    const PEN_ART = [
        ["#e63946", "#d62828", "#f8f9fa"],   // red pen
        ["#ffbe0b", "#adb5bd", "#ddb892"],   // pencil
        ["#0077b6", "#3d5a80", "#f8f9fa"],   // blue pen
        ["#212529", "#495057", "#f8f9fa"],   // black pen
    ];
    function penSVG([body, cap, tip]) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 112 16" width="${PEN_LEN}" height="${PEN_W}">
            <path d="M 14,2 L 100,2 Q 108,2 108,8 Q 108,14 100,14 L 14,14 Z" fill="${body}" stroke="#1e1b18" stroke-width="3" stroke-linejoin="round"/>
            <path d="M 78,2 L 100,2 Q 108,2 108,8 Q 108,14 100,14 L 78,14 Z" fill="${cap}" stroke="#1e1b18" stroke-width="3" stroke-linejoin="round"/>
            <path d="M 14,2 L 3,8 L 14,14 Z" fill="${tip}" stroke="#1e1b18" stroke-width="3" stroke-linejoin="round"/>
            <path d="M 3,8 L 7,6 L 7,10 Z" fill="#1e1b18"/>
        </svg>`;
    }

    function spill() {
        const mouthX = X + W / 2, mouthY = Y + CUP_H;
        pens = PEN_ART.map((art, i) => {
            const el = document.createElement("div");
            el.className = "pen";
            el.innerHTML = penSVG(art);
            world.appendChild(el);
            // fan out toward the front-left, along the desk in front of the book
            const th = Math.atan2(0.62, -0.78) + (i - 1.5) * 0.28 + (Math.random() - 0.5) * 0.3;
            const speed = 170 + Math.random() * 150;
            const vx = Math.cos(th) * speed, vy = Math.sin(th) * speed;
            return {
                el, landed: false,
                x: mouthX + (Math.random() - 0.5) * 30, y: mouthY - 10, z: W * (0.3 + Math.random() * 0.25),
                vx, vy, vz: 40 + Math.random() * 110,
                a: Math.atan2(vy, vx) + Math.PI + (Math.random() - 0.5) * 0.5,    // tip first, out of the cup
                va: (Math.random() - 0.5) * 9,
            };
        });
        let last = performance.now();
        (function step(now) {
            const dt = Math.min(0.033, (now - last) / 1000); last = now;
            let moving = false;
            for (const p of pens) {
                p.vz -= 1900 * dt;
                p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.a += p.va * dt;
                if (p.z <= 0) {
                    p.z = 0;
                    if (p.vz < -90) {
                        if (!p.landed) Sfx.tick(0, 2600 + Math.random() * 2400, 0.05, 0.22);
                        p.landed = true;
                        p.vz = -p.vz * 0.28;
                    } else p.vz = 0;
                    const f = Math.exp(-3.4 * dt);
                    p.vx *= f; p.vy *= f; p.va *= Math.exp(-4 * dt);
                }
                // stay on open desk: beside the book, or anywhere in front of it
                const minX = p.y < 800 ? 1236 : 640;
                if (p.x < minX) { p.x = minX; p.vx = Math.abs(p.vx) * 0.4; }
                if (p.x > 1560) { p.x = 1560; p.vx = -Math.abs(p.vx) * 0.4; }
                if (p.y > 960)  { p.y = 960;  p.vy = -Math.abs(p.vy) * 0.4; }
                p.el.style.transform = `translate3d(${p.x - PEN_LEN / 2}px, ${p.y - PEN_W / 2}px, ${DESK_Z + 1.5 + p.z}px) rotateZ(${p.a}rad)`;
                if (Math.hypot(p.vx, p.vy) > 4 || p.z > 0 || Math.abs(p.vz) > 1) moving = true;
            }
            if (moving && state === "down") requestAnimationFrame(step);
        })(last);
    }

    async function knock() {
        state = "falling";
        Sfx.tick(0, 900, 0.08, 0.15, 2);
        await tween(reduceMotion ? 1 : 300, k => { angle = 90 * k * k; place(); });
        lying(true);
        Sfx.thump(0, 170, 0.5);
        state = "down";
        spill();
    }

    async function tidy() {
        state = "rising";
        const old = pens; pens = [];
        for (const p of old) p.el.classList.add("gone");
        setTimeout(() => old.forEach(p => p.el.remove()), 400);
        Sfx.tick(0, 1800, 0.06, 0.12);
        lying(false);
        await tween(reduceMotion ? 1 : 420, k => { angle = 90 * (1 - k) * (1 - k); place(); });
        Sfx.thump(0, 220, 0.25);
        angle = 0; place();
        state = "up";
    }

    app.hotspots.push({
        hit(x, y) {
            if (state === "up") return inRect(cup.getBoundingClientRect(), x, y);
            if (state !== "down") return false;
            return inRect(fallen.getBoundingClientRect(), x, y)
                || pens.some(p => inRect(p.el.getBoundingClientRect(), x, y, 4));
        },
        click() { state === "up" ? knock() : tidy(); },
    });
})();

/* =========================================================
   LAMP + TIME OF DAY
   The window cycles day → sunset → night. The lamp switches
   on a warm pool of light that cuts through the dark.
========================================================= */
(function lighting() {
    const LX = -330, LY = 330, LW = 240, LH = 280;   // lamp stands to the left of the book
    const lamp = prop("lamp", LW, LH, "room/lamp.svg");
    lamp.style.transform = `translate3d(${LX}px, ${LY - LH}px, ${DESK_Z}px) rotateX(-90deg)`;
    const glow = document.createElement("div");
    glow.className = "bulb-glow";
    glow.style.left = (206 / 240 * LW) + "px";
    glow.style.top = (120 / 280 * LH) + "px";
    lamp.appendChild(glow);
    const bulb = document.createElement("div");
    bulb.className = "marker";
    bulb.style.left = glow.style.left; bulb.style.top = glow.style.top;
    lamp.appendChild(bulb);
    shadow(LX + 70 / 240 * LW, LY, 150, 30);

    const pool = marker(110, 330, 40);              // where the lamp's light lands
    const win = document.querySelector(".window");

    const TIMES = ["day", "sunset", "night"];
    const SUN = [1, 0.5, 0];
    let time = 0, lampOn = false, lampAmt = 0;
    const body = document.body;
    body.classList.add("time-day");

    // the overlays get their own variables, so the book never has to restyle
    const lit = [...document.querySelectorAll(".shade, .lamp-glow")];
    const last = {};
    function setVar(name, value) {
        if (last[name] === value) return;
        last[name] = value;
        for (const el of lit) el.style.setProperty(name, value);
    }

    // sunlight on the pages fades in a handful of steps, not every frame
    let sun = 1, sunTimer = 0;
    function fadeSun(to) {
        clearInterval(sunTimer);
        const from = sun, t0 = performance.now(), MS = reduceMotion ? 1 : 1600;
        const tick = () => {
            const k = Math.min(1, (performance.now() - t0) / MS);
            sun = from + (to - from) * k;
            body.style.setProperty("--sun", sun.toFixed(2));
            if (k >= 1) clearInterval(sunTimer);
        };
        tick();
        sunTimer = setInterval(tick, 200);
    }

    function setTime(t) {
        body.classList.remove("time-" + TIMES[time]);
        time = t;
        body.classList.add("time-" + TIMES[time]);
        fadeSun(SUN[t]);
    }

    app.hotspots.push({
        hit: (x, y) => inRect(lamp.getBoundingClientRect(), x, y),
        click() {
            lampOn = !lampOn;
            lamp.classList.toggle("on", lampOn);
            Sfx.thump(0, 900, 0.12); Sfx.tick(0, 3500, 0.03, 0.15);
        },
    });
    app.hotspots.push({
        hit: (x, y) => inRect(win.getBoundingClientRect(), x, y),
        click() { setTime((time + 1) % 3); Sfx.tick(0, 700, 0.25, 0.05, 1.5); },
    });

    // follow the pool of light and the bulb on screen — only while the lamp is on
    (function frame() {
        const target = lampOn ? 1 : 0;
        lampAmt += (target - lampAmt) * 0.12;
        if (Math.abs(target - lampAmt) < 0.003) lampAmt = target;
        if (lampAmt > 0) {
            const s = app.camera ? app.camera.scale() : 1;
            const p = pool.getBoundingClientRect(), b = bulb.getBoundingClientRect();
            const px = v => Math.round(v) + "px";
            setVar("--lx", px(p.left));
            setVar("--ly", px(p.top));
            setVar("--lrx", px(Math.max(1, 640 * s * lampAmt)));
            setVar("--lry", px(Math.max(1, 380 * s * lampAmt)));
            setVar("--bx", px(b.left));
            setVar("--by", px(b.top));
            setVar("--br", px(Math.max(1, 90 * s)));
        } else {
            setVar("--lrx", "1px"); setVar("--lry", "1px");
        }
        setVar("--lamp", (lampAmt * [0.35, 0.7, 1][time]).toFixed(2));
        requestAnimationFrame(frame);
    })();
})();

/* =========================================================
   PULL-TABS
   A page can carry <div class="pull-tab" data-pull>. Drag it
   (or click it for a tug) and that spread's pop-ups get
   --pull: 0..1, which the art uses to move (see style.css,
   "PULL-TAB TARGETS"). Let go and it springs back.
========================================================= */
(function pullTabs() {
    let drag = null;

    function tabAt(x, y) {
        for (const face of book.openFaces())
            for (const t of face.querySelectorAll("[data-pull]"))
                if (inRect(t.getBoundingClientRect(), x, y, 8)) return t;
        return null;
    }

    const ease = v => v < 0 ? v : 1 - Math.pow(1 - Math.min(v, 1), 2);
    // the tongue grows out of its slot as it's pulled (left-hand tabs grow leftward)
    function set(t, s, dir, v) {
        const grow = Math.max(-6, v * 64);
        t.style.width = (82 + grow) + "px";
        t.style.transform = dir < 0 ? `translateX(${-grow}px)` : "";
        book.setPull(s, ease(v));
    }

    function springBack(t, s, dir, from) {
        Sfx.tick(0, 1100, 0.12, 0.08, 1.2);
        return tween(reduceMotion ? 1 : 520, k => {
            const v = from * Math.pow(1 - k, 2) * Math.cos(k * Math.PI * 1.6);
            set(t, s, dir, v);
        });
    }

    app.hotspots.push({
        hit: (x, y) => !drag && !!tabAt(x, y),
        cursor: "grab",
        async click(e) {                                  // a click gives it a little tug
            const t = tabAt(e.clientX, e.clientY);
            if (!t || drag) return;
            const s = book.current, dir = t.dataset.pullDir === "left" ? -1 : 1;
            drag = { t };
            Sfx.tick(0, 1400, 0.1, 0.08, 1.2);
            await tween(220, k => set(t, s, dir, 0.6 * Math.sin(k * Math.PI / 2)));
            await springBack(t, s, dir, 0.6);
            drag = null;
        },
    });

    app.drags.push({
        start(e) {
            const t = tabAt(e.clientX, e.clientY);
            if (!t || drag || book.busy) return false;
            const s = book.current, dir = t.dataset.pullDir === "left" ? -1 : 1;
            const travel = 130 * app.camera.scale();
            const x0 = e.clientX;
            let v = 0, moved = false;
            drag = { t };
            document.body.classList.add("grabbing");
            const move = ev => {
                if (Math.abs(ev.clientX - x0) > 3) moved = true;
                v = clamp((ev.clientX - x0) * dir / travel, 0, 1);
                set(t, s, dir, v);
            };
            const up = async () => {
                removeEventListener("pointermove", move);
                removeEventListener("pointerup", up);
                document.body.classList.remove("grabbing");
                if (!moved) { drag = null; return; }            // let the click handler give a tug
                app.suppressClickUntil = performance.now() + 300;
                await springBack(t, s, dir, v);
                drag = null;
            };
            addEventListener("pointermove", move);
            addEventListener("pointerup", up);
            return true;
        },
    });
})();

/* =========================================================
   SNAKE — on the handheld's screen (books/art/tiny-game.svg)
   The art provides #snake-screen, .snake-demo, .snake-live
   and .snake-score. Click the screen to play; arrows or WASD
   steer; Esc, clicking away or turning the page stops.
========================================================= */
(function snake() {
    const COLS = 11, ROWS = 8, CELL = 16, OX = 27, OY = 51, TICK = 140;
    let playing = false, over = false, timer = 0;
    let body, dir, queue, food, score, best = 0;
    let cacheModel = null, cacheSpread = -1;

    function spread() {
        if (book.model !== cacheModel) {
            cacheModel = book.model;
            cacheSpread = -1;
            if (book.folds) for (let s = 0; s < book.folds.length; s++)
                if (book.halves(s).some(h => h.querySelector(".snake-live"))) { cacheSpread = s; break; }
        }
        return cacheSpread;
    }
    const halves = () => book.halves(spread()).filter(h => h.querySelector(".snake-live"));

    // the copy of the screen that's actually visible (the other half clips it away)
    function screenEl() {
        for (const h of halves()) {
            const el = h.querySelector("#snake-screen"), r = el.getBoundingClientRect(), hr = h.getBoundingClientRect();
            if (inRect(hr, r.left + r.width / 2, r.top + r.height / 2)) return el;
        }
        return null;
    }
    const onScreen = (x, y) => {
        const el = screenEl();
        return el && inRect(el.getBoundingClientRect(), x, y, 6);
    };

    function draw(extra = "") {
        const cell = (c, fill, r = 3) =>
            `<rect x="${OX + c.x * CELL + 1}" y="${OY + c.y * CELL + 1}" width="${CELL - 2}" height="${CELL - 2}" rx="${r}" fill="${fill}" stroke="#1e1b18" stroke-width="2"/>`;
        let svg = `<rect x="26" y="50" width="178" height="128" rx="4" fill="#1b263b"/>`;
        svg += `<circle cx="${OX + food.x * CELL + CELL / 2}" cy="${OY + food.y * CELL + CELL / 2}" r="6" fill="#e63946" stroke="#1e1b18" stroke-width="2"/>`;
        body.forEach((c, i) => { svg += cell(c, i === 0 ? "#70e000" : "#38b000"); });
        svg += extra;
        for (const h of halves()) {
            h.querySelector(".snake-live").innerHTML = svg;
            h.querySelector(".snake-score").textContent = `SCORE ${score}`;
        }
    }

    function placeFood() {
        do food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
        while (body.some(c => c.x === food.x && c.y === food.y));
    }

    function step() {
        if (queue.length) dir = queue.shift();
        const head = { x: body[0].x + dir.x, y: body[0].y + dir.y };
        const hitWall = head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS;
        const hitSelf = body.some((c, i) => i < body.length - 1 && c.x === head.x && c.y === head.y);
        if (hitWall || hitSelf) return gameOver();
        body.unshift(head);
        if (head.x === food.x && head.y === food.y) {
            score++;
            Sfx.beep(0, 880); Sfx.beep(0.06, 1320);
            if (body.length === COLS * ROWS) return gameOver(true);
            placeFood();
        } else body.pop();
        draw();
    }

    function gameOver(won = false) {
        clearInterval(timer);
        over = true;
        best = Math.max(best, score);
        Sfx.beep(0, 330, 0.12, 0.1); Sfx.beep(0.12, 220, 0.2, 0.1);
        const t = (y, s, size) => `<text x="115" y="${y}" text-anchor="middle" font-family="'Courier New', monospace" font-weight="bold" font-size="${size}" fill="#f8f9fa">${s}</text>`;
        draw(`<rect x="44" y="82" width="142" height="66" rx="6" fill="#1b263b" stroke="#f8f9fa" stroke-width="2"/>`
            + t(106, won ? "YOU WIN" : "GAME OVER", 17) + t(124, `BEST ${best}`, 12) + t(140, "click to retry", 11));
    }

    function newGame() {
        body = [{ x: 4, y: 4 }, { x: 3, y: 4 }, { x: 2, y: 4 }];
        dir = { x: 1, y: 0 }; queue = []; score = 0; over = false;
        placeFood();
        draw();
        clearInterval(timer);
        timer = setInterval(step, TICK);
    }

    function start() {
        if (book.current !== spread()) return;
        playing = true;
        for (const h of halves()) h.querySelector(".snake-demo").style.display = "none";
        app.camera.focus(screenEl(), 1.55);
        Sfx.beep(0, 660); Sfx.beep(0.08, 990);
        newGame();
    }

    function stop() {
        if (!playing) return;
        playing = false;
        clearInterval(timer);
        for (const h of halves()) {
            h.querySelector(".snake-live").innerHTML = "";
            h.querySelector(".snake-demo").style.display = "";
            h.querySelector(".snake-score").textContent = best ? `BEST ${best}` : "SCORE 6";
        }
        app.camera.release();
    }

    // while playing, every click comes here first: retry on the screen, anything else stops
    app.hotspots.unshift({
        hit: (x, y) => playing || (book.current === spread() && !book.busy && onScreen(x, y)),
        click(e) {
            if (!playing) return start();
            if (onScreen(e.clientX, e.clientY)) { if (over) newGame(); }
            else stop();
        },
    });

    const DIRS = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    };
    app.keys.push(e => {
        if (!playing) return false;
        if (e.key === "Escape") { stop(); return true; }
        if ((e.key === " " || e.key === "Enter") && over) { newGame(); return true; }
        const d = DIRS[e.key];
        if (!d) return e.key.startsWith("Arrow");          // swallow arrows so pages don't turn
        const last = queue.length ? queue[queue.length - 1] : dir;
        if (d[0] !== -last.x || d[1] !== -last.y) {
            if (queue.length < 3) queue.push({ x: d[0], y: d[1] });
        }
        return true;
    });

    const prev = book.onChange;
    book.onChange = c => { prev(c); stop(); };
})();


/* =========================================================
   STICKY NOTES — a pile on the desk; drag them off to find
   the scrap of paper underneath
========================================================= */
(function stickyNotes() {
    const MSG = { x: 190, y: 846, w: 236, h: 68 };
    const SIZE = 104;

    const scrap = document.createElement("div");
    scrap.className = "desk-scrap";
    scrap.style.width = MSG.w + "px";
    scrap.style.height = MSG.h + "px";
    scrap.innerHTML = `<span>psst… type <b>lambda</b></span>`;
    scrap.style.transform = `translate3d(${MSG.x - MSG.w / 2}px, ${MSG.y - MSG.h / 2}px, ${DESK_Z + 0.6}px) rotateZ(-2deg)`;
    world.appendChild(scrap);

    const notes = [
        { c: "#ffe066", t: "TODO",          x: 118, y: 828, r: -8 },
        { c: "#ffadad", t: "fix the bug",   x: 210, y: 852, r: 6 },
        { c: "#b9fbc0", t: "ship it!",      x: 272, y: 828, r: -4 },
        { c: "#a0c4ff", t: "λ?",            x: 156, y: 864, r: 10 },
        { c: "#ffd6a5", t: "coffee",        x: 246, y: 866, r: -12 },
        { c: "#ffe066", t: "nothing under here", x: 192, y: 842, r: 3 },
    ].map((n, i) => {
        const el = document.createElement("div");
        el.className = "sticky";
        el.style.background = n.c;
        el.innerHTML = `<span>${n.t}</span>`;
        world.appendChild(el);
        return Object.assign(n, { el, order: i, lift: 0 });
    });

    function place(n) {
        n.el.style.transform =
            `translate3d(${n.x - SIZE / 2}px, ${n.y - SIZE / 2}px, ${DESK_Z + 1.2 + n.order * 0.5 + n.lift}px) rotateZ(${n.r}deg)`;
    }
    notes.forEach(place);

    const topAt = (x, y) => [...notes].sort((a, b) => b.order - a.order)
        .find(n => inRect(n.el.getBoundingClientRect(), x, y));

    function toTop(n) {
        const max = Math.max(...notes.map(m => m.order));
        if (n.order === max) return;
        n.order = max + 1;
        [...notes].sort((a, b) => a.order - b.order).forEach((m, i) => { m.order = i; place(m); });
    }

    // where a point on the desk lands on screen (for turning mouse moves into desk moves)
    const probe = marker(0, 0, 0);
    function screenOf(x, y) {
        probe.style.transform = `translate3d(${x}px, ${y}px, ${DESK_Z}px)`;
        const r = probe.getBoundingClientRect();
        return { x: r.left, y: r.top };
    }

    let revealed = false;
    function checkReveal() {
        if (revealed) return;
        // sample the scrap: revealed once no more than a quarter of it is under notes
        const under = (px, py) => notes.some(n => {
            const a = -n.r * Math.PI / 180, dx = px - n.x, dy = py - n.y;
            const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
            return Math.abs(lx) < SIZE / 2 && Math.abs(ly) < SIZE / 2;
        });
        let hidden = 0, total = 0;
        for (let i = 0; i < 12; i++) for (let j = 0; j < 4; j++) {
            total++;
            if (under(MSG.x - MSG.w / 2 + (i + 0.5) * MSG.w / 12, MSG.y - MSG.h / 2 + (j + 0.5) * MSG.h / 4)) hidden++;
        }
        if (hidden / total > 0.25) return;
        revealed = true;
        scrap.classList.add("revealed");
        Sfx.beep(0, 784, 0.08, 0.05); Sfx.beep(0.1, 1175, 0.12, 0.05);
    }

    function clampPos(n) {
        n.x = clamp(n.x, -330, 1500);
        n.y = clamp(n.y, -120, 905);
        if (n.x > -70 && n.x < 1270 && n.y < 800) n.y = 800;      // keep them off the book
    }

    app.hotspots.push({
        hit: (x, y) => !!topAt(x, y),
        cursor: "grab",
        async click(e) {                                     // a click just ruffles one
            const n = topAt(e.clientX, e.clientY);
            if (!n) return;
            toTop(n);
            Sfx.tick(0, 1600, 0.06, 0.06, 1.5);
            const r0 = n.r;
            await tween(260, k => { n.r = r0 + Math.sin(k * Math.PI * 2) * 5 * (1 - k); n.lift = Math.sin(k * Math.PI) * 6; place(n); });
            n.r = r0; n.lift = 0; place(n);
        },
    });

    app.drags.push({
        start(e) {
            const n = topAt(e.clientX, e.clientY);
            if (!n) return false;
            toTop(n);
            // local mapping: screen pixels per desk unit, along x and y
            const p0 = screenOf(n.x, n.y), px = screenOf(n.x + 20, n.y), py = screenOf(n.x, n.y + 20);
            const ex = { x: (px.x - p0.x) / 20, y: (px.y - p0.y) / 20 };
            const ey = { x: (py.x - p0.x) / 20, y: (py.y - p0.y) / 20 };
            const det = ex.x * ey.y - ex.y * ey.x || 1;
            const sx = e.clientX, sy = e.clientY, x0 = n.x, y0 = n.y, r0 = n.r;
            let moved = false, lastX = sx;
            document.body.classList.add("grabbing");
            n.el.classList.add("lifted");
            n.lift = 10; place(n);
            Sfx.tick(0, 1300, 0.07, 0.07, 1.4);

            const move = ev => {
                const dx = ev.clientX - sx, dy = ev.clientY - sy;
                if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
                n.x = x0 + (dx * ey.y - dy * ey.x) / det;
                n.y = y0 + (ex.x * dy - ex.y * dx) / det;
                clampPos(n);
                n.r = r0 + clamp((ev.clientX - lastX) * 0.6, -8, 8);   // swings a little as it moves
                lastX = ev.clientX;
                place(n);
            };
            const up = async () => {
                removeEventListener("pointermove", move);
                removeEventListener("pointerup", up);
                document.body.classList.remove("grabbing");
                n.el.classList.remove("lifted");
                if (moved) app.suppressClickUntil = performance.now() + 300;
                const rEnd = r0 + (n.r - r0) * 0.5 + (Math.random() - 0.5) * 6;
                const rStart = n.r;
                Sfx.tick(0, 900, 0.05, 0.05, 2);
                await tween(reduceMotion ? 1 : 220, k => { n.lift = 10 * (1 - k); n.r = rStart + (rEnd - rStart) * k; place(n); });
                n.lift = 0; place(n);
                checkReveal();
            };
            addEventListener("pointermove", move);
            addEventListener("pointerup", up);
            return true;
        },
    });
})();

/* =========================================================
   SECRET — type "lambda" (or λ) anywhere to open the back page
========================================================= */
(function secret() {
    let typed = "";
    function open() {
        const i = book.indexOf("secret");
        if (i < 0) return;
        book.unlock();
        [523, 659, 784, 1047].forEach((f, k) => Sfx.beep(k * 0.09, f, k === 3 ? 0.14 : 0.07, 0.06));
        history.replaceState(null, "", "#secret");
        const go = () => book.busy ? setTimeout(go, 200) : book.goTo(i);
        go();
    }
    // runs before every other key handler and never "uses" the key
    app.keys.unshift(e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return false;
        const k = e.key.toLowerCase();
        if (k === "λ") { typed = ""; open(); return false; }
        typed = (typed + k).slice(-6);
        if (typed === "lambda") { typed = ""; open(); }
        return false;
    });
})();

/* =========================================================
   λ RUNNER — the secret game, on the arcade cabinet's screen
   (books/art/arcade.svg: #runner-screen, .runner-demo,
   .runner-live, .runner-score). Space / ↑ / click to jump.
========================================================= */
(function runner() {
    const SX = 68, SW = 224, GROUND = 270, PX = 104;
    let playing = false, over = false, raf = 0, last = 0;
    let p, things, speed, dist, coins, gap, best = 0;
    try { best = +localStorage.getItem("notebook-runner-best") || 0; } catch {}
    let cacheModel = null, cacheSpread = -1;

    function spread() {
        if (book.model !== cacheModel) {
            cacheModel = book.model; cacheSpread = -1;
            if (book.folds) for (let s = 0; s < book.folds.length; s++)
                if (book.halves(s).some(h => h.querySelector(".runner-live"))) { cacheSpread = s; break; }
        }
        return cacheSpread;
    }
    const halves = () => book.halves(spread()).filter(h => h.querySelector(".runner-live"));
    // the cabinet's screen straddles the card's crease, so each half shows part of it
    const screenEl = () => halves().map(h => h.querySelector("#runner-screen"))[0] || null;
    const onScreen = (x, y) => halves().some(h =>
        inRect(h.getBoundingClientRect(), x, y) && inRect(h.querySelector("#runner-screen").getBoundingClientRect(), x, y, 6));

    const score = () => Math.floor(dist / 12) + coins * 10;

    function hero(x, y) {
        const step = Math.floor(dist / 14) % 2, air = y < GROUND - 1;
        const l1 = air ? -4 : step ? -6 : -2, l2 = air ? 3 : step ? 2 : 6;
        return `<rect x="${x - 9}" y="${y - 30}" width="18" height="22" rx="3" fill="#e63946" stroke="#1e1b18" stroke-width="2.5"/>`
             + `<circle cx="${x}" cy="${y - 38}" r="9" fill="#fcd5ce" stroke="#1e1b18" stroke-width="2.5"/>`
             + `<rect x="${x + l1}" y="${y - 9}" width="6" height="9" fill="#0077b6" stroke="#1e1b18" stroke-width="2"/>`
             + `<rect x="${x + l2}" y="${y - 9}" width="6" height="9" fill="#0077b6" stroke="#1e1b18" stroke-width="2"/>`;
    }
    const bug = x => `<g transform="translate(${x} ${GROUND})">`
        + `<path d="M -8,-5 L -12,0 M 0,-5 L 0,0 M 8,-5 L 12,0" stroke="#1e1b18" stroke-width="2.2" stroke-linecap="round"/>`
        + `<ellipse cx="0" cy="-9" rx="11" ry="7" fill="#e63946" stroke="#1e1b18" stroke-width="2.5"/>`
        + `<circle cx="-10" cy="-11" r="4" fill="#1e1b18"/></g>`;
    const coin = (x, y) => `<circle cx="${x}" cy="${y}" r="8" fill="#ffbe0b" stroke="#1e1b18" stroke-width="2.5"/>`
        + `<text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Georgia, serif" font-size="11" fill="#4a2c11">λ</text>`;

    function draw(extra = "") {
        let svg = `<rect x="68" y="122" width="224" height="166" fill="#1b263b"/>`;
        const off = dist % 24;
        for (let x = SX - off; x < SX + SW; x += 24)
            svg += `<line x1="${x}" y1="${GROUND + 6}" x2="${x + 8}" y2="${GROUND + 6}" stroke="#2b9348" stroke-width="2"/>`;
        svg += `<line x1="68" y1="${GROUND}" x2="292" y2="${GROUND}" stroke="#8ac926" stroke-width="3"/>`;
        for (const t of things) svg += t.kind === "bug" ? bug(t.x) : coin(t.x, t.y);
        svg += hero(PX, p.y) + extra;
        for (const h of halves()) {
            h.querySelector(".runner-live").innerHTML = svg;
            h.querySelector(".runner-score").textContent = `SCORE ${score()}`;
        }
    }

    function newGame() {
        p = { y: GROUND, vy: 0 };
        things = []; speed = 120; dist = 0; coins = 0; gap = 120; over = false;
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
    }

    function frame(now) {
        const dt = Math.min(0.033, (now - last) / 1000); last = now;
        speed = Math.min(300, speed + 5 * dt);
        dist += speed * dt;

        p.vy += 1500 * dt; p.y += p.vy * dt;
        if (p.y >= GROUND) { p.y = GROUND; p.vy = 0; }

        gap -= speed * dt;
        if (gap <= 0) {
            things.push({ kind: "bug", x: SX + SW + 14 });
            if (Math.random() < 0.45) things.push({ kind: "coin", x: SX + SW + 14 + 60 + Math.random() * 40, y: GROUND - 46 - Math.random() * 20 });
            gap = 110 + Math.random() * 130 * Math.pow(speed / 120, 0.5);
        }
        for (const t of things) t.x -= speed * dt;
        things = things.filter(t => t.x > SX - 24 && !t.gone);

        for (const t of things) {
            if (t.kind === "bug" && Math.abs(t.x - PX) < 17 && p.y > GROUND - 15) return gameOver();
            if (t.kind === "coin" && Math.abs(t.x - PX) < 15 && Math.abs((p.y - 22) - t.y) < 24) {
                t.gone = true; coins++; Sfx.beep(0, 1320, 0.05, 0.05); Sfx.beep(0.05, 1760, 0.06, 0.05);
            }
        }
        draw();
        raf = requestAnimationFrame(frame);
    }

    function jump() {
        if (over || p.y < GROUND) return;
        p.vy = -470;
        Sfx.beep(0, 520, 0.05, 0.05);
    }

    function gameOver() {
        over = true;
        cancelAnimationFrame(raf);
        best = Math.max(best, score());
        try { localStorage.setItem("notebook-runner-best", best); } catch {}
        Sfx.beep(0, 330, 0.12, 0.08); Sfx.beep(0.12, 220, 0.2, 0.08);
        const t = (y, s, size) => `<text x="180" y="${y}" text-anchor="middle" font-family="'Courier New', monospace" font-weight="bold" font-size="${size}" fill="#f8f9fa">${s}</text>`;
        draw(`<rect x="100" y="160" width="160" height="74" rx="6" fill="#1b263b" stroke="#f8f9fa" stroke-width="2"/>`
            + t(186, "GAME OVER", 18) + t(205, `BEST ${best}`, 12) + t(222, "click to retry", 11));
    }

    function start() {
        if (book.current !== spread()) return;
        playing = true;
        for (const h of halves()) h.querySelector(".runner-demo").style.display = "none";
        app.camera.focus(screenEl(), 1.45);
        Sfx.beep(0, 660); Sfx.beep(0.08, 990);
        newGame();
    }
    function stop() {
        if (!playing) return;
        playing = false;
        cancelAnimationFrame(raf);
        for (const h of halves()) {
            h.querySelector(".runner-live").innerHTML = "";
            h.querySelector(".runner-demo").style.display = "";
            h.querySelector(".runner-score").textContent = best ? `BEST ${best}` : "";
        }
        app.camera.release();
    }

    app.hotspots.unshift({
        hit: (x, y) => playing || (book.current === spread() && !book.busy && onScreen(x, y)),
        click(e) {
            if (!playing) return start();
            if (onScreen(e.clientX, e.clientY)) over ? newGame() : jump();
            else stop();
        },
    });
    app.keys.push(e => {
        if (!playing) return false;
        if (e.key === "Escape") { stop(); return true; }
        if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W" || e.key === "Enter") {
            over ? newGame() : jump();
            return true;
        }
        return e.key.startsWith("Arrow");
    });

    const prev = book.onChange;
    book.onChange = c => { prev(c); stop(); };
})();


/* =========================================================
   RÉSUMÉ — a sheet of paper on the desk; click it to open resume.pdf
========================================================= */
(function resume() {
    const X = 1228, Y = 566, W = 176, H = 228, R = -5;
    const paper = document.createElement("div");
    paper.className = "resume-paper";
    paper.style.width = W + "px";
    paper.style.height = H + "px";
    paper.innerHTML = `<img src="room/resume.svg" alt="" draggable="false">`;
    world.appendChild(paper);

    let lift = 0;
    const place = () => {
        paper.style.transform = `translate3d(${X}px, ${Y}px, ${DESK_Z + 0.8 + lift}px) rotateZ(${R}deg)`;
    };
    place();

    const hit = (x, y) => inRect(paper.getBoundingClientRect(), x, y);
    const hint = document.getElementById("linkHint");
    let hovering = false;
    addEventListener("pointermove", e => {
        const over = hit(e.clientX, e.clientY) && !app.hotspots.slice(0, -1).some(h => h !== spot && h.hit(e.clientX, e.clientY));
        if (over !== hovering) {
            hovering = over;
            paper.classList.toggle("hover", over);
            lift = over ? 4 : 0; place();
            if (hint) { hint.textContent = over ? "résumé · resume.pdf ↗" : ""; hint.classList.toggle("show", over); }
        }
        if (over && hint) hint.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 18}px)`;
    });

    const spot = {
        hit,
        click() {
            Sfx.tick(0, 1500, 0.08, 0.08, 1.2);
            window.open("resume.pdf", "_blank", "noopener");
        },
    };
    app.hotspots.push(spot);
})();

})();
