/* =========================================================
   book.js — the pop-up book engine

   Knows nothing about JSON. It takes a resolved model:
     {
       cover:   { title, subtitle, mark },
       spreads: [ { label, leftHTML, rightHTML,
                    folds: [ { y, wl, wr, h, phi, svg } ] } ]
     }
   and builds pages, turning sheets and V-fold pop-ups.
   (scene-loader.js turns a book JSON into that model.)
========================================================= */
(function () {
"use strict";

const PAGE_W = 600, PAGE_H = 760, GUTTER = 600;

/* ---------------------------------------------------------
   VECTOR MATH
--------------------------------------------------------- */
const DEG = Math.PI / 180;
const V = {
    add:   (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    mul:   (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot:   (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len:   a => Math.hypot(a[0], a[1], a[2]),
};
V.norm = a => V.mul(a, 1 / (V.len(a) || 1));

/* ---------------------------------------------------------
   SUNLIGHT
   One sun direction, one window. Each pane of glass is cast
   along SUN onto a flat surface (the desk, or a page), so the
   bright patches and the mullion shadows line up in 3D.
--------------------------------------------------------- */
const Sun = {
    DIR: [0.35, 1, -0.75],                      // forward, right, down
    WIN: { x0: -284, x1: 484, z0: 256, z1: 724, y: -140, bar: 6 },

    // where a window point (x, z) lands on the plane z = zP
    cast(x, z, zP) {
        const t = (z - zP) / -this.DIR[2];
        return [x + this.DIR[0] * t, this.WIN.y + this.DIR[1] * t];
    },

    panes() {
        const W = this.WIN, xm = (W.x0 + W.x1) / 2, zm = (W.z0 + W.z1) / 2, b = W.bar;
        const out = [];
        for (const [xa, xb] of [[W.x0, xm - b], [xm + b, W.x1]])
            for (const [za, zb] of [[W.z0, zm - b], [zm + b, W.z1]])
                out.push([[xa, za], [xb, za], [xb, zb], [xa, zb]]);
        return out;
    },

    // SVG of the light on a surface at height zP, in that surface's
    // own pixel space (its top-left sits at world ox, oy)
    svg(ox, oy, w, h, zP, shade, glow) {
        const polys = this.panes().map(q => q.map(([x, z]) => {
            const [X, Y] = this.cast(x, z, zP);
            return `${(X - ox).toFixed(1)},${(Y - oy).toFixed(1)}`;
        }).join(" "));
        const holes = polys.map(p => "M" + p.replace(/ /g, " L") + " Z").join(" ");
        return `<svg class="sunlight" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0 H${w} V${h} H0 Z ${holes}" fill-rule="evenodd" fill="rgba(25,15,6,${shade})"/>
            ${polys.map(p => `<polygon points="${p}" fill="rgba(255,222,165,${glow})"/>`).join("")}
        </svg>`;
    },

    // light falling on pop-up panels
    LIGHT: V.norm([-0.45, 0.15, 0.88])
};

/* ---------------------------------------------------------
   HELPERS
--------------------------------------------------------- */
const easeInOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function tween(duration, fn) {
    return new Promise(resolve => {
        const start = performance.now();
        function frame(now) {
            const t = Math.min(1, (now - start) / duration);
            fn(t);
            t < 1 ? requestAnimationFrame(frame) : resolve();
        }
        requestAnimationFrame(frame);
    });
}

// ox = where this page's left edge sits in book x (0 left page, 600 right page)
function makeFace(cls, html, ox) {
    const f = document.createElement("div");
    f.className = "face " + cls;
    f.innerHTML = html + Sun.svg(ox, 0, PAGE_W, PAGE_H, 0, 0.10, 0.30) + `<div class="shade"></div>`;
    return f;
}

// Write a style property only when its value actually changes
function setStyle(el, prop, value) {
    const cache = el._st || (el._st = {});
    if (cache[prop] === value) return;
    cache[prop] = value;
    el.style[prop] = value;
}

// Place a flat element: local x → X, local y → Y, origin → T, and light it
const f4 = v => +v.toFixed(4);
function place(el, X, Y, T) {
    const Z = V.norm(V.cross(X, Y));
    setStyle(el, "transform", `matrix3d(${f4(X[0])},${f4(X[1])},${f4(X[2])},0, ${f4(Y[0])},${f4(Y[1])},${f4(Y[2])},0, ${f4(Z[0])},${f4(Z[1])},${f4(Z[2])},0, ${T[0].toFixed(2)},${T[1].toFixed(2)},${T[2].toFixed(2)},1)`);
    // lighting in steps of 0.02: a new filter value can mean a repaint, so don't change it for nothing
    setStyle(el, "filter", `brightness(${(Math.round((0.7 + 0.36 * Math.max(0, V.dot(Z, Sun.LIGHT))) * 50) / 50).toFixed(2)})`);
}

/* =========================================================
   POPUP BOOK
   Sheet 0 is the front cover. Sheet k (k ≥ 1) carries the
   right page of spread k-1 on its front and the left page of
   spread k on its back. Spread s sits between sheet s (its
   left page) and sheet s+1 (its right page).

   current = -1 is the closed book; 0..N are spreads.
========================================================= */
class PopupBook {
    constructor(el) {
        this.el = el;
        this.SP = 3;              // px between stacked sheets (paper thickness)
        this.busy = false;
        this.current = -1;
        this.onChange = () => {};
        this.onTurn = () => {};   // (pages, gapMs, durMs) — fired as pages start to turn
        this.nodes = [];
    }

    get last() { return this.model ? this.model.spreads.length - 1 : -1; }

    /* -----------------------------------------------------
       BUILD (safe to call again to swap books)
    ----------------------------------------------------- */
    build(model) {
        for (const n of this.nodes) n.remove();
        this.nodes = [];
        this.model = model;

        const S = model.spreads, N = S.length - 1;
        this.M = N + 1;           // turnable sheets incl. cover
        const add = n => { this.el.appendChild(n); this.nodes.push(n); return n; };

        // the last right page never turns
        this.baseRight = add(makeFace("rp base-right", S[N].rightHTML, GUTTER));

        this.sheets = [];
        for (let k = 0; k < this.M; k++) {
            const s = document.createElement("div");
            s.className = "sheet";

            if (k === 0) {
                const c = model.cover || {};
                const front = document.createElement("div");
                front.className = "board front";
                front.innerHTML = `
                    <div class="cover-title">
                        <div class="rule"></div>
                        <h1>${c.title || ""}</h1>
                        <div class="sub">${c.subtitle || ""}</div>
                    </div>
                    <div class="cover-mark">${c.mark || ""}</div>
                    <div class="shade"></div>`;
                const back = document.createElement("div");
                back.className = "board back";
                back.appendChild(makeFace("lp", S[0].leftHTML, 0));
                s.append(front, back);
            } else {
                s.append(
                    makeFace("rp front", S[k - 1].rightHTML, GUTTER),
                    makeFace("lp back", S[k].leftHTML, 0)
                );
            }

            add(s);
            const shades = s.querySelectorAll(".shade");
            const suns = s.querySelectorAll(".sunlight");
            this.sheets.push({
                el: s, t: 0, z: 0,
                front: s.firstElementChild, back: s.lastElementChild,
                frontShade: shades[0], backShade: shades[shades.length - 1],
                frontSun: k === 0 ? null : suns[0], backSun: suns[suns.length - 1]
            });
        }

        // folds: two flat halves per card, sharing one SVG
        this.folds = S.map(spread => spread.folds.map(cfg => {
            const half = (w, offset) => {
                const d = document.createElement("div");
                d.className = "half";
                d.style.width = w + "px";
                d.style.height = cfg.h + "px";
                d.innerHTML = cfg.svg;
                d.firstElementChild.style.left = offset + "px";
                return add(d);
            };
            return { cfg, L: half(cfg.wl, 0), R: half(cfg.wr, -cfg.wl) };
        }));

        // hidden spreads at the back can't be reached until unlocked
        this.limit = S.reduce((m, sp, i) => sp.hidden ? m : i, -1);
        if (this.limit < 0) this.limit = N;

        this.current = -1;
        this.busy = false;
        this.renderAll();
        this.onChange(this.current);
    }

    unlock() {
        this.limit = this.last;
        this.onChange(this.current);
    }

    /* -----------------------------------------------------
       SHEETS
    ----------------------------------------------------- */
    /* Stack heights are measured down from the TOP of each pile, so the two
       open pages always sit at the same height (TOP) however lopsided the
       book is. A card glued between them is then level with both pages and
       never sinks under the taller one. The sums use each sheet's t, so the
       piles shift smoothly while pages are in flight. */
    renderSheet(k) {
        const S = this.sheets[k], t = S.t;
        const TOP = this.M * this.SP;
        let aboveRight = 0, aboveLeft = 0;
        for (let j = 0; j < k; j++) aboveRight += 1 - this.sheets[j].t;          // unturned sheets on top of k (right pile)
        for (let j = k + 1; j < this.M; j++) aboveLeft += this.sheets[j].t;      // turned sheets on top of k (left pile)
        const zFlat = TOP - aboveRight * this.SP;
        const zFlipped = TOP - aboveLeft * this.SP;
        S.z = zFlat + (zFlipped - zFlat) * t + Math.sin(t * Math.PI) * 8;
        setStyle(S.el, "transform", `translateZ(${S.z.toFixed(2)}px) rotateY(${(-180 * t).toFixed(3)}deg)`);

        const sh = (Math.sin(t * Math.PI) * 0.45).toFixed(3);
        setStyle(S.frontShade, "opacity", sh);
        setStyle(S.backShade, "opacity", sh);

        // sunlight only holds while a page lies flat
        const flat = Math.cos(t * Math.PI);
        if (S.frontSun) setStyle(S.frontSun, "opacity", Math.pow(Math.max(0, flat), 3).toFixed(3));
        setStyle(S.backSun, "opacity", Math.pow(Math.max(0, -flat), 3).toFixed(3));
    }

    /* -----------------------------------------------------
       V-FOLD SOLVER

       A card is folded down its middle. Its left half's bottom
       edge is glued to the left page, its right half's to the
       right page, both angled back by phi from the gutter.
       Each half is a rectangle, so the crease must be
       perpendicular to both glue lines:

           crease = normalize( glueL × glueR )

       Closed: the glue lines coincide and the card lies flat
       between the pages. Open: the crease stands upright.
    ----------------------------------------------------- */
    renderSpread(s) {
        const N = this.last;
        const tL = this.sheets[s].t, tR = s < N ? this.sheets[s + 1].t : 0;

        // a spread whose two pages lie on the same pile is shut: its cards are
        // folded flat and out of sight, so there's nothing to compute or draw
        if ((tL === 0 && tR === 0) || (tL === 1 && tR === 1)) {
            for (const { L, R } of this.folds[s]) {
                setStyle(L, "visibility", "hidden"); setStyle(R, "visibility", "hidden");
                if (L._open) { L._open = R._open = false; L.classList.remove("is-open"); R.classList.remove("is-open"); }
            }
            return;
        }
        const pageDir = a => [Math.cos(a * DEG), 0, -Math.sin(a * DEG)];
        const uL = pageDir(-180 * this.sheets[s].t);
        const uR = pageDir(s < N ? -180 * this.sheets[s + 1].t : 0);

        // glue between the two pages so a closing page always covers its card
        const glueZ = (this.sheets[s].z + (s < N ? this.sheets[s + 1].z : this.baseZ)) / 2;
        const back = [0, -1, 0];
        const settled = this.sheets[s].t === 1 && (s === N || this.sheets[s + 1].t === 0);

        for (const { cfg, L, R } of this.folds[s]) {
            const c = Math.cos(cfg.phi * DEG), sn = Math.sin(cfg.phi * DEG);
            const gL = V.add(V.mul(uL, c), V.mul(back, sn));
            const gR = V.add(V.mul(uR, c), V.mul(back, sn));

            let crease = V.cross(gL, gR);
            const open = V.len(crease);
            const visible = open > 0.004;
            setStyle(L, "visibility", visible ? "visible" : "hidden");
            setStyle(R, "visibility", visible ? "visible" : "hidden");
            // once a spread has settled open, its art may play its small one-off animations
            if (L._open !== settled) { L._open = R._open = settled; L.classList.toggle("is-open", settled); R.classList.toggle("is-open", settled); }
            if (!visible) continue;
            crease = V.mul(crease, 1 / open);

            const O = [GUTTER, cfg.y, glueZ];
            const top = V.add(O, V.mul(crease, cfg.h));
            const down = V.mul(crease, -1);

            place(R, gR, down, top);
            place(L, V.mul(gL, -1), down, V.add(top, V.mul(gL, cfg.wl)));
        }
    }

    renderAll() {
        this.sheets.forEach((_, k) => this.renderSheet(k));      // sheets first: folds read their z
        // the last right page sits just under whatever is still unturned
        const unturned = this.sheets.reduce((n, S) => n + (1 - S.t), 0);
        this.baseZ = this.M * this.SP - unturned * this.SP;
        setStyle(this.baseRight, "transform", `translateZ(${this.baseZ.toFixed(2)}px)`);
        this.model.spreads.forEach((_, s) => this.renderSpread(s));
    }

    /* -----------------------------------------------------
       NAVIGATION
    ----------------------------------------------------- */
    go(dir) { return this.goTo(this.current + dir); }

    // Turn to any spread. One page turns slowly; a longer jump
    // riffles the pages over in a quick, overlapping run.
    async goTo(target) {
        if (this.busy || target < -1 || target > this.limit || target === this.current) return;
        this.busy = true;

        const fwd = target > this.current;
        const ks = [];                                    // sheets that turn, in order
        if (fwd) for (let k = this.current + 1; k <= target; k++) ks.push(k);
        else     for (let k = this.current; k > target; k--) ks.push(k);

        const n = ks.length;
        const dur = n === 1 ? 1700 : 950;
        const gap = n === 1 ? 0 : Math.min(170, 1300 / n);
        const total = dur + gap * (n - 1);
        const from = ks.map(k => this.sheets[k].t), to = fwd ? 1 : 0;

        this.current = target;
        this.onChange(target);
        this.onTurn(n, gap, dur);

        await tween(total, T => {
            const ms = T * total;
            ks.forEach((k, i) => {
                const local = Math.max(0, Math.min(1, (ms - i * gap) / dur));
                this.sheets[k].t = from[i] + (to - from[i]) * easeInOut(local);
            });
            this.renderAll();
        });
        this.busy = false;
    }

    // Links on the two pages currently open. (Chrome won't hit-test inside
    // 3D-turned pages, so main.js checks clicks against these itself.)
    visibleLinks() {
        if (!this.sheets || this.busy || this.current < 0) return [];
        const left = this.sheets[this.current].back;
        const right = this.current < this.last ? this.sheets[this.current + 1].front : this.baseRight;
        const sel = "[data-goto], a[href]";
        return [...left.querySelectorAll(sel), ...right.querySelectorAll(sel)];
    }

    // the two faces currently open (left, right), or [] while turning / closed
    openFaces() {
        if (!this.sheets || this.busy || this.current < 0) return [];
        const left = this.sheets[this.current].back;
        const right = this.current < this.last ? this.sheets[this.current + 1].front : this.baseRight;
        return [left, right];
    }

    // every pop-up half of a spread (both halves of every card)
    halves(s) {
        return ((this.folds && this.folds[s]) || []).flatMap(f => [f.L, f.R]);
    }

    // pull-tabs: 0..1, exposed to the art as the CSS variable --pull
    setPull(s, v) {
        for (const h of this.halves(s)) h.style.setProperty("--pull", v.toFixed(3));
    }

    // index of the spread with this id, or -1
    indexOf(id) {
        return this.model ? this.model.spreads.findIndex(s => s.id === id) : -1;
    }

    // jump straight to a spread (-1 = closed), no animation
    jump(spread) {
        spread = Math.max(-1, Math.min(this.limit, spread | 0));
        this.sheets.forEach((S, k) => { S.t = k <= spread ? 1 : 0; });
        this.current = spread;
        this.renderAll();
        this.onChange(spread);
    }
}

window.Notebook = Object.assign(window.Notebook || {}, { PopupBook, Sun, V });
})();
