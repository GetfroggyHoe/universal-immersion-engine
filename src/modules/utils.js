
import { getContext } from "../../../../extensions.js";

/**
 * Universal Immersion Engine - Shared Utilities
 * Consolidated helper functions to reduce duplication.
 */

export function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function newId(prefix = "id") {
    return `${prefix}_${Date.now().toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`;
}

export function simpleHash(str) {
    let h = 0;
    const s = String(str || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return String(h);
}

export function clamp01(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

export function msToClock(ms) {
    ms = Math.max(0, Number(ms || 0));
    const sec = Math.ceil(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

export function safeUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    return u;
}

export function getLoreKeys() {
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

export function getPersonaName() {
    try {
        const ctx = getContext?.();
        return String(ctx?.name1 || "You").trim() || "You";
    } catch (_) {
        return "You";
    }
}

export function getChatSnippet(n = 15, maxLen = 2000) {
    try {
        let raw = "";
        const $txt = $(".chat-msg-txt");
        if ($txt.length) {
            $txt.slice(-Math.max(1, Number(n) || 15)).each(function () { raw += $(this).text() + "\n"; });
            return raw.trim().slice(0, maxLen);
        }
        const chatEl = document.getElementById("chat");
        if (!chatEl) return "";
        const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-Math.max(1, Number(n) || 15));
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
        return raw.trim().slice(0, maxLen);
    } catch (_) {
        return "";
    }
}
