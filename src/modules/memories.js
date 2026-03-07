import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";

function ensureMem(s) {
    if (!s.memories || typeof s.memories !== "object") s.memories = {};
    if (typeof s.memories.auto !== "boolean") s.memories.auto = false;
    if (!Array.isArray(s.memories.chunks)) s.memories.chunks = [];
    if (typeof s.memories.lastIndex !== "number") s.memories.lastIndex = 0;
    if (typeof s.memories.lastLen !== "number") s.memories.lastLen = 0;
}

function getChatMesElements() {
    try {
        const chatEl = document.querySelector("#chat");
        if (!chatEl) return [];
        return Array.from(chatEl.querySelectorAll(".mes"));
    } catch (_) {
        return [];
    }
}

function textForMes(m) {
    const isUser =
        m.classList?.contains("is_user") ||
        m.getAttribute("is_user") === "true" ||
        m.getAttribute("data-is-user") === "true" ||
        m.dataset?.isUser === "true";
    const t =
        m.querySelector(".mes_text")?.textContent ||
        m.querySelector(".mes-text")?.textContent ||
        m.textContent ||
        "";
    return { who: isUser ? "You" : "Story", text: String(t || "").trim() };
}

function sliceChat(start, count) {
    const els = getChatMesElements();
    const out = [];
    for (let i = start; i < Math.min(els.length, start + count); i++) {
        const { who, text } = textForMes(els[i]);
        if (!text) continue;
        out.push(`${who}: ${text.slice(0, 520)}`);
    }
    return { lines: out, total: els.length };
}

async function summarizeChunk(lines) {
    const prompt = `
Return JSON only:
{
  "title": "short label",
  "facts": ["bullet", "bullet"],
  "entities": ["names/places"],
  "tags": ["tag"]
}

Rules:
- Keep facts short and non-redundant.
- Include location/time changes if present.
- Do not invent anything not in chat.
- 3-10 facts max.

CHAT (chunk):
${lines.join("\n").slice(0, 8000)}
`.trim();
    const res = await generateContent(prompt, "System Check");
    if (!res) return null;
    try {
        const obj = JSON.parse(String(res).replace(/```json|```/g, "").trim());
        if (!obj || typeof obj !== "object") return null;
        const title = String(obj.title || "Memory").slice(0, 80);
        const facts = Array.isArray(obj.facts) ? obj.facts.map(x => String(x || "").trim()).filter(Boolean).slice(0, 12) : [];
        const entities = Array.isArray(obj.entities) ? obj.entities.map(x => String(x || "").trim()).filter(Boolean).slice(0, 18) : [];
        const tags = Array.isArray(obj.tags) ? obj.tags.map(x => String(x || "").trim()).filter(Boolean).slice(0, 10) : [];
        return { title, facts, entities, tags };
    } catch (_) {
        return null;
    }
}

async function scanNextChunkInternal(fromStart) {
    const s = getSettings();
    if (!s) return { ok: false };
    ensureMem(s);

    const start = fromStart ? 0 : Math.max(0, Number(s.memories.lastIndex || 0));
    const { lines, total } = sliceChat(start, 50);
    if (!lines.length) {
        s.memories.lastLen = total;
        s.memories.lastIndex = Math.min(start, total);
        saveSettings();
        return { ok: true, done: true, total };
    }

    const sum = await summarizeChunk(lines);
    const chunk = {
        start,
        end: Math.min(total, start + 50),
        ts: Date.now(),
        rawCount: lines.length,
        title: sum?.title || "Memory",
        facts: sum?.facts || [],
        entities: sum?.entities || [],
        tags: sum?.tags || []
    };
    s.memories.chunks.push(chunk);
    s.memories.lastIndex = chunk.end;
    s.memories.lastLen = total;
    saveSettings();
    return { ok: true, done: chunk.end >= total, total };
}

export async function scanAllMemoriesFromStart() {
    const s = getSettings();
    if (!s) return;
    ensureMem(s);
    s.memories.chunks = [];
    s.memories.lastIndex = 0;
    saveSettings();

    let guard = 0;
    while (guard < 500) {
        guard++;
        const r = await scanNextChunkInternal(true);
        if (!r?.ok || r?.done) break;
        await new Promise(res => setTimeout(res, 40));
    }
}

export async function scanNextMemoriesChunk() {
    await scanNextChunkInternal(false);
}

export async function scanRecentMemories() {
    const s = getSettings();
    if (!s) return;
    ensureMem(s);
    if (s.memories.auto !== true) return;
    const els = getChatMesElements();
    const total = els.length;
    const lastLen = Number(s.memories.lastLen || 0);
    if (total <= lastLen) return;
    await scanNextChunkInternal(false);
}

