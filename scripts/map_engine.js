(function () {
function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function hashSeed(str) {
    const s = String(str || "");
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise2D(rng, w, h) {
    const gridW = w + 1;
    const gridH = h + 1;
    const g = new Float32Array(gridW * gridH);
    for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
            g[y * gridW + x] = rng();
        }
    }
    return { g, gridW, gridH };
}

function sampleValueNoise(noise, x, y) {
    const { g, gridW } = noise;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const tx = smooth(x - xi);
    const ty = smooth(y - yi);
    const a = g[yi * gridW + xi];
    const b = g[yi * gridW + (xi + 1)];
    const c = g[(yi + 1) * gridW + xi];
    const d = g[(yi + 1) * gridW + (xi + 1)];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fbm(noise, x, y) {
    let sum = 0;
    let amp = 0.55;
    let freq = 1.0;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
        sum += sampleValueNoise(noise, x * freq, y * freq) * amp;
        norm += amp;
        amp *= 0.55;
        freq *= 2.0;
    }
    return sum / Math.max(1e-6, norm);
}

function createMapEngine({ canvas, seed = "default", size = 140, fogEnabled = true, fogAlpha = 255 } = {}) {
    if (!canvas) throw new Error("canvas required");
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    const w = Math.max(64, Math.min(256, Number(size || 140)));
    const h = w;

    const rng = mulberry32(hashSeed(seed));
    const noise = valueNoise2D(rng, 64, 64);

    const img = ctx.createImageData(w, h);
    const towns = [];
    const heights = new Float32Array(w * h);

    const terrainColor = (v) => {
        if (v < 0.33) return [20, 40, 70];
        if (v < 0.37) return [45, 65, 90];
        if (v < 0.42) return [200, 180, 120];
        if (v < 0.62) return [60, 110, 70];
        if (v < 0.74) return [40, 85, 55];
        if (v < 0.86) return [90, 90, 95];
        return [230, 230, 235];
    };

    const build = () => {
        const startedAt = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const nx = x / w;
                const ny = y / h;
                const e = fbm(noise, nx * 2.6, ny * 2.6);
                heights[y * w + x] = e;
                const [r, g, b] = terrainColor(e);
                const i = (y * w + x) * 4;
                img.data[i] = r;
                img.data[i + 1] = g;
                img.data[i + 2] = b;
                img.data[i + 3] = 255;
            }
        }

        towns.length = 0;
        const want = 10;
        let tries = 0;
        while (towns.length < want && tries < 9000) {
            tries++;
            const x = Math.floor(rng() * w);
            const y = Math.floor(rng() * h);
            const e = heights[y * w + x];
            if (e < 0.42 || e > 0.80) continue;
            if (towns.some(t => (t.x - x) * (t.x - x) + (t.y - y) * (t.y - y) < 80)) continue;
            towns.push({ x, y, id: `town_${towns.length + 1}` });
        }
        for (const t of towns) {
            const i = (t.y * w + t.x) * 4;
            img.data[i] = 255;
            img.data[i + 1] = 190;
            img.data[i + 2] = 80;
            img.data[i + 3] = 255;
        }

        ctx.putImageData(img, 0, 0);

        const ms = ((typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now()) - startedAt;
        try { window.UIE_lastMapGenMs = ms; } catch (_) {}
        return ms;
    };

    const fog = {
        radius: 10,
        pos: { x: Math.floor(w / 2), y: Math.floor(h / 2) },
        visited: new Uint8Array(w * h)
    };

    const reveal = (cx, cy, radius) => {
        const r = Math.max(2, Math.min(40, Number(radius || fog.radius)));
        const rr = r * r;
        const x0 = Math.max(0, cx - r);
        const x1 = Math.min(w - 1, cx + r);
        const y0 = Math.max(0, cy - r);
        const y1 = Math.min(h - 1, cy + r);
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x - cx;
                const dy = y - cy;
                if (dx * dx + dy * dy <= rr) fog.visited[y * w + x] = 1;
            }
        }
    };

    const drawFog = () => {
        const fogImg = ctx.createImageData(w, h);
        const d = fogImg.data;
        for (let i = 0; i < w * h; i++) {
            const a = fog.visited[i] ? 0 : Math.max(0, Math.min(255, Number(fogAlpha || 255)));
            d[i * 4] = 0;
            d[i * 4 + 1] = 0;
            d[i * 4 + 2] = 0;
            d[i * 4 + 3] = a;
        }
        ctx.putImageData(fogImg, 0, 0);
    };

    const hitTown = (x, y) => {
        const px = Math.max(0, Math.min(w - 1, Math.floor(x)));
        const py = Math.max(0, Math.min(h - 1, Math.floor(y)));
        let best = null;
        let bestD = 999999;
        for (const t of towns) {
            const dx = t.x - px;
            const dy = t.y - py;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = t; }
        }
        if (!best) return null;
        return bestD <= 9 ? best : null;
    };

    canvas.width = w;
    canvas.height = h;

    const api = {
        width: w,
        height: h,
        towns,
        fog,
        build,
        setPlayer(x, y) {
            fog.pos.x = Math.max(0, Math.min(w - 1, Math.floor(x)));
            fog.pos.y = Math.max(0, Math.min(h - 1, Math.floor(y)));
            reveal(fog.pos.x, fog.pos.y, fog.radius);
        },
        revealAround(x, y, r) {
            reveal(Math.floor(x), Math.floor(y), r);
        },
        redraw({ withFog = true } = {}) {
            ctx.putImageData(img, 0, 0);
            if (withFog) drawFog();
        },
        hitTown
    };

    api.build();
    if (fogEnabled !== false) {
        api.setPlayer(api.fog.pos.x, api.fog.pos.y);
        api.redraw({ withFog: true });
    } else {
        fog.visited.fill(1);
        api.redraw({ withFog: false });
    }
    return api;
}

try {
    window.UIE_mapEngine = { createMapEngine };
} catch (_) {}
})();
