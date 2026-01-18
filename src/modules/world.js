import { getSettings, saveSettings } from "./core.js";
import { scanEverything } from "./stateTracker.js";
import { notify } from "./notifications.js";

let reBound = false;
let reObserver = null;
let reLastSig = "";
let reEngine = null;
let reV3 = null;

async function ensureRealityV3() {
    if (reV3) return reV3;
    try {
        const engMod = await import("./reality/engine.js");
        const forgeMod = await import("./reality/forge.js");
        const gpMod = await import("./reality/gameplay.js");
        reV3 = engMod.getRealityEngineV3();
        try { forgeMod.initForgeV3(); } catch (_) {}
        try { gpMod.initGameplayV3(); } catch (_) {}
        return reV3;
    } catch (_) {
        return null;
    }
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function slug(s) {
    return String(s || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60);
}

function hash(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h);
}

function readLastChatMessage() {
    try {
        const chatEl = document.getElementById("chat");
        if (!chatEl) return null;
        const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
        if (!last) return null;
        const name =
            last.querySelector?.(".mes_name")?.textContent ||
            last.querySelector?.(".name_text")?.textContent ||
            last.querySelector?.(".name")?.textContent ||
            last.getAttribute?.("ch_name") ||
            last.getAttribute?.("data-name") ||
            last.dataset?.name ||
            "";
        const text =
            last.querySelector?.(".mes_text")?.textContent ||
            last.querySelector?.(".mes-text")?.textContent ||
            last.textContent ||
            "";
        const nm = String(name || "").trim() || "Story";
        const tx = String(text || "").trim();
        if (!tx) return null;
        return { name: nm.slice(0, 80), text: tx.slice(0, 6000) };
    } catch (_) {
        return null;
    }
}

function extractTagValue(text, key) {
    const re = new RegExp(`\\[\\s*${key}\\s*:\\s*([^\\]]+)\\]`, "ig");
    let out = [];
    let m = null;
    while ((m = re.exec(String(text || ""))) !== null) out.push(String(m[1] || "").trim());
    out = out.filter(Boolean);
    return out.length ? out[out.length - 1] : "";
}

function stripTags(text) {
    let t = String(text || "");
    t = t.replace(/<think[\s\S]*?<\/think>/gi, "");
    t = t.replace(/<analysis[\s\S]*?<\/analysis>/gi, "");
    t = t.replace(/^\s*(thinking|analysis)\s*:[^\n]*$/gim, "");
    t = stripCssBlocks(t);
    t = t.replace(/<[^>]*?>/g, "");
    t = t.replace(/\[[^\]]*?\]/g, "");
    t = t.replace(/\s+\n/g, "\n");
    return t.trim();
}

