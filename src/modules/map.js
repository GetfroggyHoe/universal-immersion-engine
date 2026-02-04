import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "/scripts/extensions.js";
import { generateImageAPI } from "./imageGen.js";
import { MapRenderer } from "./maps/map_render.js";
import { WorldBuilder } from "./maps/world_builder.js";
import { MapEditor } from "./maps/map_editor.js";
import { Atlas } from "./maps/atlas.js";

let viewDraft = { tx: 0, ty: 0, scale: 1 };
let isGenerating = false;

function ensureMap(s) {
    if (!s.map) s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 }, grid: false };
    if (!s.map.marker) s.map.marker = { x: 0.5, y: 0.5 };
    if (typeof s.map.marker.x !== "number") s.map.marker.x = 0.5;
    if (typeof s.map.marker.y !== "number") s.map.marker.y = 0.5;
    if (!s.map.mode) s.map.mode = "procedural";
    if (s.map.seed === undefined) s.map.seed = "";
    if (typeof s.map.grid !== "boolean") s.map.grid = false;
    if (!s.map.view) s.map.view = { scale: 1, tx: 0, ty: 0 };
    if (!Number.isFinite(Number(s.map.view.scale))) s.map.view.scale = 1;
    if (!Number.isFinite(Number(s.map.view.tx))) s.map.view.tx = 0;
    if (!Number.isFinite(Number(s.map.view.ty))) s.map.view.ty = 0;
}

function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0.5;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;")
        .replace(/"/g,"&quot;")
        .replace(/'/g,"&#39;");
}

function getLoreKeys() {
    try {
        const ctx = getContext?.();
        if (!ctx) return [];
        const keys = [];

        const maybe = ctx.world_info || ctx.lorebook || ctx.lore || ctx.worldInfo;
        if (Array.isArray(maybe)) {
            for (const it of maybe) {
                const k = it?.key || it?.name || it?.title;
                if (k) keys.push(String(k));
            }
        } else if (maybe && typeof maybe === "object") {
            const entries = maybe.entries || maybe.world_info || maybe.items;
            if (Array.isArray(entries)) {
                for (const it of entries) {
                    const k = it?.key || it?.name || it?.title;
                    if (k) keys.push(String(k));
                }
            }
        }

        return Array.from(new Set(keys)).slice(0, 60);
    } catch (_) {
        return [];
    }
}

function getChatSnippet() {
    try {
        let raw = "";
        const $txt = $(".chat-msg-txt");
        if ($txt.length) {
            $txt.slice(-12).each(function () { raw += $(this).text() + "\n"; });
            return raw.trim().slice(0, 1400);
        }
        const chatEl = document.getElementById("chat");
        if (!chatEl) return "";
        const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-12);
        for (const m of msgs) {
            const isUser =
                m.classList?.contains("is_user") ||
                m.getAttribute?.("is_user") === "true" ||
                m.getAttribute?.("data-is-user") === "true" ||
                m.dataset?.isUser === "true";
            const t =
                m.querySelector?.(".mes_text")?.textContent ||
                m.querySelector?.(".mes-text")?.textContent ||
                m.textContent ||
                "";
            raw += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
        }
        return raw.trim().slice(0, 1400);
    } catch (_) {
        return "";
    }
}

