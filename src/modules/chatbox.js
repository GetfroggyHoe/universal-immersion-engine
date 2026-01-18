import { getSettings, saveSettings } from "./core.js";
import { notify } from "./notifications.js";

let bound = false;
let observer = null;
let cache = [];
let renderedCount = 0;
let portalState = null;
let pendingGen = null;

const THEMES = {
    visual_novel: {
        label: "Visual Novel",
        vars: {
            "--cb-bg": "rgba(10,6,5,0.82)",
            "--cb-card": "rgba(0,0,0,0.25)",
            "--cb-border": "rgba(203,163,92,0.45)",
            "--cb-accent": "#cd7f32",
            "--cb-text": "rgba(255,255,255,0.90)",
            "--cb-muted": "rgba(255,255,255,0.65)"
        }
    },
    rpg: {
        label: "RPG",
        vars: {
            "--cb-bg": "rgba(12,14,20,0.84)",
            "--cb-card": "rgba(0,0,0,0.28)",
            "--cb-border": "rgba(241,196,15,0.35)",
            "--cb-accent": "#f1c40f",
            "--cb-text": "rgba(255,255,255,0.92)",
            "--cb-muted": "rgba(255,255,255,0.68)"
        }
    },
    magic_shop: {
        label: "Magic Shop",
        vars: {
            "--cb-bg": "rgba(15,10,18,0.86)",
            "--cb-card": "rgba(0,0,0,0.22)",
            "--cb-border": "rgba(137,180,250,0.35)",
            "--cb-accent": "#89b4fa",
            "--cb-text": "rgba(255,255,255,0.92)",
            "--cb-muted": "rgba(255,255,255,0.68)"
        }
    },
    classroom: {
        label: "Classroom",
        vars: {
            "--cb-bg": "rgba(12,18,16,0.82)",
            "--cb-card": "rgba(255,255,255,0.08)",
            "--cb-border": "rgba(148,214,178,0.35)",
            "--cb-accent": "#94d6b2",
            "--cb-text": "rgba(255,255,255,0.92)",
            "--cb-muted": "rgba(255,255,255,0.68)"
        }
    }
};

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function stripTags(text) {
    return String(text || "").replace(/\[[^\]]*?\]/g, "").trim();
}

