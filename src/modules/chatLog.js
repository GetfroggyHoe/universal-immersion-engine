import { getContext } from "../../../../../extensions.js";

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

function normName(name, isUser) {
    const n = String(name || "").trim();
    if (n) return n;
    return isUser ? "You" : "Story";
}

function normIsUser(v) {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v || "").toLowerCase().trim();
    if (s === "true") return true;
    if (s === "false") return false;
    return false;
}

async function tryImportChatArray() {
    const candidates = [
        "../../../../../../script.js",
        "/script.js",
    ];
    for (const p of candidates) {
        try {
            const mod = await import(p);
            const arr = mod?.chat;
            if (Array.isArray(arr)) return arr;
        } catch (_) {}
    }
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        if (Array.isArray(w?.chat)) return w.chat;
        if (Array.isArray(w?.SillyTavern?.chat)) return w.SillyTavern.chat;
    } catch (_) {}
    try {
        const ctx = getContext ? getContext() : null;
        if (Array.isArray(ctx?.chat)) return ctx.chat;
        if (Array.isArray(ctx?.messages)) return ctx.messages;
    } catch (_) {}
    return null;
}

function readDomMessages(maxMessages) {
    const max = Math.max(1, Number(maxMessages || 50));
    try {
        const chatEl = document.getElementById("chat");
        if (!chatEl) return [];
        const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-1 * max);
        const out = [];
        for (const m of msgs) {
            const isUser =
                m.classList?.contains("is_user") ||
                m.getAttribute?.("is_user") === "true" ||
                m.getAttribute?.("data-is-user") === "true" ||
                m.dataset?.isUser === "true";
            const name =
                m.querySelector?.(".mes_name")?.textContent ||
                m.querySelector?.(".ch_name")?.textContent ||
                m.querySelector?.(".name")?.textContent ||
                "";
            const el = m.querySelector?.(".mes_text") || m.querySelector?.(".mes-text") || null;
            let text = "";
            if (el) {
                const clone = el.cloneNode(true);
                try { clone.querySelectorAll?.("style, script, noscript, template, button, input, textarea").forEach(n => n.remove()); } catch (_) {}
                text = (clone.innerText != null ? clone.innerText : clone.textContent) || "";
            } else {
                text = String(m.textContent || "");
            }
            const clean = stripCssBlocks(String(text || "").trim());
            if (!clean) continue;
            out.push({ isUser: !!isUser, name: normName(name, !!isUser), text: clean });
        }
        return out;
    } catch (_) {
        return [];
    }
}

function readArrayMessages(arr, maxMessages) {
    const max = Math.max(1, Number(maxMessages || 50));
    const slice = Array.isArray(arr) ? arr.slice(-1 * max) : [];
    const out = [];
    for (const m of slice) {
        const isUser = normIsUser(m?.is_user ?? m?.isUser ?? m?.role === "user");
        const name = normName(m?.name ?? m?.ch_name ?? m?.speaker ?? (isUser ? "You" : "Story"), isUser);
        const text = String(m?.mes ?? m?.message ?? m?.content ?? m?.text ?? "").trim();
        const clean = stripCssBlocks(text);
        if (!clean) continue;
        out.push({ isUser, name, text: clean });
    }
    return out;
}

export async function getChatMessages(maxMessages = 50) {
    const arr = await tryImportChatArray();
    const out = readArrayMessages(arr, maxMessages);
    if (out.length) return out;
    return readDomMessages(maxMessages);
}

export async function getChatTranscriptText({ maxMessages = 50, maxChars = 30000 } = {}) {
    const msgs = await getChatMessages(maxMessages);
    let raw = "";
    for (const m of msgs) {
        raw += `${m.isUser ? "You" : "Story"}: ${m.text}\n`;
    }
    raw = stripCssBlocks(raw).trim();
    if (!raw) return "";
    return raw.slice(-1 * Math.max(1000, Number(maxChars || 30000)));
}

export async function getRecentChatSnippet(maxMessages = 1) {
    const msgs = await getChatMessages(maxMessages);
    const last = msgs[msgs.length - 1];
    return String(last?.text || "");
}