function hash32(str) {
    const s = String(str || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

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

function pickSize(scope) {
    const isDesktop = window.matchMedia && window.matchMedia("(min-width: 900px)").matches;
    if (scope === "world") return isDesktop ? { w: 2800, h: 1800 } : { w: 1600, h: 1100 };
    return isDesktop ? { w: 2200, h: 1400 } : { w: 1200, h: 850 };
}

function clamp(v, a, b) {
    const n = Number(v);
    if (!Number.isFinite(n)) return a;
    return Math.max(a, Math.min(b, n));
}

function getBiomeTheme(prompt, r) {
    const p = prompt.toLowerCase();
    let bg1, bg2, land1, land2, accent;

    if (p.includes("ice") || p.includes("snow") || p.includes("winter") || p.includes("frozen")) {
        // Ice Biome
        bg1 = `hsl(210, 40%, 85%)`;
        bg2 = `hsl(210, 30%, 75%)`;
        land1 = `hsl(200, 20%, 92%)`;
        land2 = `hsl(200, 25%, 88%)`;
        accent = "#3498db";
    } else if (p.includes("desert") || p.includes("sand") || p.includes("arid") || p.includes("dune")) {
        // Desert Biome
        bg1 = `hsl(35, 40%, 70%)`;
        bg2 = `hsl(30, 35%, 60%)`;
        land1 = `hsl(40, 50%, 80%)`;
        land2 = `hsl(35, 45%, 75%)`;
        accent = "#e67e22";
    } else if (p.includes("swamp") || p.includes("marsh") || p.includes("bog")) {
        // Swamp Biome
        bg1 = `hsl(110, 28%, 26%)`;
        bg2 = `hsl(125, 22%, 20%)`;
        land1 = `hsl(98, 30%, 34%)`;
        land2 = `hsl(108, 24%, 28%)`;
        accent = "#8e44ad";
    } else if (p.includes("fire") || p.includes("volcan") || p.includes("lava") || p.includes("hell")) {
        // Volcanic Biome
        bg1 = `hsl(0, 35%, 20%)`;
        bg2 = `hsl(10, 28%, 16%)`;
        land1 = `hsl(0, 22%, 28%)`;
        land2 = `hsl(10, 26%, 24%)`;
        accent = "#c0392b";
    } else {
        // Default (Temperate/Forest)
        bg1 = `hsl(${Math.floor(r() * 360)} 35% 22%)`;
        bg2 = `hsl(${Math.floor(r() * 360)} 38% 18%)`;
        land1 = `hsl(${Math.floor(r() * 360)} 35% 38%)`;
        land2 = `hsl(${Math.floor(r() * 360)} 38% 30%)`;
        accent = "#f1c40f";
    }
    return { bg1, bg2, land1, land2, accent };
}

function buildProceduralMapDOM({ scope, prompt, seed, names, grid }) {
    const tmplRoot = document.getElementById("uie-template-map-procedural-root");
    if (!tmplRoot) return document.createDocumentFragment();

    const rootClone = tmplRoot.content.cloneNode(true);
    const rootEl = rootClone.getElementById("uie-map-root");

    const sz = pickSize(scope);
    rootEl.style.width = `${sz.w}px`;
    rootEl.style.height = `${sz.h}px`;

    const r = mulberry32(hash32(`${seed}|${scope}|${prompt}`));
    const { bg1, bg2, land1, land2, accent } = getBiomeTheme(prompt, r);

    rootEl.style.background = `radial-gradient(circle at 20% 20%, ${bg1}, ${bg2})`;

    const regions = (names?.regions && Array.isArray(names.regions) ? names.regions : []).slice(0, 4);
    const locs = (names?.locations && Array.isArray(names.locations) ? names.locations : []).slice(0, 6);
    while (regions.length < 3) regions.push(["Ashlands", "Glass Coast", "Ivory Ridge", "Old Ruins"][regions.length] || "Region");
    while (locs.length < 5) locs.push(["Outpost", "Haven", "Gate", "Sanctum", "Market"][locs.length] || "Location");

    // Blobs & Scatter
    const blobsContainer = rootClone.querySelector(".uie-map-blobs-container");
    const tmplBlob = document.getElementById("uie-template-map-blob");
    const tmplScatter = document.getElementById("uie-template-map-scatter");

    if (blobsContainer) {
        for (let i = 0; i < 10; i++) {
            const x = Math.floor(r() * sz.w);
            const y = Math.floor(r() * sz.h);
            const w = Math.floor(sz.w * (0.18 + r() * 0.22));
            const h = Math.floor(sz.h * (0.14 + r() * 0.20));
            const rot = Math.floor(-25 + r() * 50);
            const op = (0.12 + r() * 0.16).toFixed(3);
            const c = i % 2 === 0 ? land1 : land2;

            if (tmplBlob) {
                const b = tmplBlob.content.cloneNode(true).querySelector("div");
                b.style.left = `${x - w / 2}px`;
                b.style.top = `${y - h / 2}px`;
                b.style.width = `${w}px`;
                b.style.height = `${h}px`;
                b.style.opacity = op;
                b.style.transform = `rotate(${rot}deg)`;
                b.style.borderRadius = `${Math.floor(40 + r() * 60)}% ${Math.floor(40 + r() * 60)}% ${Math.floor(40 + r() * 60)}% ${Math.floor(40 + r() * 60)}% / ${Math.floor(40 + r() * 60)}% ${Math.floor(40 + r() * 60)}% ${Math.floor(40 + r() * 60)}% ${Math.floor(40 + r() * 60)}%`;
                b.style.setProperty("--blob-color", c);
                blobsContainer.appendChild(b);
            }

            // Terrain Scatter (Tiny details)
            if (i < 6 && tmplScatter) {
                const scatterCount = Math.floor(3 + r() * 5);
                for (let k = 0; k < scatterCount; k++) {
                    const sx = x + (r() - 0.5) * w * 0.6;
                    const sy = y + (r() - 0.5) * h * 0.6;
                    const type = r() > 0.5 ? "▴" : "•"; // Mountains or trees
                    const size = Math.floor(10 + r() * 8);
                    const color = type === "▴" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)";

                    const s = tmplScatter.content.cloneNode(true).querySelector("div");
                    s.textContent = type;
                    s.style.left = `${sx}px`;
                    s.style.top = `${sy}px`;
                    s.style.fontSize = `${size}px`;
                    s.style.color = color;
                    s.style.transform = `rotate(${Math.floor(r() * 20 - 10)}deg)`;
                    blobsContainer.appendChild(s);
                }
            }
        }
    }

    const placed = [];
    const locContainer = rootClone.querySelector(".uie-map-locations-container");
    const tmplPoi = document.getElementById("uie-template-map-poi");

    if (locContainer && tmplPoi) {
        for (let i = 0; i < 5; i++) {
            let x = r();
            let y = r();
            x = clamp(x, 0.08, 0.92);
            y = clamp(y, 0.10, 0.90);
            for (let tries = 0; tries < 20; tries++) {
                let ok = true;
                for (const p of placed) {
                    const dx = x - p.x;
                    const dy = y - p.y;
                    if (Math.sqrt(dx * dx + dy * dy) < 0.15) { ok = false; break; }
                }
                if (ok) break;
                x = clamp(r(), 0.08, 0.92);
                y = clamp(r(), 0.10, 0.90);
            }
            placed.push({ x, y });

            const locData = locs[i] || {};
            const name = String(locData.name || locData || `Location ${i + 1}`).slice(0, 40);
            const desc = String(locData.desc || "A mysterious place.").slice(0, 300);
            const type = String(locData.type || "Landmark").slice(0, 40);

            const iconType = type.toLowerCase().includes("fort") || type.toLowerCase().includes("castle") ? "fa-fort-awesome" :
                             type.toLowerCase().includes("dungeon") || type.toLowerCase().includes("cave") ? "fa-dungeon" :
                             type.toLowerCase().includes("forest") || type.toLowerCase().includes("grove") ? "fa-tree" :
                             type.toLowerCase().includes("city") || type.toLowerCase().includes("town") ? "fa-city" :
                             type.toLowerCase().includes("ruin") ? "fa-scroll" : "fa-location-dot";

            const p = tmplPoi.content.cloneNode(true).querySelector("div");
            p.dataset.name = name;
            p.dataset.desc = desc;
            p.dataset.type = type;
            p.title = name;
            p.style.left = `${Math.round(x * 100)}%`;
            p.style.top = `${Math.round(y * 100)}%`;

            const iconContainer = p.querySelector(".uie-poi-icon-container");
            if (iconContainer) {
                iconContainer.style.setProperty("--accent", accent);
                iconContainer.style.borderColor = accent;
                iconContainer.style.color = accent;
            }

            const icon = p.querySelector("i");
            if (icon) icon.classList.add(iconType);

            const label = p.querySelector(".uie-poi-label");
            if (label) label.textContent = name;

            locContainer.appendChild(p);
        }
    }

    // Roads
    const roadsContainer = rootClone.querySelector(".uie-map-roads-container");
    const tmplRoads = document.getElementById("uie-template-map-roads-svg");
    if (tmplRoads && roadsContainer && placed.length >= 2) {
        const roadsClone = tmplRoads.content.cloneNode(true);
        const svg = roadsClone.querySelector("svg");
        if (svg) {
            svg.setAttribute("width", sz.w);
            svg.setAttribute("height", sz.h);
            svg.setAttribute("viewBox", `0 0 ${sz.w} ${sz.h}`);

            for (let i = 0; i < placed.length - 1; i++) {
                if (r() > 0.4) {
                    const p1 = placed[i];
                    const p2 = placed[i+1];
                    const x1 = p1.x * sz.w;
                    const y1 = p1.y * sz.h;
                    const x2 = p2.x * sz.w;
                    const y2 = p2.y * sz.h;

                    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
                    const d = `M ${x1} ${y1} Q ${(x1+x2)/2 + (r()-0.5)*50} ${(y1+y2)/2 + (r()-0.5)*50} ${x2} ${y2}`;
                    path.setAttribute("d", d);
                    path.setAttribute("stroke", "#fff");
                    path.setAttribute("stroke-width", "2");
                    path.setAttribute("stroke-dasharray", "4,4");
                    path.setAttribute("fill", "none");
                    svg.appendChild(path);
                }
            }
            roadsContainer.appendChild(roadsClone);
        }
    }

    // River
    const riverContainer = rootClone.querySelector(".uie-map-river-container");
    const tmplRiver = document.getElementById("uie-template-map-river-svg");
    if (tmplRiver && riverContainer) {
        const pts = [];
        const x0 = sz.w * (0.12 + r() * 0.18);
        const y0 = sz.h * (0.15 + r() * 0.10);
        for (let i = 0; i < 7; i++) {
            const x = x0 + sz.w * (i / 6) * (0.72 + r() * 0.10);
            const y = y0 + sz.h * (0.10 + r() * 0.70);
            pts.push(`${Math.floor(x)},${Math.floor(y)}`);
        }

        const riverClone = tmplRiver.content.cloneNode(true);
        const svg = riverClone.querySelector("svg");
        if (svg) {
            svg.setAttribute("width", sz.w);
            svg.setAttribute("height", sz.h);
            svg.setAttribute("viewBox", `0 0 ${sz.w} ${sz.h}`);

            const d = `M ${pts.map(p => p.split(',').join(' ')).join(' L ')}`;
            const pathMain = riverClone.querySelector(".uie-river-path-main");
            const pathHighlight = riverClone.querySelector(".uie-river-path-highlight");

            if (pathMain) {
                pathMain.setAttribute("d", d);
                pathMain.setAttribute("stroke-width", Math.floor(28 + r() * 20));
            }
            if (pathHighlight) {
                pathHighlight.setAttribute("d", d);
                pathHighlight.setAttribute("stroke-width", Math.floor(12 + r() * 10));
            }
            riverContainer.appendChild(riverClone);
        }
    }

    // Regions
    const regionContainer = rootClone.querySelector(".uie-map-regions-container");
    const tmplRegion = document.getElementById("uie-template-map-region");
    if (regionContainer && tmplRegion) {
        regions.forEach((nm, idx) => {
            const x = Math.round((0.18 + r() * 0.64) * 100);
            const y = Math.round((0.18 + r() * 0.64) * 100);
            const name = String(nm || `Region ${idx + 1}`).slice(0, 40);

            const reg = tmplRegion.content.cloneNode(true).querySelector("div");
            reg.textContent = name;
            reg.style.left = `${x}%`;
            reg.style.top = `${y}%`;
            regionContainer.appendChild(reg);
        });
    }

    const gridEl = rootClone.querySelector(".uie-map-grid");
    if (gridEl) gridEl.style.display = grid ? "block" : "none";

    const title = scope === "world" ? "WORLD MAP" : "LOCAL MAP";
    const titleEl = rootClone.querySelector(".uie-map-title");
    const subEl = rootClone.querySelector(".uie-map-subtitle");
    if (titleEl) titleEl.textContent = title;
    if (subEl) subEl.textContent = prompt || "";

    return rootClone;
}

async function generateNames(prompt, scope) {
    const s = getSettings();
    if (s.ai && s.ai.map === false) return null;
    const loreKeys = getLoreKeys();
    const chat = getChatSnippet();
    const p = `[UIE_LOCKED]
Return ONLY valid JSON (no markdown, no commentary):
{"regions":["..."],"locations":[{"name":"...","type":"...","desc":"..."},{"name":"...","type":"...","desc":"..."}]}
Rules:
- regions: 3-4 evocative region names
- locations: 5 settlement/landmark names with a short type (Village, Ruin, Fort, Shrine, Forest, Cave, Harbor, etc) and a single-sentence description
- Fit the scope: ${scope === "world" ? "world map" : "local map"}
- If the user provided specific names/places, USE THEM and fill the rest minimally.
User request: ${prompt}
Lore keys: ${loreKeys.join(", ")}
Chat: ${chat}`.slice(0, 6000);
    const res = await generateContent(p, "Map Names");
    if (!res) return null;
    try { return JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { return null; }
}

function renderFromState() {
    const s = getSettings();
    ensureMap(s);

    $("#uie-map-scope").val(s.map.scope || "local");
    $("#uie-map-prompt").val(s.map.prompt || "");
    $("#uie-map-location").text(s.map.location || "Unknown");
    $("#uie-map-location-input").val(s.map.location || "");

    const render = document.getElementById("uie-map-render");
    if (!render) return;

    const m = window.UIE_MAP;
    const renderer = m?.renderer;
    const builder = m?.builder;
    const atlas = m?.atlas;

    const hasCanvasPipeline = !!(renderer && builder && atlas && renderer.canvas && renderer.iconLayer);

    if (!hasCanvasPipeline) {
        // Fallback: minimal image rendering (templates may not be present)
        while (render.firstChild) render.removeChild(render.firstChild);
        if (s.map.mode === "image" && s.map.image) {
            const img = document.createElement("img");
            img.src = String(s.map.image || "");
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "contain";
            img.style.display = "block";
            render.appendChild(img);
        }
    } else {
        // Canvas pipeline: keep renderer DOM intact and render content
        const playerPos = { x: clamp01(s.map.marker.x) * 100, y: clamp01(s.map.marker.y) * 100 };

        if (s.map.mode === "image" && s.map.image) {
            try {
                // Hide canvas drawing (keep icons on top)
                renderer.canvas.style.display = "none";

                // Ensure/replace a single image element under the icon layer
                const root = renderer.root || renderer.canvas?.parentElement;
                if (root) {
                    let img = root.querySelector("img.uie-map-img");
                    if (!img) {
                        img = document.createElement("img");
                        img.className = "uie-map-img";
                        img.style.display = "block";
                        img.style.position = "absolute";
                        img.style.left = "0";
                        img.style.top = "0";
                        img.style.maxWidth = "none";
                        img.style.maxHeight = "none";
                        img.style.pointerEvents = "none";
                        root.insertBefore(img, renderer.iconLayer);
                    }
                    const src = String(s.map.image || "");
                    if (img.src !== src) img.src = src;
                    img.onload = () => {
                        try {
                            const w = img.naturalWidth || img.width || 1200;
                            const h = img.naturalHeight || img.height || 800;
                            img.style.width = `${w}px`;
                            img.style.height = `${h}px`;
                            if (root) {
                                root.style.width = `${w}px`;
                                root.style.height = `${h}px`;
                            }
                            if (renderer.iconLayer) {
                                renderer.iconLayer.style.width = `${w}px`;
                                renderer.iconLayer.style.height = `${h}px`;
                            }
                        } catch (_) {}
                    };
                }

                // Render icons from lore/custom nodes even in image mode
                const baseNodes = builder.scanLore?.() || [];
                const nodes = atlas.mergeNodes ? atlas.mergeNodes(baseNodes) : baseNodes;
                renderer.renderIcons(nodes, playerPos);
            } catch (_) {}
        } else {
            // Procedural map via WorldBuilder + Atlas
            try {
                // Remove any image element and show canvas
                const root = renderer.root || renderer.canvas?.parentElement;
                try { root?.querySelector?.("img.uie-map-img")?.remove?.(); } catch (_) {}
                renderer.canvas.style.display = "block";

                const mapData = builder.generate(120, 80);
                if (mapData && mapData.nodes && atlas.mergeNodes) {
                    mapData.nodes = atlas.mergeNodes(mapData.nodes);
                }
                renderer.render(mapData, playerPos, atlas?.data?.revealed_fog_tiles);
            } catch (_) {}
        }
    }

    const root = document.querySelector("#uie-map-render #uie-map-root");
    if (root) {
        const v = s.map.view || { scale: 1, tx: 0, ty: 0 };
        root.style.transform = `translate(${Number(v.tx || 0)}px, ${Number(v.ty || 0)}px) scale(${Number(v.scale || 1)})`;
        root.style.willChange = "transform";
    }

    const marker = $("#uie-map-marker");
    marker.css({
        left: `${Math.round(clamp01(s.map.marker.x) * 100)}%`,
        top: `${Math.round(clamp01(s.map.marker.y) * 100)}%`,
    });
}

async function generateMap({ prompt, scope, forceProcedural = false }) {
    try {
        const g = (window.UIE_mapGenGate = window.UIE_mapGenGate || { inFlight: false, key: "", at: 0 });
        const k = `${String(scope || "")}::${String(prompt || "").trim()}::${forceProcedural ? "proc" : "auto"}`;
        if (g.inFlight && g.key === k && Date.now() - Number(g.at || 0) < 8000) return;
        g.inFlight = true;
        g.key = k;
        g.at = Date.now();
    } catch (_) {}

    const s = getSettings();
    ensureMap(s);

    const canImg = forceProcedural ? false : (s.image?.enabled === true && (s.image?.features?.map !== false));
    if (canImg) {
        const imgPrompt = `[UIE_LOCKED]
Top-down fantasy map illustration of: ${prompt}.
Scope: ${scope === "world" ? "world-scale continent map" : "local region map"}.
Style: high-contrast parchment map, inked outlines, subtle watercolor fills, clean coastline, rivers, roads, forests, mountains, and a few landmarks.
Rules: no text, no labels, no UI, no borders, no compass rose, no watermark.`;
        const imgUrl = await generateImageAPI(imgPrompt);
        if (imgUrl) {
            s.map.mode = "image";
            s.map.image = imgUrl;
            s.map.prompt = String(prompt);
            s.map.scope = String(scope);
            s.map.seed = "";
            s.map.data = null;
            if (!s.map.location) s.map.location = "Unknown";
            saveSettings();
            renderFromState();
            return;
        }
    }

    s.map.mode = "procedural";
    s.map.seed = String(prompt).slice(0, 120);
    const names = await generateNames(prompt, scope);
    s.map.data = names || null;
    s.map.prompt = String(prompt);
    s.map.scope = String(scope);
    if (!s.map.location) s.map.location = "Unknown";
    saveSettings();
    renderFromState();
    viewDraft = { tx: Number(getSettings()?.map?.view?.tx || 0), ty: Number(getSettings()?.map?.view?.ty || 0), scale: Number(getSettings()?.map?.view?.scale || 1) };
    try {
        const g = window.UIE_mapGenGate;
        if (g) g.inFlight = false;
    } catch (_) {}
}

function releaseMapGenGate() {
    try {
        const g = window.UIE_mapGenGate;
        if (g) g.inFlight = false;
    } catch (_) {}
}

export function initMap() {
    const s = getSettings();
    if (!s) return;
    ensureMap(s);

    // Initialize new Map Modules
    const renderer = new MapRenderer("uie-map-render");
    const builder = new WorldBuilder();
    const atlas = new Atlas();
    const editor = new MapEditor(renderer, atlas);

    // Expose to window for debugging
    window.UIE_MAP = { renderer, builder, atlas, editor };

    const $win = $("#uie-map-window");
    $win.off(".map .mapBg .mapSparkle .mapMenu .mapMenuClose .mapZoom .mapPan");
    $(document).off(".map .mapBg .mapSparkle .mapMenu .mapMenuClose .mapZoom .mapPan");

    const readFileAsBase64 = (file) => new Promise((resolve) => {
        if (!file) return resolve("");
        const r = new FileReader();
        r.onload = (e) => resolve(String(e?.target?.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(file);
    });

    $win.on("click.mapBg", "#uie-map-bg-pick", function(e){
        e.preventDefault();
        e.stopPropagation();
        const inp = document.getElementById("uie-map-bg-file");
        if (inp) inp.click();
    });

    $win.on("click.mapSparkle", "#uie-map-sparkle", function(e){
        e.preventDefault();
        e.stopPropagation();
        try { e.stopImmediatePropagation(); } catch (_) {}
        const m = document.getElementById("uie-map-menu");
        if (!m) return;
        const isOpen = String(m.style.display || "").toLowerCase() === "block";
        m.style.display = isOpen ? "none" : "block";
    });

    $win.on("click.mapMenu", "#uie-map-menu .uie-dd-item", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const id = String(this && this.id || "");
        const m = document.getElementById("uie-map-menu");
        if (m) m.style.display = "none";
        if (id === "uie-map-act-generate") {
            const p = document.getElementById("uie-map-prompt");
            if (p) p.focus();
            $("#uie-map-generate").trigger("click");
        }
        if (id === "uie-map-act-generate-canvas") {
            const scopeSel = document.getElementById("uie-map-scope");
            const p = document.getElementById("uie-map-prompt");
            const scope = String(scopeSel?.value || "local");
            const prompt = String(p?.value || "").trim();
            if (!prompt) return;
            try { await generateMap({ prompt, scope, forceProcedural: true }); } finally { releaseMapGenGate(); }
        }
        if (id === "uie-map-act-location") {
            const i = document.getElementById("uie-map-location-input");
            if (i) i.focus();
            $("#uie-map-set-location").trigger("click");
        }
        if (id === "uie-map-act-grid") {
            const s2 = getSettings();
            ensureMap(s2);
            s2.map.grid = !(s2.map.grid === true);
            saveSettings();
            renderFromState();
        }
        if (id === "uie-map-act-refresh") {
            $("#uie-map-refresh").trigger("click");
        }
    });

    // Close menu if clicked elsewhere in the window
    $win.on("click.mapMenuClose", function(e){
        if ($(e.target).closest("#uie-map-sparkle, #uie-map-menu").length) return;
        const m = document.getElementById("uie-map-menu");
        if (m) m.style.display = "none";
    });

    // File input is usually outside the window or hidden, but triggered by button inside.
    // The input itself needs a listener. Since it's in the template (line 61) but outside #uie-map-window div?
    // Wait, let's check the template again.
    // Line 61: <input type="file" ...> is AFTER the closing </div> of #uie-map-window.
    // So $win.on("change") won't catch it if it bubbles up to document.
    // I should move the input inside the window or keep it global.
    // Or just attach to the input directly if I can find it.
    // But since it's an input change event, it's not affected by the "Nuclear Blocker" (which blocks clicks).
    // So I can leave it global or scope it to `body`.
    // Let's stick to `$(document)` for the file input change as it's safe from click blockers.
    $(document).off("change.mapBg").on("change.mapBg", "#uie-map-bg-file", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const f = e.target && e.target.files ? e.target.files[0] : null;
        const dataUrl = await readFileAsBase64(f);
        if (!dataUrl) return;
        const s2 = getSettings();
        if (!s2.ui) s2.ui = { backgrounds: {}, css: { global: "" } };
        if (!s2.ui.backgrounds) s2.ui.backgrounds = {};
        s2.ui.backgrounds.map = dataUrl;
        saveSettings();
        try { (await import("./core.js")).updateLayout?.(); } catch (_) {}
    });

    $win.on("click.map", "#uie-btn-open-map", (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    $win.on("click.map", "#uie-map-generate", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const scope = String($("#uie-map-scope").val() || "local");
        const prompt = String($("#uie-map-prompt").val() || "").trim();
        if (!prompt) return;
        try { await generateMap({ prompt, scope }); } finally { releaseMapGenGate(); }
    });

    $win.on("click.map", "#uie-map-refresh", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureMap(s2);
        const prompt = String(s2.map.prompt || "").trim();
        const scope = String(s2.map.scope || "local");
        if (!prompt) return;
        try { await generateMap({ prompt, scope }); } finally { releaseMapGenGate(); }
    });

    $win.on("click.map", "#uie-map-set-location", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureMap(s2);
        s2.map.location = String($("#uie-map-location-input").val() || "Unknown").slice(0, 80);
        saveSettings();
        renderFromState();
    });

    const pointers = new Map();
    let dragActive = false;
    let dragMoved = false;
    let start = null;
    let pinchStart = null;
    let raf = 0;
    viewDraft = { tx: Number(s.map.view?.tx || 0), ty: Number(s.map.view?.ty || 0), scale: Number(s.map.view?.scale || 1) };
    const applyDraftTransform = () => {
        raf = 0;
        const root = document.querySelector("#uie-map-render #uie-map-root");
        if (!root) return;
        root.style.transform = `translate(${Number(viewDraft.tx || 0)}px, ${Number(viewDraft.ty || 0)}px) scale(${Number(viewDraft.scale || 1)})`;
    };
    const scheduleTransform = () => { if (!raf) raf = requestAnimationFrame(applyDraftTransform); };

    const setMarkerFromClient = (clientX, clientY) => {
        const s2 = getSettings();
        ensureMap(s2);
        const container = document.getElementById("uie-map-render");
        const root = container ? container.querySelector("#uie-map-root") : null;
        const rect = (root || container).getBoundingClientRect();
        const x = (clientX - rect.left) / rect.width;
        const y = (clientY - rect.top) / rect.height;
        s2.map.marker.x = clamp01(x);
        s2.map.marker.y = clamp01(y);
        saveSettings();
        renderFromState();
    };

    const clampScale = (z) => clamp(z, 0.55, 3.2);

    const zoomAt = (clientX, clientY, nextScale) => {
        const container = document.getElementById("uie-map-render");
        const root = container ? container.querySelector("#uie-map-root") : null;
        if (!root) return;
        const rect = root.getBoundingClientRect();
        const curScale = Number(viewDraft.scale || 1);
        const scale = clampScale(nextScale);
        const px = clientX - rect.left;
        const py = clientY - rect.top;
        const k = scale / curScale;
        viewDraft.tx = Number(viewDraft.tx || 0) - px * (k - 1);
        viewDraft.ty = Number(viewDraft.ty || 0) - py * (k - 1);
        viewDraft.scale = scale;
        scheduleTransform();
    };

    $win.on("wheel.mapZoom", "#uie-map-canvas", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.originalEvent ? e.originalEvent.deltaY : e.deltaY;
        const step = delta > 0 ? 0.9 : 1.1;
        zoomAt(e.clientX, e.clientY, Number(viewDraft.scale || 1) * step);
    });

    $win.on("pointerdown.mapPan", "#uie-map-canvas", function(e) {
        this.setPointerCapture?.(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        dragActive = true;
        dragMoved = false;
        start = { x: e.clientX, y: e.clientY, tx: Number(viewDraft.tx || 0), ty: Number(viewDraft.ty || 0) };

        if (pointers.size === 2) {
            const pts = Array.from(pointers.values());
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            pinchStart = { dist: Math.hypot(dx, dy), scale: Number(viewDraft.scale || 1), midX: (pts[0].x + pts[1].x) / 2, midY: (pts[0].y + pts[1].y) / 2 };
        }
    });

    $win.on("pointermove.mapPan", "#uie-map-canvas", function(e) {
        if (!dragActive) return;
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2 && pinchStart) {
            const pts = Array.from(pointers.values());
            const dx = pts[0].x - pts[1].x;
            const dy = pts[0].y - pts[1].y;
            const dist = Math.hypot(dx, dy);
            const ratio = dist / (pinchStart.dist || dist || 1);
            const next = clampScale(Number(pinchStart.scale || 1) * ratio);
            zoomAt(pinchStart.midX, pinchStart.midY, next);
            dragMoved = true;
            return;
        }

        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
        viewDraft.tx = Number(start.tx || 0) + dx;
        viewDraft.ty = Number(start.ty || 0) + dy;
        scheduleTransform();
    });

    $win.on("pointerup.mapPan pointercancel.mapPan", "#uie-map-canvas", function(e) {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchStart = null;
        if (pointers.size === 0) {
            dragActive = false;
            const wasTap = !dragMoved;
            dragMoved = false;
            start = null;
            const s2 = getSettings();
            ensureMap(s2);
            s2.map.view.tx = Number(viewDraft.tx || 0);
            s2.map.view.ty = Number(viewDraft.ty || 0);
            s2.map.view.scale = Number(viewDraft.scale || 1);
            saveSettings();
            if (wasTap) {
                // Check if we tapped a POI
                const poi = e.target.closest(".uie-map-poi");
                if (poi) {
                    const name = poi.dataset.name || "Unknown";
                    const desc = poi.dataset.desc || "No information available.";
                    const type = poi.dataset.type || "Location";

                    $("#uie-map-card-title").text(name);
                    $("#uie-map-card-desc").text(desc);
                    $("#uie-map-card-type").text(type);
                    $("#uie-map-info-card").fadeIn(200);
                } else if (!e.target.closest("#uie-map-info-card")) {
                    $("#uie-map-info-card").fadeOut(200);
                    setMarkerFromClient(e.clientX, e.clientY);
                }
            }
        }
    });

    $win.on("pointerup.map click.map", "#uie-map-card-close", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-map-info-card").fadeOut(200);
    });

    renderFromState();
}