function extractTagValue(text, key) {
    const re = new RegExp(`\\[\\s*${key}\\s*:\\s*([^\\]]+)\\]`, "ig");
    let out = [];
    let m = null;
    while ((m = re.exec(String(text || ""))) !== null) out.push(String(m[1] || "").trim());
    out = out.filter(Boolean);
    return out.length ? out[out.length - 1] : "";
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

function readMesText(m) {
    try {
        const el =
            m.querySelector?.(".mes_text") ||
            m.querySelector?.(".mes-text") ||
            null;
        if (!el) return "";
        const clone = el.cloneNode(true);
        try {
            clone.querySelectorAll?.("style, script, noscript, template, button, input, textarea").forEach(n => n.remove());
        } catch (_) {}
        const txt = (clone.innerText != null ? clone.innerText : clone.textContent) || "";
        return stripCssBlocks(txt);
    } catch (_) {
        return "";
    }
}

function getChatNodes() {
    try {
        const chat = document.getElementById("chat");
        if (!chat) return [];
        return Array.from(chat.querySelectorAll(".mes"));
    } catch (_) {
        return [];
    }
}

function getMsgFromNode(m) {
    try {
        const isUser =
            m.classList?.contains("is_user") ||
            m.getAttribute?.("is_user") === "true" ||
            m.getAttribute?.("data-is-user") === "true" ||
            m.dataset?.isUser === "true";
        const name =
            m.querySelector?.(".mes_name")?.textContent ||
            m.querySelector?.(".name_text")?.textContent ||
            m.querySelector?.(".name")?.textContent ||
            m.getAttribute?.("ch_name") ||
            m.getAttribute?.("data-name") ||
            m.dataset?.name ||
            "";
        const txt = readMesText(m);
        const id =
            m.dataset?.mesId ||
            m.getAttribute?.("mesid") ||
            m.id ||
            "";
        const raw = String(txt || "").trim();
        return {
            id: String(id || ""),
            isUser: !!isUser,
            name: String(name || "").trim() || (isUser ? "You" : "Story"),
            raw,
            clean: stripTags(raw),
            mood: extractTagValue(raw, "mood"),
            sound: extractTagValue(raw, "sound"),
            ts: Date.now()
        };
    } catch (_) {
        return null;
    }
}

function ensureChatboxSettings(s) {
    if (!s.chatbox || typeof s.chatbox !== "object") s.chatbox = {};
    if (typeof s.chatbox.theme !== "string") s.chatbox.theme = "visual_novel";
    if (!Number.isFinite(Number(s.chatbox.textScale))) s.chatbox.textScale = 1.0;
    if (typeof s.chatbox.highContrast !== "boolean") s.chatbox.highContrast = false;
    if (typeof s.chatbox.bgUrl !== "string") s.chatbox.bgUrl = "";
}

function applyTheme() {
    const s = getSettings();
    ensureChatboxSettings(s);
    const themeKey = String(s.chatbox.theme || "visual_novel");
    const theme = THEMES[themeKey] || THEMES.visual_novel;
    const w = document.getElementById("uie-chatbox-window");
    if (!w) return;
    const vars = theme.vars || {};
    for (const [k, v] of Object.entries(vars)) w.style.setProperty(k, String(v));
    w.style.transition = "background-color 220ms ease, border-color 220ms ease, color 220ms ease";
    w.style.background = `var(--cb-bg, rgba(0,0,0,0.72))`;
    w.style.borderColor = `var(--cb-border, rgba(203,163,92,0.45))`;
    w.style.color = `var(--cb-text, rgba(255,255,255,0.92))`;
    w.style.fontSize = `${Math.max(0.75, Math.min(1.6, Number(s.chatbox.textScale || 1))) * 100}%`;
    w.style.filter = s.chatbox.highContrast ? "contrast(1.12) saturate(1.05)" : "";
    const bg = String(s.chatbox.bgUrl || "").trim();
    if (bg) {
        w.style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.60), rgba(0,0,0,0.78)), url("${bg}")`;
        w.style.backgroundSize = "cover";
        w.style.backgroundPosition = "center";
    } else {
        w.style.backgroundImage = "";
    }
    try { $("#uie-chatbox-theme").val(themeKey); } catch (_) {}
}

function showBanner(text) {
    const el = document.getElementById("uie-chatbox-banner");
    if (!el) return;
    el.textContent = String(text || "").slice(0, 240);
    el.style.display = text ? "block" : "none";
}

function clearBanner() {
    showBanner("");
}

function renderList({ reset } = {}) {
    const list = document.getElementById("uie-chatbox-list");
    if (!list) return;
    if (reset) list.innerHTML = "";
    const q = String(document.getElementById("uie-chatbox-search")?.value || "").trim().toLowerCase();
    const max = 120;
    const start = Math.max(0, cache.length - max);
    const items = cache.slice(start);
    const filtered = q
        ? items.filter(m => (String(m.name).toLowerCase().includes(q) || String(m.clean).toLowerCase().includes(q) || String(m.raw).toLowerCase().includes(q)))
        : items;
    const frag = document.createDocumentFragment();
    for (const m of filtered) {
        const card = document.createElement("div");
        card.style.cssText = `border-radius:16px;border:1px solid rgba(255,255,255,0.10);background:var(--cb-card, rgba(0,0,0,0.25));padding:10px 12px;display:flex;gap:10px;`;
        card.dataset.msgId = m.id || "";
        const badge = document.createElement("div");
        badge.style.cssText = `width:42px;height:42px;border-radius:14px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.18);display:grid;place-items:center;flex:0 0 auto;color:var(--cb-accent,#cd7f32);font-weight:900;`;
        badge.textContent = m.isUser ? "YOU" : "NPC";
        const body = document.createElement("div");
        body.style.cssText = "flex:1;min-width:0;";
        const head = document.createElement("div");
        head.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
        head.innerHTML = `<div style="font-weight:900;color:var(--cb-accent,#cd7f32);">${esc(m.name)}</div>${m.mood ? `<div style="opacity:0.75;font-size:11px;border:1px solid rgba(255,255,255,0.14);padding:2px 8px;border-radius:999px;">${esc(m.mood)}</div>` : ""}`;
        const text = document.createElement("div");
        text.style.cssText = "margin-top:6px;white-space:pre-wrap;word-break:break-word;color:var(--cb-text, rgba(255,255,255,0.92));opacity:0.95;";
        text.textContent = m.clean || m.raw || "";
        body.appendChild(head);
        body.appendChild(text);
        card.appendChild(badge);
        card.appendChild(body);
        frag.appendChild(card);
    }
    list.innerHTML = "";
    list.appendChild(frag);
    renderedCount = filtered.length;
}