function stripCssBlocks(text) {
    const src = String(text || "").replace(/\r/g, "");
    const lines = src.split("\n");
    const out = [];
    let depth = 0;
    for (const line of lines) {
        const t = String(line || "");
        const s = t.trim();
        if (!s) {
            if (depth === 0) out.push("");
            continue;
        }
        const opens = (s.match(/\{/g) || []).length;
        const closes = (s.match(/\}/g) || []).length;
        if (depth > 0) {
            depth = Math.max(0, depth + opens - closes);
            continue;
        }
        const looksCssStart =
            /^(\.|\#|:root\b|@keyframes\b|@media\b|@font-face\b)/i.test(s) ||
            (s.includes("--") && s.includes(":")) ||
            (s.includes("{") && s.includes(":") && !/\bhttps?:\/\//i.test(s));
        if (looksCssStart) {
            depth = Math.max(1, opens - closes);
            continue;
        }
        out.push(t);
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function ensureReality(s) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") {
        s.realityEngine = {
            enabled: false,
            view: "room",
            locationId: "",
            stress: 0,
            maxStress: 100,
            backgrounds: {},
            audio: { enabled: true },
            ui: { showQuickButtons: true, showHud: true, hideStUi: true, vnInstant: true }
        };
    }
    const r = s.realityEngine;
    if (typeof r.enabled !== "boolean") r.enabled = false;
    if (typeof r.view !== "string") r.view = "room";
    if (typeof r.locationId !== "string") r.locationId = "";
    if (!r.backgrounds || typeof r.backgrounds !== "object") r.backgrounds = {};
    if (!r.audio || typeof r.audio !== "object") r.audio = { enabled: true };
    if (typeof r.audio.enabled !== "boolean") r.audio.enabled = true;
    if (!r.ui || typeof r.ui !== "object") r.ui = { showQuickButtons: true };
    if (typeof r.ui.showQuickButtons !== "boolean") r.ui.showQuickButtons = true;
    if (typeof r.ui.showHud !== "boolean") r.ui.showHud = true;
    if (typeof r.ui.hideStUi !== "boolean") r.ui.hideStUi = true;
    if (typeof r.ui.vnInstant !== "boolean") r.ui.vnInstant = true;
    if (typeof r.ui.allowBg !== "boolean") r.ui.allowBg = false;
    if (typeof r.comingSoon !== "boolean") r.comingSoon = true;
    if (!Number.isFinite(Number(r.stress))) r.stress = 0;
    if (!Number.isFinite(Number(r.maxStress)) || Number(r.maxStress) <= 0) r.maxStress = 100;
    if (!r.sprites || typeof r.sprites !== "object") r.sprites = { sets: {}, speakerMap: {} };
    if (!r.sprites.sets || typeof r.sprites.sets !== "object") r.sprites.sets = {};
    if (!r.sprites.speakerMap || typeof r.sprites.speakerMap !== "object") r.sprites.speakerMap = {};
}

function setStageEnabled(enabled) {
    const el = document.getElementById("reality-stage");
    if (!el) return;
    const s = getSettings();
    ensureReality(s);
    if (s.realityEngine.comingSoon === true) enabled = false;
    if (enabled) {
        el.style.display = "block";
        try { document.getElementById("re-bg")?.style && (document.getElementById("re-bg").style.backgroundImage = ""); } catch (_) {}
        if (s.realityEngine.ui?.hideStUi !== false) document.body.dataset.realityStage = "1";
        else delete document.body.dataset.realityStage;
    } else {
        el.style.display = "none";
        delete document.body.dataset.realityStage;
        try { document.getElementById("re-bg")?.style && (document.getElementById("re-bg").style.backgroundImage = ""); } catch (_) {}
        try { const m = document.getElementById("re-st-menu"); if (m) m.style.display = "none"; } catch (_) {}
        try { const f = document.getElementById("re-forge-modal"); if (f) f.style.display = "none"; } catch (_) {}
    }
}

async function ensureMapEngine() {
    try {
        if (window.UIE_mapEngine?.createMapEngine) return window.UIE_mapEngine;
    } catch (_) {}
    const baseUrl = String(window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/").trim();
    const src = `${baseUrl}scripts/map_engine.js?v=${Date.now()}`;
    await new Promise((resolve) => {
        try {
            const existing = Array.from(document.querySelectorAll("script")).find(s => String(s?.src || "").includes("scripts/map_engine.js"));
            if (existing) return resolve();
            const el = document.createElement("script");
            el.src = src;
            el.async = true;
            el.onload = () => resolve();
            el.onerror = () => resolve();
            document.head.appendChild(el);
        } catch (_) {
            resolve();
        }
    });
    try { return window.UIE_mapEngine || null; } catch (_) { return null; }
}

class RealityEngine {
    constructor() {
        this.typingTimer = null;
        this.typingText = "";
        this.typingIdx = 0;
        this.map = null;
        this.audio = { el: null, cache: new Map() };
    }

    getLocationId() {
        const s = getSettings();
        ensureReality(s);
        const wsLoc = String(s?.worldState?.location || "").trim();
        const locId = slug(wsLoc || s.realityEngine.locationId || "unknown");
        s.realityEngine.locationId = locId;
        saveSettings();
        return locId;
    }

    applyBackground() {
        const s = getSettings();
        ensureReality(s);
        const locId = this.getLocationId();
        if (s.realityEngine.ui?.allowBg !== true) {
            try {
                const bgEl0 = document.getElementById("re-bg");
                if (bgEl0) bgEl0.style.backgroundImage = "";
            } catch (_) {}
            return;
        }
        let bg = "";
        try {
            const v3 = window.UIE_realityV3;
            if (v3 && typeof v3.getBackground === "function") bg = String(v3.getBackground(locId) || "").trim();
        } catch (_) {}
        if (!bg) bg = String(s.realityEngine.backgrounds?.[locId] || "").trim();
        const bgEl = document.getElementById("re-bg");
        if (bgEl) {
            if (bg) {
                bgEl.style.backgroundImage = `url("${bg}")`;
                bgEl.style.backgroundSize = "cover";
                bgEl.style.backgroundPosition = "center";
            } else {
                bgEl.style.backgroundImage = "";
            }
        }
    }

    setSprite(charName, mood) {
        const img = document.getElementById("re-sprite");
        if (!img) return;
        const wantName = String(charName || "").trim();
        const wantNorm = slug(wantName || "story");

        const readImgSrc = (el) => {
            if (!el) return "";
            const attrs = ["src", "data-src", "data-original", "data-url", "data-lazy", "currentSrc"];
            for (const k of attrs) {
                const v = String(el.getAttribute?.(k) || el[k] || "").trim();
                if (v) return v;
            }
            return "";
        };

        const readBgUrl = (el) => {
            try {
                const s = String(el?.style?.backgroundImage || "").trim();
                const m = s.match(/url\((['"]?)(.+?)\1\)/i);
                return String(m?.[2] || "").trim();
            } catch (_) {
                return "";
            }
        };

        const isVisible = (el) => {
            try {
                if (!el) return false;
                if (el.offsetParent === null) return false;
                const st = window.getComputedStyle(el);
                if (!st) return true;
                if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") return false;
                return true;
            } catch (_) {
                return true;
            }
        };

        const findExpressionViaExtensionUi = () => {
            const roots = [];
            try {
                document.querySelectorAll("[id*='express' i], [class*='express' i]").forEach((el) => {
                    if (el && !roots.includes(el)) roots.push(el);
                });
            } catch (_) {}
            for (const sel of ["#extensions_settings", "#extensions_settings2", "#extension_settings", "#right-nav-panel", "#left-nav-panel"]) {
                const el = document.querySelector(sel);
                if (el && !roots.includes(el)) roots.push(el);
            }
            if (!roots.length) roots.push(document.body);
            const scoreImg = (el) => {
                const id = String(el?.id || "").toLowerCase();
                const cls = String(el?.className || "").toLowerCase();
                const alt = String(el?.getAttribute?.("alt") || "").toLowerCase();
                const title = String(el?.getAttribute?.("title") || "").toLowerCase();
                const aria = String(el?.getAttribute?.("aria-label") || "").toLowerCase();
                const src = String(readImgSrc(el) || "").toLowerCase();
                let score = 0;
                if (id.includes("expression") || id.includes("express")) score += 12;
                if (cls.includes("expression") || cls.includes("express")) score += 12;
                if (alt.includes("expression")) score += 8;
                if (title.includes("expression") || aria.includes("expression")) score += 8;
                if (src.includes("expression") || src.includes("expressions")) score += 6;
                if (src.includes("characters")) score += 2;
                if (/^data:image\//i.test(src)) score += 2;
                if (!isVisible(el)) score -= 8;
                const w = Number(el?.naturalWidth || el?.width || 0);
                const h = Number(el?.naturalHeight || el?.height || 0);
                if ((w && w <= 40) || (h && h <= 40)) score -= 6;
                return score;
            };
            const scoreBg = (el, url) => {
                const id = String(el?.id || "").toLowerCase();
                const cls = String(el?.className || "").toLowerCase();
                const u = String(url || "").toLowerCase();
                let score = 0;
                if (id.includes("expression") || id.includes("express")) score += 12;
                if (cls.includes("expression") || cls.includes("express")) score += 12;
                if (u.includes("expression") || u.includes("expressions")) score += 6;
                if (u.includes("characters")) score += 2;
                if (!isVisible(el)) score -= 8;
                return score;
            };

            const candidates = [];
            for (const root of roots) {
                try {
                    const imgs = Array.from(root.querySelectorAll("img"));
                    for (const el of imgs) {
                        const src = readImgSrc(el);
                        if (!src) continue;
                        const s = scoreImg(el);
                        if (s <= 0) continue;
                        candidates.push({ src, score: s });
                    }
                } catch (_) {}
                try {
                    const nodes = Array.from(root.querySelectorAll("*"));
                    for (const el of nodes) {
                        const bg = readBgUrl(el);
                        if (!bg) continue;
                        const s = scoreBg(el, bg);
                        if (s <= 0) continue;
                        candidates.push({ src: bg, score: s });
                    }
                } catch (_) {}
            }
            candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
            return String(candidates[0]?.src || "").trim();
        };

        const getNameFromMes = (m) => {
            try {
                const name =
                    m.querySelector?.(".mes_name")?.textContent ||
                    m.querySelector?.(".name_text")?.textContent ||
                    m.querySelector?.(".name")?.textContent ||
                    m.getAttribute?.("ch_name") ||
                    m.getAttribute?.("data-name") ||
                    m.dataset?.name ||
                    "";
                return String(name || "").trim();
            } catch (_) {
                return "";
            }
        };

        const isUserMes = (m) => {
            try {
                return !!(
                    m.classList?.contains("is_user") ||
                    m.getAttribute?.("is_user") === "true" ||
                    m.getAttribute?.("data-is-user") === "true" ||
                    m.dataset?.isUser === "true"
                );
            } catch (_) {
                return false;
            }
        };

        const findMesForSpeaker = () => {
            const chat = document.getElementById("chat");
            if (!chat) return null;
            const nodes = Array.from(chat.querySelectorAll(".mes"));
            for (let i = nodes.length - 1; i >= 0; i--) {
                const m = nodes[i];
                if (!m) continue;
                if (isUserMes(m)) continue;
                const nm = getNameFromMes(m);
                if (!nm) continue;
                if (slug(nm) === wantNorm) return m;
            }
            for (let i = nodes.length - 1; i >= 0; i--) {
                const m = nodes[i];
                if (!m) continue;
                if (isUserMes(m)) continue;
                return m;
            }
            return null;
        };

        const getStExpressionSrc = (m) => {
            if (!m) return "";
            const sel = [
                "img.mes_img",
                "img.mes-img",
                ".mes_img img",
                ".mes-img img",
                "img.expression",
                "img[class*='expression']",
                "img[alt*='expression' i]",
                "img[src*='/characters/' i]",
                "img[src*='characters' i]"
            ];
            for (const q of sel) {
                const el = m.querySelector?.(q);
                const src = readImgSrc(el);
                if (src) return src;
            }
            const bgNodes = m.querySelectorAll?.(".mes_img, .mes-img, .mes-avatar, .mes_avatar, .avatar") || [];
            for (const el of bgNodes) {
                const bg = readBgUrl(el);
                if (bg) return bg;
            }
            const anyImg = m.querySelectorAll?.("img") || [];
            for (const el of anyImg) {
                const src = readImgSrc(el);
                if (!src) continue;
                if (/data:image\//i.test(src)) return src;
                if (/characters/i.test(src)) return src;
            }
            return "";
        };

        const extSrc = findExpressionViaExtensionUi();
        if (extSrc) {
            img.src = extSrc;
            img.style.display = "block";
            return;
        }

        const mes = findMesForSpeaker();
        const src = getStExpressionSrc(mes);
        if (src) {
            img.src = src;
            img.style.display = "block";
            return;
        }

        img.style.display = "none";
    }

    triggerShake() {
        const st = document.getElementById("reality-stage");
        if (!st) return;
        st.classList.remove("re-shake");
        void st.offsetWidth;
        st.classList.add("re-shake");
        setTimeout(() => { try { st.classList.remove("re-shake"); } catch (_) {} }, 520);
    }

    ensureAudioEl() {
        if (this.audio.el) return this.audio.el;
        const a = document.createElement("audio");
        a.preload = "auto";
        a.volume = 0.8;
        a.style.display = "none";
        document.body.appendChild(a);
        this.audio.el = a;
        return a;
    }

    playSound(tag) {
        const s = getSettings();
        ensureReality(s);
        if (s.realityEngine.audio?.enabled !== true) return;
        const key = slug(tag);
        if (!key) return;
        const baseUrl = String(window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/").trim();
        const src = `${baseUrl}assets/audio/${key}.mp3`;
        const a = this.ensureAudioEl();
        a.src = src;
        a.currentTime = 0;
        a.play().catch(() => {});
    }

    updateHud() {
        const s = getSettings();
        ensureReality(s);
        const hp = Math.max(0, Number(s.hp || 0));
        const maxHp = Math.max(1, Number(s.maxHp || 1));
        const st = Math.max(0, Number(s.realityEngine.stress || 0));
        const maxSt = Math.max(1, Number(s.realityEngine.maxStress || 100));
        const hpPct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
        const stPct = Math.max(0, Math.min(100, (st / maxSt) * 100));
        const hpFill = document.getElementById("re-hp-fill");
        const stFill = document.getElementById("re-stress-fill");
        if (hpFill) hpFill.style.width = `${hpPct}%`;
        if (stFill) stFill.style.width = `${stPct}%`;
    }

    setView(view) {
        const s = getSettings();
        ensureReality(s);
        s.realityEngine.view = view === "map" ? "map" : "room";
        saveSettings();
        const canvas = document.getElementById("re-map");
        const sprite = document.getElementById("re-sprite");
        const objs = document.getElementById("re-objects");
        const bg = document.getElementById("re-bg");
        if (canvas) canvas.style.display = s.realityEngine.view === "map" ? "block" : "none";
        if (sprite) sprite.style.display = s.realityEngine.view === "map" ? "none" : (sprite.src ? "block" : "none");
        if (objs) objs.style.display = s.realityEngine.view === "map" ? "none" : "";
        if (bg) bg.style.display = s.realityEngine.view === "map" ? "none" : "";
        if (s.realityEngine.view === "map") this.ensureMap();
    }

    async ensureMap() {
        if (this.map) return this.map;
        const canvas = document.getElementById("re-map");
        if (!canvas) return null;
        const mod = await ensureMapEngine();
        if (!mod?.createMapEngine) return null;
        const locId = this.getLocationId();
        this.map = mod.createMapEngine({ canvas, seed: locId, size: 160, fogEnabled: false, fogAlpha: 255 });
        canvas.onclick = (ev) => {
            const rect = canvas.getBoundingClientRect();
            const sx = (ev.clientX - rect.left) / Math.max(1, rect.width);
            const sy = (ev.clientY - rect.top) / Math.max(1, rect.height);
            const px = sx * this.map.width;
            const py = sy * this.map.height;
            const t = this.map.hitTown(px, py);
            if (!t) return;
            this.injectTravel(t);
        };
        canvas.ontouchend = (ev) => {
            try {
                const t = ev.changedTouches?.[0];
                if (!t) return;
                const rect = canvas.getBoundingClientRect();
                const sx = (t.clientX - rect.left) / Math.max(1, rect.width);
                const sy = (t.clientY - rect.top) / Math.max(1, rect.height);
                const px = sx * this.map.width;
                const py = sy * this.map.height;
                const hit = this.map.hitTown(px, py);
                if (!hit) return;
                this.injectTravel(hit);
            } catch (_) {}
        };
        return this.map;
    }

    injectTravel(town) {
        const locId = String(town?.id || "").trim();
        if (!locId) return;
        const s = getSettings();
        ensureReality(s);
        if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
        s.worldState.location = locId;
        saveSettings();
        try { window.UIE_realityV3?.setLocation?.(locId); } catch (_) {}
        try { this.applyBackground(); } catch (_) {}
        try { notify("success", `Moved to: ${locId}`, "Reality Engine", "api"); } catch (_) {}
    }

    startTypewriter(text) {
        const el = document.getElementById("re-text");
        if (!el) return;
        if (this.typingTimer) clearInterval(this.typingTimer);
        try {
            const s = getSettings();
            ensureReality(s);
            if (s.realityEngine.ui?.vnInstant === true) {
                this.typingText = String(text || "");
                this.typingIdx = this.typingText.length;
                el.textContent = this.typingText;
                this.typingTimer = null;
                return;
            }
        } catch (_) {}
        this.typingText = String(text || "");
        this.typingIdx = 0;
        el.textContent = "";
        this.typingTimer = setInterval(() => {
            if (!el) return;
            el.textContent += this.typingText.charAt(this.typingIdx);
            this.typingIdx++;
            if (this.typingIdx >= this.typingText.length) {
                clearInterval(this.typingTimer);
                this.typingTimer = null;
            }
        }, 20);
    }

    skipTypewriter() {
        const el = document.getElementById("re-text");
        if (!el) return;
        if (this.typingTimer) {
            clearInterval(this.typingTimer);
            this.typingTimer = null;
            el.textContent = this.typingText;
        }
    }

    updateFromChat(charName, messageText) {
        const speaker = document.getElementById("re-speaker");
        if (speaker) speaker.textContent = String(charName || "Story").slice(0, 80);
        const raw = String(messageText || "");
        const clean = stripTags(raw);
        this.startTypewriter(clean);

        const mood = extractTagValue(raw, "mood");
        this.setSprite(charName, mood || "neutral");
        const vfx = extractTagValue(raw, "vfx");
        if (String(vfx).toLowerCase().includes("shake")) this.triggerShake();
        const snd = extractTagValue(raw, "sound");
        if (snd) this.playSound(snd);
        this.updateHud();
    }

    openForge() {
        const modal = document.getElementById("re-forge-modal");
        const prompt = document.getElementById("re-forge-prompt");
        const imgEl = document.getElementById("re-forge-img");
        const empty = document.getElementById("re-forge-empty");
        if (!modal || !prompt) return;
        const s = getSettings();
        ensureReality(s);
        try {
            const locId = this.getLocationId();
            const cur = String(s.realityEngine.backgrounds?.[locId] || "").trim();
            if (imgEl) {
                if (cur) {
                    imgEl.src = cur;
                    imgEl.style.display = "block";
                    if (empty) empty.style.display = "none";
                } else {
                    imgEl.style.display = "none";
                    if (empty) { empty.textContent = "No preview yet"; empty.style.display = "block"; }
                }
            }
        } catch (_) {}
        const ws = s.worldState || {};
        const hint = `Location: ${String(ws.location || "Unknown")}\nTime: ${String(ws.time || "")}\nWeather: ${String(ws.weather || "")}\n\nDescribe the scene background in detail.`;
        prompt.value = prompt.value ? String(prompt.value) : hint;
        modal.style.display = "flex";
    }

    closeForge() {
        const modal = document.getElementById("re-forge-modal");
        if (modal) modal.style.display = "none";
    }

    async forgeGenerate() {
        const prompt = document.getElementById("re-forge-prompt");
        if (!prompt) return;
        const text = String(prompt.value || "").trim();
        if (!text) return;
        const imgEl = document.getElementById("re-forge-img");
        const empty = document.getElementById("re-forge-empty");
        if (empty) empty.textContent = "Generating...";
        if (imgEl) imgEl.style.display = "none";
        let url = "";
        try {
            const mod = await import("./imageGen.js");
            url = await mod.generateImageAPI(`[UIE_LOCKED]\n${text}`);
        } catch (_) {
            url = "";
        }
        if (!url) {
            if (empty) empty.textContent = "Generation failed";
            return;
        }
        if (imgEl) {
            imgEl.src = url;
            imgEl.style.display = "block";
        }
        if (empty) empty.style.display = "none";
        const s = getSettings();
        ensureReality(s);
        s.realityEngine._pendingBg = url;
        saveSettings();
    }

    forgeBind() {
        const s = getSettings();
        ensureReality(s);
        const locId = this.getLocationId();
        const url = String(s.realityEngine._pendingBg || "").trim();
        if (!url) {
            try { notify("info", "Generate a preview first, then Save/Bind.", "World Forge", "api"); } catch (_) {}
            return;
        }
        s.realityEngine.backgrounds[locId] = url;
        delete s.realityEngine._pendingBg;
        try { window.UIE_realityV3?.setBackground?.(locId, url); } catch (_) {}
        saveSettings();
        this.applyBackground();
        this.closeForge();
        try { notify("success", "Background bound to this location.", "World Forge", "api"); } catch (_) {}
    }

    bindUi() {
        if (reBound) return;
        reBound = true;
        $(document).off(".realityEngine");
        const actGate = (() => {
            const last = new Map();
            return (key, ms = 450) => {
                const k = String(key || "");
                const now = Date.now();
                const prev = Number(last.get(k) || 0);
                if (now - prev < ms) return false;
                last.set(k, now);
                return true;
            };
        })();

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-vn-box", (e) => {
            if (!actGate("vnbox")) return;
            e.preventDefault();
            e.stopPropagation();
            this.skipTypewriter();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-exit", (e) => {
            if (!actGate("exit")) return;
            e.preventDefault();
            e.stopPropagation();
            const s = getSettings();
            ensureReality(s);
            s.realityEngine.enabled = false;
            saveSettings();
            setStageEnabled(false);
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-toggle-view", (e) => {
            if (!actGate("toggleview")) return;
            e.preventDefault();
            e.stopPropagation();
            const s = getSettings();
            ensureReality(s);
            const next = s.realityEngine.view === "map" ? "room" : "map";
            this.setView(next);
        });

        const stEls = () => ({
            ta:
                document.querySelector("textarea#send_textarea") ||
                document.querySelector("textarea#send_text") ||
                document.querySelector("textarea"),
            send:
                document.querySelector("#send_but") ||
                document.querySelector("[data-testid='send']"),
            regen:
                document.querySelector("#regenerate_but") ||
                document.querySelector("#regenerate") ||
                document.querySelector("[data-testid='regenerate']"),
            cont:
                document.querySelector("#continue_but") ||
                document.querySelector("#continue") ||
                document.querySelector("[data-testid='continue']"),
            imp:
                document.querySelector("#impersonate_but") ||
                document.querySelector("#impersonate"),
            stop:
                document.querySelector("#stop_but") ||
                document.querySelector("#stop")
        });

        const proxySend = () => {
            const ui = document.getElementById("re-user-input");
            if (!ui) return;
            const t = String(ui.value || "").trim();
            const els = stEls();
            if (els.ta) {
                els.ta.value = t;
                els.ta.dispatchEvent(new Event("input", { bubbles: true }));
                els.ta.dispatchEvent(new Event("change", { bubbles: true }));
            }
            if (els.send) els.send.click();
            ui.value = "";
        };

        const stMenu = {
            btn() {
                const selectors = [
                    "#options_button",
                    "#options_button_sheld",
                    "#chat_options_button",
                    "#chat_options",
                    "#options",
                    "#three_dots",
                    "button[title*='menu' i]",
                    "button[aria-label*='menu' i]",
                    "button[title*='options' i]",
                    "button[aria-label*='options' i]",
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) return el;
                }
                return null;
            },
            findMenuRoot() {
                const candidates = [
                    "#optionsMenu",
                    "#options_menu",
                    "#options-panel",
                    "#options_panel",
                    ".context-menu",
                    ".contextmenu",
                    ".dropdown-menu.show",
                    ".dropdown-menu",
                    ".menu",
                    ".popup"
                ];
                for (const sel of candidates) {
                    const el = document.querySelector(sel);
                    if (!el) continue;
                    const st = window.getComputedStyle(el);
                    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;
                    return el;
                }
                return null;
            },
            openNearWand() {
                const b = this.btn();
                if (b) b.click();
                setTimeout(() => {
                    const m = this.findMenuRoot();
                    if (!m) return;
                    try { m.style.zIndex = "2147483647"; m.style.position = "fixed"; } catch (_) {}
                    try {
                        const wand = document.getElementById("re-q-menu");
                        const r = wand?.getBoundingClientRect?.();
                        if (!r) return;
                        const pad = 8;
                        const w = Math.min(360, Math.max(240, m.getBoundingClientRect().width || 300));
                        const h = Math.min(520, Math.max(240, m.getBoundingClientRect().height || 320));
                        const left = Math.max(pad, Math.min(window.innerWidth - w - pad, r.left));
                        const top = Math.max(pad, Math.min(window.innerHeight - h - pad, r.bottom + 6));
                        m.style.left = `${left}px`;
                        m.style.top = `${top}px`;
                    } catch (_) {}
                }, 0);
            },
            clickItem(textRe) {
                const root = this.findMenuRoot();
                if (!root) return false;
                const els = root.querySelectorAll("button, a, div, li, span");
                for (const el of els) {
                    const t = String(el.textContent || "").trim();
                    if (!t) continue;
                    if (!textRe.test(t)) continue;
                    el.click();
                    return true;
                }
                return false;
            }
        };

        $(document).on("keydown.realityEngine", "#re-user-input", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                proxySend();
            }
        });

        $(document).on("pointerup.realityEngine", "#re-q-send", (e) => {
            e.preventDefault();
            e.stopPropagation();
            proxySend();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-q-menu", (e) => {
            if (!actGate("qmenu")) return;
            e.preventDefault();
            e.stopPropagation();
            const m = document.getElementById("re-st-menu");
            if (!m) return;
            const open = m.style.display !== "flex";
            if (!open) { m.style.display = "none"; return; }
            m.style.display = "flex";
            try {
                const btn = document.getElementById("re-q-menu");
                const r = btn?.getBoundingClientRect?.();
                if (r) {
                    const pad = 8;
                    const w = Math.min(320, Math.max(240, m.getBoundingClientRect().width || 280));
                    const left = Math.max(pad, Math.min(window.innerWidth - w - pad, r.right - w));
                    const top = Math.max(pad, Math.min(window.innerHeight - 220 - pad, r.top - 6));
                    m.style.left = `${left}px`;
                    m.style.top = `${top}px`;
                }
            } catch (_) {}
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-composer-wrap", (e) => {
            if ($(e.target).closest("#re-st-menu, #re-q-menu").length) return;
            const m = document.getElementById("re-st-menu");
            if (m && m.style.display === "flex") m.style.display = "none";
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-regenerate", (e) => {
            if (!actGate("regen")) return;
            e.preventDefault();
            e.stopPropagation();
            const els = stEls();
            if (els.regen) els.regen.click();
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-continue", (e) => {
            if (!actGate("cont")) return;
            e.preventDefault();
            e.stopPropagation();
            const els = stEls();
            if (els.cont) els.cont.click();
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-impersonate", (e) => {
            if (!actGate("imp")) return;
            e.preventDefault();
            e.stopPropagation();
            const els = stEls();
            if (els.imp) els.imp.click();
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-stop", (e) => {
            if (!actGate("stop")) return;
            e.preventDefault();
            e.stopPropagation();
            const els = stEls();
            if (els.stop) els.stop.click();
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-forge", (e) => {
            if (!actGate("actforge")) return;
            e.preventDefault();
            e.stopPropagation();
            this.openForge();
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-toggle-map", (e) => {
            if (!actGate("actmap")) return;
            e.preventDefault();
            e.stopPropagation();
            const s = getSettings();
            ensureReality(s);
            const next = s.realityEngine.view === "map" ? "room" : "map";
            this.setView(next);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });

        const clickStOption = (re) => {
            try { stMenu.openNearWand(); } catch (_) {}
            setTimeout(() => { try { stMenu.clickItem(re); } catch (_) {} }, 20);
        };
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-st-menu", (e) => {
            if (!actGate("stmenu")) return;
            e.preventDefault();
            e.stopPropagation();
            try { stMenu.openNearWand(); } catch (_) {}
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-author", (e) => {
            if (!actGate("author")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/author'?s\s+note/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-cfg", (e) => {
            if (!actGate("cfg")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/cfg\s*scale/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-tokens", (e) => {
            if (!actGate("tokens")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/token\s+probabilities/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-newchat", (e) => {
            if (!actGate("newchat")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/start\s+new\s+chat|new\s+chat/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-manage", (e) => {
            if (!actGate("manage")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/manage\s+chat\s+files|chat\s+files/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-delete", (e) => {
            if (!actGate("delete")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/delete\s+messages/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });
        $(document).on("pointerup.realityEngine click.realityEngine", "#re-act-closechat", (e) => {
            if (!actGate("closechat")) return;
            e.preventDefault(); e.stopPropagation();
            clickStOption(/close\s+chat/i);
            const m = document.getElementById("re-st-menu");
            if (m) m.style.display = "none";
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-forge-btn", (e) => {
            if (!actGate("forgebtn")) return;
            e.preventDefault();
            e.stopPropagation();
            this.openForge();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-forge-close", (e) => {
            if (!actGate("forgeclose")) return;
            e.preventDefault();
            e.stopPropagation();
            this.closeForge();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-forge-modal", (e) => {
            if ($(e.target).closest("#re-forge-card").length) return;
            this.closeForge();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-forge-generate", async (e) => {
            if (!actGate("forgegen", 900)) return;
            e.preventDefault();
            e.stopPropagation();
            await this.forgeGenerate();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-forge-bind", (e) => {
            if (!actGate("forgebind")) return;
            e.preventDefault();
            e.stopPropagation();
            this.forgeBind();
        });

        $(document).on("pointerup.realityEngine", "#re-phone, #re-journal, #re-q-phone, #re-q-journal", (e) => {
            e.preventDefault();
            e.stopPropagation();
        });

        $(document).on("pointerup.realityEngine click.realityEngine", "#re-q-chatbox", (e) => {
            if (!actGate("qchatbox")) return;
            e.preventDefault();
            e.stopPropagation();
            try {
                const open = () => {
                    if (window.UIE_forceOpenWindow) window.UIE_forceOpenWindow("#uie-chatbox-window", "./chatbox.js", "openChatbox");
                    else document.getElementById("uie-btn-chatbox")?.click?.();
                };
                if (document.getElementById("uie-chatbox-window")) return open();
                const baseUrl = String(window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/").trim();
                import("./templateFetch.js").then(async (m) => {
                    const fetchTemplateHtml = m?.fetchTemplateHtml;
                    if (typeof fetchTemplateHtml !== "function") return open();
                    let html = "";
                    const urls = [
                        `${baseUrl}src/templates/chatbox.html`,
                        `/scripts/extensions/third-party/universal-immersion-engine/src/templates/chatbox.html`
                    ];
                    for (const u of urls) {
                        try {
                            html = await fetchTemplateHtml(u);
                            if (html) break;
                        } catch (_) {}
                    }
                    if (html) $("body").append(html);
                    open();
                }).catch(() => open());
            } catch (_) {}
        });
    }

    startChatObserver() {
        const chat = document.getElementById("chat");
        if (!chat) return;
        if (reObserver) reObserver.disconnect();
        let t = 0;
        reObserver = new MutationObserver(() => {
            const s = getSettings();
            ensureReality(s);
            if (s.realityEngine.enabled !== true) return;
            if (t) clearTimeout(t);
            t = setTimeout(() => {
                const last = readLastChatMessage();
                if (!last) return;
                const sig = hash(`${last.name}::${last.text}`.slice(-1600));
                if (sig === reLastSig) return;
                reLastSig = sig;
                this.updateFromChat(last.name, last.text);
            }, 900);
        });
        reObserver.observe(chat, { childList: true, subtree: true });
    }

    syncEnabled() {
        const s = getSettings();
        ensureReality(s);
        if (s.realityEngine.comingSoon === true) {
            if (s.realityEngine.enabled) {
                s.realityEngine.enabled = false;
                saveSettings();
            }
            setStageEnabled(false);
            this.closeForge();
            return;
        }
        setStageEnabled(s.realityEngine.enabled === true);
        if (s.realityEngine.enabled) {
            this.applyBackground();
            this.bindUi();
            this.updateHud();
            this.setView(s.realityEngine.view);
            this.startChatObserver();
            try {
                ensureRealityV3().then((eng) => {
                    if (!eng) return;
                    try { eng.ensureLocationFromWorldState(); } catch (_) {}
                });
            } catch (_) {}
            try {
                const q = document.getElementById("re-quick");
                if (q) q.style.display = s.realityEngine.ui?.showQuickButtons === false ? "none" : "flex";
            } catch (_) {}
            try {
                const hud = document.getElementById("re-hud");
                if (hud) hud.style.display = s.realityEngine.ui?.showHud === false ? "none" : "flex";
            } catch (_) {}
            const last = readLastChatMessage();
            if (last) this.updateFromChat(last.name, last.text);
        } else {
            this.closeForge();
        }
    }
}

export function initWorld() {
    const s = getSettings();
    $("#uie-world-id").text(s.worldSimId || "WAITING...");
    try {
        ensureReality(s);
        s.realityEngine.comingSoon = true;
        s.realityEngine.enabled = false;
        saveSettings();
        setStageEnabled(false);
    } catch (_) {}

    $(document).off("click.world");

    const render = () => {
        const s2 = getSettings();
        try { ensureReality(s2); } catch (_) {}
        if (s2?.realityEngine?.comingSoon === true) {
            $("#uie-world-content").html(`
                <div style="display:flex; flex-direction:column; gap:14px; padding: 10px 0;">
                    <div style="font-weight:900; font-size:18px; color:#cba35c;">REALITY ENGINE</div>
                    <div style="opacity:0.8; font-size:13px; line-height:1.4;">
                        Coming soon. Your current build is paused while we stabilize VN mode + asset pipeline.
                    </div>
                    <div style="opacity:0.65; font-size:12px;">
                        UIE will keep your normal tools working. Reality Stage is disabled for now.
                    </div>
                </div>
            `);
            try { setStageEnabled(false); } catch (_) {}
            return;
        }
        const ws = s2?.worldState || {};
        const loc = String(ws.location || "Unknown");
        const time = String(ws.time || "Day");
        const weather = String(ws.weather || "Clear");
        const threat = String(ws.threat || "None");
        const status = String(ws.status || "Normal");
        $("#uie-world-content").html(`
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div style="font-weight:900; color:#cba35c;">World State</div>
                <div style="display:grid; grid-template-columns: 140px 1fr; gap:8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size:12px;">
                    <div style="opacity:0.75;">Location</div><div style="font-weight:900;">${loc}</div>
                    <div style="opacity:0.75;">Time</div><div style="font-weight:900;">${time}</div>
                    <div style="opacity:0.75;">Weather</div><div style="font-weight:900;">${weather}</div>
                    <div style="opacity:0.75;">Threat</div><div style="font-weight:900;">${threat}</div>
                    <div style="opacity:0.75;">Status</div><div style="font-weight:900;">${status}</div>
                </div>
                <div style="opacity:0.75; font-size:12px;">
                    Updates automatically from chat when AI automation is on. Use refresh to scan immediately.
                </div>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button id="uie-world-toggle-re" style="height:44px; padding:0 14px; border-radius:14px; border:1px solid rgba(203,163,92,0.35); background:rgba(0,0,0,0.25); color:#cba35c; font-weight:900; cursor:pointer;">Projector</button>
                    <button id="uie-world-toggle-room" style="height:44px; padding:0 14px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.18); color:#fff; font-weight:900; cursor:pointer;">Room</button>
                    <button id="uie-world-toggle-map" style="height:44px; padding:0 14px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.18); color:#fff; font-weight:900; cursor:pointer;">Map</button>
                </div>
                <label style="display:flex; gap:10px; align-items:center; font-weight:900; color:#fff;">
                    <input type="checkbox" id="uie-world-hide-quick">
                    Hide quick buttons (Phone/Journal/Chatbox/Menu)
                </label>
                <label style="display:flex; gap:10px; align-items:center; font-weight:900; color:#fff;">
                    <input type="checkbox" id="uie-world-hide-hud">
                    Hide HUD (HP/Stress bars)
                </label>
                <label style="display:flex; gap:10px; align-items:center; font-weight:900; color:#fff;">
                    <input type="checkbox" id="uie-world-show-st-ui">
                    Show SillyTavern UI behind stage
                </label>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button id="uie-world-open-sprites" style="height:44px; padding:0 14px; border-radius:14px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">Sprite Library</button>
                </div>
            </div>
        `);
        try {
            const s3 = getSettings();
            ensureReality(s3);
            $("#uie-world-toggle-re").text(s3.realityEngine.enabled ? "Projector: ON" : "Projector: OFF");
            $("#uie-world-hide-quick").prop("checked", s3.realityEngine.ui?.showQuickButtons === false);
            $("#uie-world-hide-hud").prop("checked", s3.realityEngine.ui?.showHud === false);
            $("#uie-world-show-st-ui").prop("checked", s3.realityEngine.ui?.hideStUi === false);
        } catch (_) {}
    };

    render();
    if (!reEngine) reEngine = new RealityEngine();
    try { reEngine.syncEnabled(); } catch (_) {}

    let worldGenGateAt = 0;
    $(document).on("pointerup.world click.world", "#uie-world-gen", async (e) => {
        const now = Date.now();
        if (now - worldGenGateAt < 500) return;
        worldGenGateAt = now;
        e.preventDefault();
        e.stopPropagation();
        const input = String($("#uie-world-input").val() || "").trim();
        if(!input) return;
        
        const s = getSettings();
        s.worldSimId = input.toUpperCase().substring(0, 15);
        $("#uie-world-id").text(s.worldSimId);
        if (!s.worldState || typeof s.worldState !== "object") s.worldState = {};
        s.worldState.location = input.slice(0, 80);
        saveSettings();
        render();
        try {
            const eng = await ensureRealityV3();
            if (eng) {
                eng.ensureLocationFromWorldState();
                eng.ensureBackgroundOrRequest();
            }
        } catch (_) {}
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $(document).on("click.world", "#uie-world-update", async () => {
        const btn = $("#uie-world-update");
        btn.addClass("fa-spin");
        try {
            await scanEverything();
            render();
        } catch(e) {}
        finally { btn.removeClass("fa-spin"); }
    });

    $(document).on("click.world", "#uie-world-projector, #uie-world-toggle-re", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        if (s2.realityEngine.comingSoon === true) {
            try { notify("info", "Reality Engine is Coming Soon in this build.", "Reality Engine", "api"); } catch (_) {}
            s2.realityEngine.enabled = false;
            saveSettings();
            try { setStageEnabled(false); } catch (_) {}
            render();
            return;
        }
        s2.realityEngine.enabled = !s2.realityEngine.enabled;
        saveSettings();
        render();
        try { reEngine.syncEnabled(); } catch (_) {}
        if (s2.realityEngine.enabled) {
            try { notify("success", "Reality Stage enabled.", "Reality Engine", "api"); } catch (_) {}
        } else {
            try { notify("info", "Reality Stage disabled.", "Reality Engine", "api"); } catch (_) {}
        }
    });

    $(document).on("click.world", "#uie-world-toggle-room", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        if (s2.realityEngine.comingSoon === true) return;
        s2.realityEngine.view = "room";
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $(document).on("click.world", "#uie-world-toggle-map", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s2 = getSettings();
        ensureReality(s2);
        if (s2.realityEngine.comingSoon === true) return;
        s2.realityEngine.view = "map";
        if (s2.realityEngine.enabled !== true) s2.realityEngine.enabled = true;
        saveSettings();
        render();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $(document).on("change.world", "#uie-world-hide-quick", (e) => {
        const s2 = getSettings();
        ensureReality(s2);
        s2.realityEngine.ui.showQuickButtons = !($("#uie-world-hide-quick").prop("checked") === true);
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $(document).on("change.world", "#uie-world-hide-hud", (e) => {
        const s2 = getSettings();
        ensureReality(s2);
        s2.realityEngine.ui.showHud = !($("#uie-world-hide-hud").prop("checked") === true);
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $(document).on("change.world", "#uie-world-show-st-ui", (e) => {
        const s2 = getSettings();
        ensureReality(s2);
        s2.realityEngine.ui.hideStUi = !($("#uie-world-show-st-ui").prop("checked") === true);
        saveSettings();
        try { reEngine.syncEnabled(); } catch (_) {}
    });

    $(document).on("click.world", "#uie-world-open-sprites", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
            if (!document.getElementById("uie-sprites-window")) {
                const baseUrl = String(window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/").trim();
                const mod = await import("./templateFetch.js");
                const fetchTemplateHtml = mod?.fetchTemplateHtml;
                if (typeof fetchTemplateHtml === "function") {
                    let html = "";
                    for (const u of [`${baseUrl}src/templates/sprites.html`, `/scripts/extensions/third-party/universal-immersion-engine/src/templates/sprites.html`]) {
                        try { html = await fetchTemplateHtml(u); if (html) break; } catch (_) {}
                    }
                    if (html) $("body").append(html);
                }
            }
            if (window.UIE_forceOpenWindow) window.UIE_forceOpenWindow("#uie-sprites-window", "./sprites.js", "openSprites");
        } catch (_) {}
    });
}
