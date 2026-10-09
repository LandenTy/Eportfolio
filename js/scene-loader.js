/* =========================================================
   scene-loader.js — book JSON → model for PopupBook

   BOOK JSON
   {
     "cover":   { "title": "...", "subtitle": "...", "mark": "λ" },
     "spreads": [ SPREAD, ... ]
   }

   SPREAD
   {
     "id":    "projects",              // optional; a link target
     "hidden": true,                   // optional; can't be paged to until
                                       // unlocked (see book.unlock())
     "label": "02 / Under the hood",   // shown at the top of the screen
     "left":  PAGE,
     "right": PAGE,
     "folds": [ FOLD, ... ]            // optional
   }

   PAGE (every field optional; strings may contain inline HTML)
   {
     "label":   "02 / Under the hood",      // small caps, top corner
     "title":   { "text": "PREFACE", "sub": "..." },  // big title, top
     "kicker":  "Targets",                  // small caps above heading
     "heading": "Lambda",
     "text":    ["paragraph", "paragraph"],
     "hand":    "a handwritten line under the text",
     "notes":   [ { "text": "...", "left": 70, "bottom": 110, "rotate": -5,
                    "goto": "contents" } ],   // goto makes the note a link
                                              // (any html can link too:
                                              //  <a data-goto="projects">)
     "num":     "02",                       // page number
     "html":    "<div>anything else, absolutely positioned</div>"
   }

   FOLD — a V-folded card across the gutter (book space is
   1200 × 760, gutter at x = 600, y grows toward the reader)
   {
     "y":   470,          // where the crease meets the gutter
     "wl":  95,           // width of the left half
     "wr":  95,           // width of the right half
     "h":   266,          // card height
     "phi": 24,           // V-angle in degrees (10–18 flat wall, 30–40 deep V)
     "art": "art/figure.svg"            // one drawing across the whole card
       — or —
     "wing": { "left": "art/mug.svg", "right": "art/floppy.svg" }
                                        // paper strip with an object on each end
   }

   Art can be a path (relative to the JSON file) or an inline
   "<svg ...>...</svg>" string.
========================================================= */
(function () {
"use strict";

const INK = "#25231f", PAPER3 = "#e0d7c6";

class SceneError extends Error {}

/* ---------------------------------------------------------
   VALIDATION — readable errors that say where the problem is
--------------------------------------------------------- */
function check(cond, where, msg) {
    if (!cond) throw new SceneError(`${where}: ${msg}`);
}

function validate(book) {
    check(book && typeof book === "object", "book", "must be a JSON object");
    check(Array.isArray(book.spreads) && book.spreads.length > 0, "book.spreads", "needs at least one spread");

    book.spreads.forEach((sp, i) => {
        const at = `spreads[${i}]`;
        check(sp && typeof sp === "object", at, "must be an object");
        for (const side of ["left", "right"])
            check(sp[side] == null || typeof sp[side] === "object", `${at}.${side}`, "must be an object");
        check(sp.folds == null || Array.isArray(sp.folds), `${at}.folds`, "must be an array");

        if (sp.id != null) check(typeof sp.id === "string" && /^[\w-]+$/.test(sp.id), `${at}.id`, "must be a simple name like \"projects\"");

        (sp.folds || []).forEach((f, j) => {
            const fa = `${at}.folds[${j}]`;
            for (const key of ["y", "wl", "wr", "h", "phi"])
                check(typeof f[key] === "number", fa, `"${key}" must be a number`);
            check(f.wl > 0 && f.wr > 0 && f.h > 0, fa, "wl, wr and h must be > 0");
            check(f.phi > 0 && f.phi < 89, fa, `"phi" must be between 0 and 89`);
            check(!!f.art !== !!f.wing, fa, `needs exactly one of "art" or "wing"`);
            if (f.wing) check(f.wing.left && f.wing.right, `${fa}.wing`, `needs "left" and "right"`);
            check(f.y + f.h <= 760, fa, `y + h = ${f.y + f.h} — the card would hang off the page when folded flat (max 760)`);
            check(f.wl <= 600 && f.wr <= 600, fa, "a half can't be wider than a page (600)");
        });
    });

    // ids are unique, and every link points at one
    const ids = new Set();
    book.spreads.forEach((sp, i) => {
        if (sp.id == null) return;
        check(!ids.has(sp.id), `spreads[${i}].id`, `"${sp.id}" is used twice`);
        ids.add(sp.id);
    });
    book.spreads.forEach((sp, i) => {
        for (const side of ["left", "right"]) {
            const p = sp[side] || {};
            const targets = [...String(p.html || "").matchAll(/data-goto="([^"]+)"/g)].map(m => m[1])
                .concat((p.notes || []).filter(n => n.goto).map(n => n.goto));
            for (const t of targets)
                check(ids.has(t), `spreads[${i}].${side}`, `links to "${t}", but no spread has that id`);
        }
    });
}

/* ---------------------------------------------------------
   ART
--------------------------------------------------------- */
const cache = new Map();

async function loadArt(ref, base, where) {
    let text;
    if (/^\s*<svg[\s>]/i.test(ref)) {
        text = ref;
    } else {
        const url = new URL(ref, base).href;
        if (!cache.has(url)) {
            cache.set(url, fetch(url, { cache: "no-store" }).then(r => {
                if (!r.ok) throw new SceneError(`${where}: couldn't load "${ref}" (${r.status})`);
                return r.text();
            }));
        }
        try { text = await cache.get(url); }
        catch (e) {
            cache.delete(url);
            throw e instanceof SceneError ? e
                : new SceneError(`${where}: couldn't load "${ref}". Opening the page as a file? Art files need a local server (see README).`);
        }
    }

    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    const svg = doc.documentElement;
    check(svg && svg.nodeName.toLowerCase() === "svg" && !doc.querySelector("parsererror"), where, `"${ref.slice(0, 40)}" isn't valid SVG`);

    let vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(isNaN)) {
        const w = parseFloat(svg.getAttribute("width")) || 100, h = parseFloat(svg.getAttribute("height")) || 100;
        vb = [0, 0, w, h];
    }
    return { svg, vb };
}

// One drawing fitted to the whole card, sitting on the fold line
function cardSVG(art, W, H) {
    const s = art.svg.cloneNode(true);
    s.setAttribute("viewBox", art.vb.join(" "));
    s.setAttribute("width", W);
    s.setAttribute("height", H);
    s.setAttribute("preserveAspectRatio", "xMidYMax meet");
    s.setAttribute("overflow", "visible");
    return new XMLSerializer().serializeToString(s);
}

// A paper strip spanning the gutter with an object standing on each end
function wingSVG(L, R, W, H) {
    const strip = 14, room = H - strip - 4;
    const fit = a => {
        const w = a.vb[2], h = a.vb[3], k = Math.min(1, room / h);
        return { w: w * k, h: h * k };
    };
    const nest = (a, x, y, w, h) => {
        const s = a.svg.cloneNode(true);
        s.setAttribute("x", x); s.setAttribute("y", y);
        s.setAttribute("width", w); s.setAttribute("height", h);
        s.setAttribute("viewBox", a.vb.join(" "));
        s.setAttribute("overflow", "visible");
        return new XMLSerializer().serializeToString(s);
    };
    const l = fit(L), r = fit(R);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" overflow="visible">
        <rect x="3" y="${H - strip - 4}" width="${W - 6}" height="${strip}" rx="3" fill="${PAPER3}" stroke="${INK}" stroke-width="3"/>
        ${nest(L, 6, H - strip - l.h, l.w, l.h)}
        ${nest(R, W - 6 - r.w, H - strip - r.h, r.w, r.h)}
    </svg>`;
}

/* ---------------------------------------------------------
   PAGES
--------------------------------------------------------- */
function pageHTML(p) {
    p = p || {};
    let h = "";
    if (p.label) h += `<div class="label">${p.label}</div>`;
    if (p.title) {
        const t = typeof p.title === "string" ? { text: p.title } : p.title;
        h += `<div class="title-block"><h1>${t.text || ""}</h1>${t.sub ? `<div class="sub">${t.sub}</div>` : ""}</div>`;
    }
    if (p.kicker || p.heading || p.text || p.hand) {
        h += `<div class="copy">`;
        if (p.kicker) h += `<div class="small">${p.kicker}</div>`;
        if (p.heading) h += `<h2>${p.heading}</h2>`;
        for (const para of [].concat(p.text || [])) h += `<p>${para}</p>`;
        if (p.hand) h += `<div class="hand" style="position:static;">${p.hand}</div>`;
        h += `</div>`;
    }
    for (const n of p.notes || []) {
        const pos = ["left", "right", "top", "bottom"].filter(k => n[k] != null).map(k => `${k}:${n[k]}px`).join(";");
        const style = `${pos};transform:rotate(${n.rotate ?? -5}deg)`;
        h += n.goto
            ? `<a class="hand note goto" href="#${n.goto}" data-goto="${n.goto}" style="${style}">${n.text}</a>`
            : `<div class="hand note" style="${style}">${n.text}</div>`;
    }
    if (p.html) h += p.html;
    if (p.num != null) h += `<div class="num">${p.num}</div>`;
    return h;
}

/* ---------------------------------------------------------
   PUBLIC
--------------------------------------------------------- */
async function fromObject(book, base) {
    validate(book);
    const spreads = await Promise.all(book.spreads.map(async (sp, i) => ({
        id: sp.id || null,
        hidden: !!sp.hidden,
        label: sp.label || `Spread ${i + 1}`,
        leftHTML: pageHTML(sp.left),
        rightHTML: pageHTML(sp.right),
        folds: await Promise.all((sp.folds || []).map(async (f, j) => {
            const where = `spreads[${i}].folds[${j}]`, W = f.wl + f.wr;
            const svg = f.art
                ? cardSVG(await loadArt(f.art, base, where), W, f.h)
                : wingSVG(await loadArt(f.wing.left, base, where + ".wing.left"),
                          await loadArt(f.wing.right, base, where + ".wing.right"), W, f.h);
            return { y: f.y, wl: f.wl, wr: f.wr, h: f.h, phi: f.phi, svg };
        }))
    })));
    return { cover: book.cover || {}, spreads };
}

async function fromURL(url) {
    const abs = new URL(url, location.href).href;
    let res;
    try { res = await fetch(abs, { cache: "no-store" }); }
    catch { throw new SceneError(`Couldn't load "${url}". If you opened index.html as a file, run a local server (see README) or drop the JSON onto the page.`); }
    if (!res.ok) throw new SceneError(`Couldn't load "${url}" (${res.status})`);

    let json;
    try { json = await res.json(); }
    catch (e) { throw new SceneError(`"${url}" isn't valid JSON — ${e.message}`); }
    return fromObject(json, abs);
}

async function fromText(text, base) {
    let json;
    try { json = JSON.parse(text); }
    catch (e) { throw new SceneError(`Not valid JSON — ${e.message}`); }
    return fromObject(json, base);
}

window.Notebook = Object.assign(window.Notebook || {}, {
    SceneLoader: { fromURL, fromText, fromObject, SceneError }
});
})();