function refreshCache() {
    const nodes = getChatNodes();
    const msgs = [];
    for (const n of nodes) {
        const m = getMsgFromNode(n);
        if (!m) continue;
        if (!m.raw) continue;
        msgs.push(m);
    }
    cache = msgs.slice(-800);
}

function findComposerRoot() {
    const candidates = [
        "#send_form",
        "#form_sheld",
        "#message_form",
        "#send_form_sheld",
    ];
    for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el) return el;
    }
    const ta =
        document.querySelector("textarea#send_textarea") ||
        document.querySelector("textarea#send_text") ||
        document.querySelector("textarea");
    if (!ta) return null;
    return ta.closest("form") || ta.closest("div") || ta.parentElement;
}

function portalComposerIntoChatbox() {
    const host = document.getElementById("uie-chatbox-composer");
    if (!host) return;
    if (portalState) return;

    const root = findComposerRoot();
    if (!root) {
        host.innerHTML = `<div style="opacity:0.75; font-weight:900;">Composer not found. (SillyTavern DOM changed?)</div>`;
        return;
    }
    portalState = {
        root,
        parent: root.parentElement,
        next: root.nextSibling,
        placeholder: document.createElement("div"),
        hidden: []
    };
    portalState.placeholder.id = "uie-chatbox-composer-placeholder";
    try {
        portalState.parent.insertBefore(portalState.placeholder, portalState.next);
    } catch (_) {}

    try {
        host.appendChild(root);
        root.style.width = "100%";
    } catch (_) {}
    try { document.body.dataset.uieChatbox = "1"; } catch (_) {}
    hideComposerExtras(root);
}

function restoreComposer() {
    if (!portalState) return;
    const { root, parent, next, placeholder } = portalState;
    try {
        for (const it of (portalState.hidden || [])) {
            if (!it?.el) continue;
            it.el.style.display = it.prevDisplay;
            it.el.style.visibility = it.prevVisibility;
        }
    } catch (_) {}
    try {
        if (parent) parent.insertBefore(root, next || null);
    } catch (_) {}
    try { placeholder?.remove?.(); } catch (_) {}
    portalState = null;
    try { delete document.body.dataset.uieChatbox; } catch (_) {}
}

function hideComposerExtras(root) {
    const allowIds = new Set(["send_but", "regenerate_but", "continue_but", "continue", "regenerate", "stop_but", "stop", "option_continue", "option_regenerate"]);
    const markHidden = (el) => {
        if (!el || el.nodeType !== 1) return;
        const id = String(el.id || "").trim();
        if (id && allowIds.has(id)) return;
        if (portalState?.hidden?.some(x => x?.el === el)) return;
        const prevDisplay = el.style.display;
        const prevVisibility = el.style.visibility;
        el.style.display = "none";
        el.style.visibility = "hidden";
        portalState?.hidden?.push?.({ el, prevDisplay, prevVisibility });
    };

    try {
        const icons = root.querySelectorAll(".fa-wand-magic-sparkles, .fa-bars, .fa-ellipsis, .fa-ellipsis-vertical, .fa-grip-lines, .fa-grip-lines-vertical");
        icons.forEach((ic) => {
            const btn = ic.closest("button, a, div");
            if (!btn) return;
            const id = String(btn.id || "").trim();
            if (id && allowIds.has(id)) return;
            markHidden(btn);
        });
    } catch (_) {}

    try {
        const btns = root.querySelectorAll("button, a, div");
        btns.forEach((el) => {
            const id = String(el.id || "").trim().toLowerCase();
            const aria = String(el.getAttribute?.("aria-label") || "").trim().toLowerCase();
            const title = String(el.getAttribute?.("title") || "").trim().toLowerCase();
            if (id && allowIds.has(id)) return;
            if (id && (id.includes("menu") || id.includes("options") || id.includes("wand"))) markHidden(el);
            else if (aria && (aria.includes("menu") || aria.includes("options"))) markHidden(el);
            else if (title && (title.includes("menu") || title.includes("options"))) markHidden(el);
        });
    } catch (_) {}
}

function startGenWatch(reason) {
    const nodes = getChatNodes();
    const last = nodes[nodes.length - 1];
    const prevSig = last ? hash(String(last.textContent || "").slice(-1800)) : "";
    pendingGen = { at: Date.now(), reason: String(reason || ""), prevSig, done: false };
    clearBanner();
    setTimeout(() => {
        if (!pendingGen || pendingGen.done) return;
        const now = Date.now();
        if (now - pendingGen.at < 42000) return;
        showBanner("Generation may have failed or timed out. Try Regenerate or check the API connection.");
    }, 46000);
}

function markGenDoneIfAny() {
    if (!pendingGen) return;
    const nodes = getChatNodes();
    const last = nodes[nodes.length - 1];
    const sig = last ? hash(String(last.textContent || "").slice(-1800)) : "";
    if (sig && sig !== pendingGen.prevSig) {
        pendingGen.done = true;
        pendingGen = null;
        clearBanner();
    }
}

function playSoundFromMsg(msg) {
    const tag = String(msg?.sound || "").trim();
    if (!tag) return;
    const key = tag.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
    if (!key) return;
    const baseUrl = String(window.UIE_BASEURL || "/scripts/extensions/third-party/universal-immersion-engine/").trim();
    const src = `${baseUrl}assets/audio/${key}.mp3`;
    try {
        const a = (window.UIE_chatboxAudio = window.UIE_chatboxAudio || new Audio());
        a.src = src;
        a.currentTime = 0;
        a.volume = 0.85;
        a.play().catch(() => {});
    } catch (_) {}
}

function bindObserver() {
    const chat = document.getElementById("chat");
    if (!chat) return;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
        refreshCache();
        renderList();
        markGenDoneIfAny();
        const last = cache[cache.length - 1];
        if (last?.sound) playSoundFromMsg(last);
    });
    observer.observe(chat, { childList: true, subtree: true });
}

export function initChatbox() {
    if (bound) return;
    bound = true;

    $(document).off(".uieChatbox");

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        restoreComposer();
        $("#uie-chatbox-window").hide();
        $("#uie-chatbox-options").hide();
        clearBanner();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-gear", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const o = $("#uie-chatbox-options");
        o.css("display", o.is(":visible") ? "none" : "flex");
        const s = getSettings();
        ensureChatboxSettings(s);
        $("#uie-chatbox-textscale").val(String(s.chatbox.textScale || 1));
        $("#uie-chatbox-contrast").prop("checked", s.chatbox.highContrast === true);
        $("#uie-chatbox-bg").val(String(s.chatbox.bgUrl || ""));
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-options-close", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-chatbox-options").hide();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-options", function (e) {
        if ($(e.target).closest("#uie-chatbox-options > div").length) return;
        $("#uie-chatbox-options").hide();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-options-save", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureChatboxSettings(s);
        s.chatbox.textScale = Number($("#uie-chatbox-textscale").val() || 1);
        s.chatbox.highContrast = $("#uie-chatbox-contrast").prop("checked") === true;
        s.chatbox.bgUrl = String($("#uie-chatbox-bg").val() || "").trim().slice(0, 600);
        saveSettings();
        applyTheme();
        $("#uie-chatbox-options").hide();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-options-reset", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureChatboxSettings(s);
        s.chatbox.textScale = 1.0;
        s.chatbox.highContrast = false;
        s.chatbox.bgUrl = "";
        saveSettings();
        applyTheme();
        $("#uie-chatbox-textscale").val("1");
        $("#uie-chatbox-contrast").prop("checked", false);
        $("#uie-chatbox-bg").val("");
    });

    $(document).on("change.uieChatbox", "#uie-chatbox-theme", function () {
        const s = getSettings();
        ensureChatboxSettings(s);
        s.chatbox.theme = String($(this).val() || "visual_novel");
        saveSettings();
        applyTheme();
    });

    $(document).on("input.uieChatbox", "#uie-chatbox-search", function () {
        renderList();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-search-clear", function (e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-chatbox-search").val("");
        renderList();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-open-inv", function (e) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById("uie-btn-inventory")?.click?.();
    });
    $(document).on("pointerup.uieChatbox", "#uie-chatbox-open-war", function (e) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById("uie-btn-battle")?.click?.();
    });
    $(document).on("pointerup.uieChatbox", "#uie-chatbox-open-map", function (e) {
        e.preventDefault(); e.stopPropagation();
        document.getElementById("uie-btn-open-map")?.click?.();
    });

    $(document).on("pointerup.uieChatbox", "#uie-chatbox-window #send_but, #uie-chatbox-window #regenerate_but, #uie-chatbox-window #continue_but, #uie-chatbox-window #continue, #uie-chatbox-window #regenerate", function () {
        startGenWatch(this?.id || "send");
    });
}

export function openChatbox() {
    const s = getSettings();
    ensureChatboxSettings(s);
    applyTheme();
    refreshCache();
    renderList({ reset: true });
    portalComposerIntoChatbox();
    bindObserver();
    try { notify("info", "Chatbox active (SillyTavern composer moved into UIE).", "Chatbox", "api"); } catch (_) {}
}
