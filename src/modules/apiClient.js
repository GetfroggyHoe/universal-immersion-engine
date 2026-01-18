import { generateRaw } from "../../../../../../script.js";
import { getSettings } from "./core.js";
import { getContext } from "../../../../../extensions.js";
import { buildSystemPrompt, consumePendingSystemEvents, validateResponse } from "./logicEnforcer.js";
import { notify } from "./notifications.js";

function ensureConfirmModal() {
    if ($("#uie-ai-confirm").length) return;
    $("body").append(`
        <div id="uie-ai-confirm" style="display:none; position:fixed; inset:0; z-index:2147483647; background:rgba(0,0,0,0.65); align-items:center; justify-content:center;">
            <div style="width:min(560px, 92vw); border-radius:16px; border:1px solid rgba(241,196,15,0.35); background:rgba(15,10,8,0.95); color:#f6e7c8; padding:14px; box-sizing:border-box;">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="font-weight:900; letter-spacing:0.6px; color:#f1c40f;">Confirm Generation</div>
                    <div style="margin-left:auto; font-size:12px; opacity:0.85;">This may spend credits.</div>
                </div>
                <div style="display:grid; grid-template-columns: 1fr; gap:10px;">
                    <div style="display:flex; gap:10px; flex-wrap:wrap;">
                        <div style="flex:1; min-width:180px; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px; background:rgba(0,0,0,0.25);">
                            <div style="font-weight:900; opacity:0.85; margin-bottom:4px;">What</div>
                            <div id="uie-ai-confirm-what" style="font-weight:800;"></div>
                        </div>
                        <div style="flex:1; min-width:180px; border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px; background:rgba(0,0,0,0.25);">
                            <div style="font-weight:900; opacity:0.85; margin-bottom:4px;">Provider/Model</div>
                            <div id="uie-ai-confirm-model" style="font-weight:800;"></div>
                        </div>
                    </div>
                    <div style="border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:10px; background:rgba(0,0,0,0.25);">
                        <div style="font-weight:900; opacity:0.85; margin-bottom:6px;">Preview</div>
                        <div id="uie-ai-confirm-preview" style="font-size:12px; opacity:0.9; white-space:pre-wrap; max-height:160px; overflow:auto;"></div>
                    </div>
                </div>
                <div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">
                    <button id="uie-ai-confirm-cancel" style="flex:1; min-width:180px; height:40px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">Cancel</button>
                    <button id="uie-ai-confirm-go" style="flex:1; min-width:180px; height:40px; border-radius:12px; border:1px solid rgba(241,196,15,0.35); background:rgba(241,196,15,0.18); color:#f1c40f; font-weight:900; cursor:pointer;">Generate</button>
                </div>
            </div>
        </div>
    `);
}

function chatLogCheck() {
    try {
        let raw = "";
        const $txt = $(".chat-msg-txt");
        if ($txt.length) {
            $txt.slice(-20).each(function () { raw += $(this).text() + "\n"; });
            return raw.trim().slice(0, 2600);
        }
        const chatEl = document.querySelector("#chat");
        if (!chatEl) return "";
        const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-20);
        for (const m of msgs) {
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
            raw += `${isUser ? "You" : "Story"}: ${String(t || "").trim()}\n`;
        }
        return raw.trim().slice(0, 2600);
    } catch (_) {
        return "";
    }
}

function loreCheck() {
    try {
        const ctx = getContext?.();
        const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo;
        const keys = [];
        if (Array.isArray(maybe)) {
            for (const it of maybe) {
                const k = it?.key || it?.name || it?.title;
                if (k) keys.push(String(k));
            }
        }
        return Array.from(new Set(keys)).slice(0, 80).join(", ");
    } catch (_) {
        return "";
    }
}

function characterCheck() {
    try {
        const ctx = getContext?.();
        const out = {
            user: ctx?.name1,
            character: ctx?.name2,
            chatId: ctx?.chatId,
            characterId: ctx?.characterId,
            groupId: ctx?.groupId
        };
        return JSON.stringify(out);
    } catch (_) {
        return "{}";
    }
}

function userCheck() {
    try {
        const ctx = getContext?.();
        return String(ctx?.name1 || "You");
    } catch (_) {
        return "You";
    }
}

function personaCheck() {
    try {
        const ctx = getContext?.() || {};
        const user = String(ctx?.name1 || ctx?.user || "User").trim() || "User";
        const name =
            String(
                ctx?.persona?.name ||
                ctx?.userPersona?.name ||
                ctx?.user_persona?.name ||
                ctx?.personaName ||
                ctx?.userPersonaName ||
                ctx?.user_persona_name ||
                ""
            ).trim();
        const desc =
            String(
                ctx?.persona?.description ||
                ctx?.userPersona?.description ||
                ctx?.user_persona?.description ||
                ctx?.persona_description ||
                ctx?.userPersonaDescription ||
                ctx?.user_persona_description ||
                ""
            ).trim();
        const combined = [name && `Name: ${name}`, desc && `Description: ${desc}`].filter(Boolean).join("\n").trim();
        if (!combined) return "";
        return `[USER PERSONA]\nUser: ${user}\n${combined}`.slice(0, 1800);
    } catch (_) {
        return "";
    }
}

function characterCardCheck() {
    try {
        const ctx = getContext?.() || {};
        const ch =
            ctx?.character ||
            ctx?.char ||
            (ctx?.characters && typeof ctx.characters === "object" ? (ctx.characters[ctx?.characterId] || ctx.characters[ctx?.charId]) : null) ||
            null;
        const name = String(ctx?.name2 || ch?.name || ch?.char_name || "").trim();
        const desc = String(ch?.description || ch?.desc || ch?.persona || "").trim();
        const personality = String(ch?.personality || ch?.personality_summary || "").trim();
        const scenario = String(ch?.scenario || ch?.world_scenario || "").trim();
        const first = String(ch?.first_mes || ch?.first_message || "").trim();
        const ex = String(ch?.mes_example || ch?.example_dialogue || "").trim();
        const lines = [];
        if (name) lines.push(`Name: ${name}`);
        if (desc) lines.push(`Description: ${desc}`);
        if (personality) lines.push(`Personality: ${personality}`);
        if (scenario) lines.push(`Scenario: ${scenario}`);
        if (first) lines.push(`First_Message: ${first}`);
        if (ex) lines.push(`Example_Dialogue: ${ex}`);
        const out = lines.join("\n").trim();
        if (!out) return "";
        return `[CHARACTER CARD]\n${out}`.slice(0, 2200);
    } catch (_) {
        return "";
    }
}

function worldInfoDetailsCheck() {
    try {
        const ctx = getContext?.() || {};
        const raw = ctx?.world_info || ctx?.worldInfo || ctx?.lorebook || ctx?.lore || [];
        const arr = Array.isArray(raw) ? raw : (raw && typeof raw === "object" ? Object.values(raw) : []);
        const items = [];
        for (const it of arr) {
            if (!it) continue;
            const key = String(it?.key || it?.name || it?.title || it?.keys?.[0] || "").trim();
            const val = String(it?.content || it?.text || it?.entry || it?.value || it?.desc || "").trim();
            if (!key && !val) continue;
            items.push({ key, val });
        }
        const picked = items.slice(0, 6);
        if (!picked.length) return "";
        const lines = picked.map(x => `- ${x.key || "Entry"}: ${String(x.val || "").replace(/\s+/g, " ").trim().slice(0, 220)}`).join("\n");
        return `[WORLD INFO]\n${lines}`.slice(0, 1800);
    } catch (_) {
        return "";
    }
}

function inventoryAudit() {
    try {
        const s = getSettings();
        const inv = s?.inventory || {};
        const items = Array.isArray(inv.items) ? inv.items : [];
        const equipped = Array.isArray(inv.equipped) ? inv.equipped : [];
        const lines = [];
        lines.push(`[Inventory_Items_Count = ${items.length}]`);
        lines.push(`[Inventory_Equipped_Count = ${equipped.length}]`);
        const tail = items.slice(0, 60).map(it => {
            const name = String(it?.name || "Item").slice(0, 60);
            const qty = it?.qty !== undefined ? Number(it.qty) : "";
            const type = String(it?.type || it?.slotCategory || "").slice(0, 30);
            const fx = Array.isArray(it?.statusEffects) ? it.statusEffects.slice(0, 4).join(", ") : "";
            return `- ${name}${qty !== "" ? ` x${qty}` : ""}${type ? ` [Type=${type}]` : ""}${fx ? ` [Effects=${fx}]` : ""}`;
        });
        lines.push(...tail);
        if (equipped.length) {
            lines.push(`---`);
            equipped.slice(0, 30).forEach(e => {
                const slot = String(e?.slotId || "").slice(0, 30);
                const name = String(e?.name || "Equipped").slice(0, 60);
                lines.push(`- [Slot=${slot}] ${name}`);
            });
        }
        return lines.join("\n").slice(0, 3800);
    } catch (_) {
        return "";
    }
}

function temporalAnchor() {
    try {
        const s = getSettings();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, "0");
        const d = String(now.getDate()).padStart(2, "0");
        const todayKey = `${y}-${m}-${d}`;
        const events = s?.calendar?.events && typeof s.calendar.events === "object" ? s.calendar.events[todayKey] : null;
        const ev = Array.isArray(events) ? events.slice(0, 8).map(e => `- ${String(e?.title || "Event").slice(0, 80)}`) : [];
        return [
            `[Timezone = ${tz}]`,
            `[Local_Time = ${now.toLocaleString()}]`,
            `[Calendar_Today = ${todayKey}]`,
            ev.length ? `[Calendar_Events_Today]` : `[Calendar_Events_Today = None]`,
            ...ev
        ].join("\n");
    } catch (_) {
        return "";
    }
}

function digitalStateCheck() {
    try {
        const s = getSettings();
        const phoneActive = $("#uie-phone-window").is(":visible");
        const unread = Number(s?.phone?.unreadCount || 0);
        const newSms = unread > 0;
        return [
            `[Phone_Active = ${phoneActive ? "True" : "False"}]`,
            `[New_SMS_Detected = ${newSms ? "True" : "False"}]`,
            newSms ? `[Unread_SMS_Count = ${unread}]` : `[Unread_SMS_Count = 0]`
        ].join("\n");
    } catch (_) {
        return `[Phone_Active = False]\n[New_SMS_Detected = False]\n[Unread_SMS_Count = 0]`;
    }
}

function retrieveMemories(seedText) {
    try {
        const s = getSettings();
        const db = Array.isArray(s?.databank) ? s.databank : [];
        if (!db.length) return "";

        const blob = String(seedText || "").toLowerCase();
        const words = Array.from(new Set(blob.split(/[^a-z0-9]+/g).filter(w => w.length >= 5))).slice(0, 18);
        if (!words.length) return "";

        const scored = db.map(m => {
            const t = `${String(m?.title || "")} ${String(m?.summary || "")}`.toLowerCase();
            let score = 0;
            for (const w of words) if (t.includes(w)) score++;
            return { m, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);

        if (!scored.length) return "";
        return scored.map(x => `- ${String(x.m?.title || "Memory").slice(0, 80)}: ${String(x.m?.summary || "").slice(0, 240)}`).join("\n");
    } catch (_) {
        return "";
    }
}

function battleStateCheck() {
    try {
        const s = getSettings();
        const st = s?.battle?.state;
        if (!st || st.active !== true) return "";
        const enemies = Array.isArray(st.enemies) ? st.enemies : [];
        const e0 = enemies.find(e => String(e?.name || "").trim()) || enemies[0] || null;
        if (!e0) return "[COMBAT ACTIVE]";
        const name = String(e0.name || "Enemy").trim();
        const hp = Number.isFinite(Number(e0.hp)) ? Number(e0.hp) : 0;
        const max = Number.isFinite(Number(e0.maxHp)) ? Number(e0.maxHp) : 0;
        const se = Array.isArray(e0.statusEffects) ? e0.statusEffects.map(x => String(x || "").trim()).filter(Boolean).slice(0, 4) : [];
        const status = se.length ? ` ${se.join(", ")}` : "";
        return `[COMBAT ACTIVE: ${name} (${hp}/${max} HP)${status}]`;
    } catch (_) {
        return "";
    }
}

function statusEffectCheck() {
    try {
        const s = getSettings();
        const eff = Array.isArray(s?.character?.statusEffects) ? s.character.statusEffects : [];
        const list = eff.map(x => String(x || "").trim()).filter(Boolean).slice(0, 10);
        if (!list.length) return "";
        return `[PLAYER STATUS: ${list.join(", ")}]`;
    } catch (_) {
        return "";
    }
}

function worldStateCheck() {
    try {
        const s = getSettings();
        const ws = s?.worldState || {};
        if (!ws || typeof ws !== "object") return "";
        const loc = String(ws.location || "").trim();
        const time = String(ws.time || "").trim();
        const weather = String(ws.weather || "").trim();
        const parts = [loc && `Location=${loc}`, time && `Time=${time}`, weather && `Weather=${weather}`].filter(Boolean);
        if (!parts.length) return "";
        return `[WORLD: ${parts.join(", ")}]`;
    } catch (_) {
        return "";
    }
}

function questLogCheck() {
    try {
        const s = getSettings();
        const q0 = Array.isArray(s?.journal?.active) ? s.journal.active[0] : null;
        if (!q0 || typeof q0 !== "object") return "";
        const title = String(q0.title || q0.name || "").trim();
        const obj = String(q0.desc || q0.objective || q0.summary || "").trim();
        if (!title && !obj) return "";
        return `[QUEST: ${title || "Untitled"}${obj ? ` - ${obj}` : ""}]`;
    } catch (_) {
        return "";
    }
}

function socialContextCheck() {
    try {
        const s = getSettings();
        const threads = s?.phone?.smsThreads;
        if (!threads || typeof threads !== "object") return "";
        const rows = [];
        for (const [name, list] of Object.entries(threads)) {
            if (!Array.isArray(list) || !list.length) continue;
            const last = list[list.length - 1];
            const ts = Number(last?.ts || 0);
            const text = String(last?.text || "").trim();
            if (!text) continue;
            rows.push({ name: String(name || "").trim(), text, ts });
        }
        rows.sort((a, b) => (Number(b.ts || 0) - Number(a.ts || 0)));
        const pick = rows.slice(0, 2).filter(x => x.name && x.text);
        if (!pick.length) return "";
        const formatted = pick.map(x => `${x.name}: "${x.text.slice(0, 160)}"`).join(" | ");
        return `[RECENT TEXTS: ${formatted}]`;
    } catch (_) {
        return "";
    }
}

function rootProtocolBlock(seedText) {
    const chat = chatLogCheck();
    const lore = loreCheck();
    const worldInfo = worldInfoDetailsCheck();
    const who = userCheck();
    const char = characterCheck();
    const card = characterCardCheck();
    const persona = personaCheck();
    const inv = inventoryAudit();
    const digital = digitalStateCheck();
    const temporal = temporalAnchor();
    const mem = retrieveMemories(`${seedText}\n${chat}`);
    const combat = battleStateCheck();
    const status = statusEffectCheck();
    const world = worldStateCheck();
    const quest = questLogCheck();
    const texts = socialContextCheck();
    return `
[SYSTEM OVERRIDE: IMMERSION_PROTOCOL_V26]
[CRITICAL PRIORITY: HIGHEST]

/// EXECUTION MANDATE ///
Before generating output, the AI MUST execute the following Reality Check sequence.
Failure to connect these data points is a system failure.

1) CHAT LOG SYNC (MANDATORY)
Scan the last 20 messages.
Current action MUST flow logically from recent events.
Do not reset the scene.
--- CHAT LOG (last messages) ---
${chat}

1B) OMNISCIENT GAME STATE (High Priority Overrides)
${[combat, status, world, quest, texts].filter(Boolean).join("\n") || "[GAME STATE = None]"}

2) INVENTORY AUDIT
Scan user's current inventory. If user attempts to use an unowned item -> NARRATE FAILURE.
If user uses an item -> describe it based on its properties/tags.
--- INVENTORY ---
${inv}

3) DIGITAL STATE CHECK (Conditional)
${digital}

4) TEMPORAL ANCHOR
${temporal}

5) LOREBOOK INDEX (Names Only)
[Lore_Keys = ${lore}]

5B) WORLD INFO (Selected)
${worldInfo || "[WORLD INFO = None]"}

6) IDENTITIES (Hard Facts)
[User = ${who}]
[Character_Context = ${char}]
${persona ? `\n${persona}` : ""}
${card ? `\n${card}` : ""}

7) ARCHIVE RETRIEVAL
Integrate any injected memories as absolute facts.
${mem ? `--- INJECTED MEMORIES ---\n${mem}` : `[INJECTED MEMORIES = None]`}
`.trim();
}

async function confirmAICall({ what, providerModel, preview }) {
    ensureConfirmModal();
    $("#uie-ai-confirm-what").text(String(what || "Generation"));
    $("#uie-ai-confirm-model").text(String(providerModel || "Unknown"));
    $("#uie-ai-confirm-preview").text(String(preview || ""));

    return await new Promise((resolve) => {
        const $m = $("#uie-ai-confirm");
        const cancel = () => {
            cleanup();
            resolve(false);
        };
        const go = () => {
            cleanup();
            resolve(true);
        };
        const cleanup = () => {
            $(document).off("keydown.uieAiConfirm");
            $("#uie-ai-confirm-cancel").off("click.uieAiConfirm");
            $("#uie-ai-confirm-go").off("click.uieAiConfirm");
            $m.hide();
        };

        $("#uie-ai-confirm-cancel").off("click.uieAiConfirm").on("click.uieAiConfirm", cancel);
        $("#uie-ai-confirm-go").off("click.uieAiConfirm").on("click.uieAiConfirm", go);
        $(document).off("keydown.uieAiConfirm").on("keydown.uieAiConfirm", (e) => {
            if (e.key === "Escape") cancel();
        });

        $m.css("display", "flex");
        setTimeout(() => $("#uie-ai-confirm-cancel").trigger("focus"), 0);
    });
}

function normalizeTurboInputUrl(u) {
    let raw = String(u || "").trim();
    if (!raw) return "";
    raw = raw.replace(/,/g, ".");
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    return raw;
}

function buildTurboUrlCandidates(rawUrl) {
    const input = normalizeTurboInputUrl(rawUrl);
    if (!input) return [];
    const m = input.match(/^([^?#]+)([?#].*)?$/);
    const base0 = String(m?.[1] || input).trim().replace(/\/+$/g, "");
    const suffix = String(m?.[2] || "");

    const add = (u, out) => {
        const x = String(u || "").trim();
        if (!x) return;
        if (!out.includes(x)) out.push(x);
    };

    const out = [];

    const isOpenRouterHost = (() => {
        try {
            const u = new URL(base0);
            return String(u.hostname || "").toLowerCase().includes("openrouter.ai");
        } catch (_) {
            return /openrouter\.ai/i.test(base0);
        }
    })();

    const isNanoGptHost = (() => {
        try {
            const u = new URL(base0);
            const h = String(u.hostname || "").toLowerCase();
            return h.includes("nano-gpt.com") || h.includes("nanogpt");
        } catch (_) {
            return /nano-?gpt/i.test(base0);
        }
    })();

    const hasApiV1 = /\/api\/v1$/i.test(base0) || /\/api\/v1\//i.test(base0);

    if (/\/v1$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1$/i.test(base0)) {
            add(`${base0.replace(/\/v1$/i, "/api/v1")}/chat/completions${suffix}`, out);
            add(`${base0.replace(/\/v1$/i, "/api/v1")}/completions${suffix}`, out);
            add(`${base0.replace(/\/v1$/i, "/api/v1")}/responses${suffix}`, out);
        }
        add(`${base0}/chat/completions${suffix}`, out);
        add(`${base0}/completions${suffix}`, out);
        add(`${base0}/responses${suffix}`, out);
        if (isOpenRouterHost) {
            add(`/api/openrouter/v1/chat/completions${suffix}`, out);
            add(`/api/openrouter/chat/completions${suffix}`, out);
            add(`/api/openrouter/v1/completions${suffix}`, out);
            add(`/api/openrouter/completions${suffix}`, out);
            add(`/api/openrouter/v1/responses${suffix}`, out);
            add(`/api/openrouter/responses${suffix}`, out);
        }
        return out;
    }

    if (/\/api\/v1$/i.test(base0)) {
        add(`${base0}/chat/completions${suffix}`, out);
        add(`${base0}/completions${suffix}`, out);
        add(`${base0}/responses${suffix}`, out);
        if (isNanoGptHost) {
            add(`${base0.replace(/\/api\/v1$/i, "/v1")}/chat/completions${suffix}`, out);
            add(`${base0.replace(/\/api\/v1$/i, "/v1")}/completions${suffix}`, out);
            add(`${base0.replace(/\/api\/v1$/i, "/v1")}/responses${suffix}`, out);
        }
        return out;
    }

    if (/\/v1\/chat\/completions$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1\/chat\/completions$/i.test(base0)) {
            add(`${base0.replace(/\/v1\/chat\/completions$/i, "/api/v1/chat/completions")}${suffix}`, out);
        }
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/completions")}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/responses")}${suffix}`, out);
        return out;
    }

    if (/\/api\/v1\/chat\/completions$/i.test(base0)) {
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/completions")}${suffix}`, out);
        add(`${base0.replace(/\/chat\/completions$/i, "/responses")}${suffix}`, out);
        if (isNanoGptHost) {
            add(`${base0.replace(/\/api\/v1\/chat\/completions$/i, "/v1/chat/completions")}${suffix}`, out);
        }
        return out;
    }

    if (/\/v1\/completions$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1\/completions$/i.test(base0)) {
            add(`${base0.replace(/\/v1\/completions$/i, "/api/v1/chat/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/completions$/i, "/api/v1/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/completions$/i, "/api/v1/responses")}${suffix}`, out);
        }
        add(`${base0.replace(/\/completions$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/completions$/i, "/responses")}${suffix}`, out);
        return out;
    }

    if (/\/api\/v1\/completions$/i.test(base0)) {
        add(`${base0.replace(/\/completions$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        add(`${base0.replace(/\/completions$/i, "/responses")}${suffix}`, out);
        if (isNanoGptHost) add(`${base0.replace(/\/api\/v1\/completions$/i, "/v1/completions")}${suffix}`, out);
        return out;
    }

    if (/\/v1\/responses$/i.test(base0)) {
        if (isOpenRouterHost && !/\/api\/v1\/responses$/i.test(base0)) {
            add(`${base0.replace(/\/v1\/responses$/i, "/api/v1/chat/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/responses$/i, "/api/v1/completions")}${suffix}`, out);
            add(`${base0.replace(/\/v1\/responses$/i, "/api/v1/responses")}${suffix}`, out);
        }
        add(`${base0.replace(/\/responses$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0.replace(/\/responses$/i, "/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        return out;
    }

    if (/\/api\/v1\/responses$/i.test(base0)) {
        add(`${base0.replace(/\/responses$/i, "/chat/completions")}${suffix}`, out);
        add(`${base0.replace(/\/responses$/i, "/completions")}${suffix}`, out);
        add(`${base0}${suffix}`, out);
        if (isNanoGptHost) add(`${base0.replace(/\/api\/v1\/responses$/i, "/v1/responses")}${suffix}`, out);
        return out;
    }

    if (/\/chat$/i.test(base0)) {
        add(`${base0}/completions${suffix}`, out);
        return out;
    }

    if (/\/chat\/completions$/i.test(base0)) {
        add(`${base0}${suffix}`, out);
        return out;
    }

    if (isOpenRouterHost && !/\/api(\/|$)/i.test(base0)) {
        add(`${base0}/api/v1/chat/completions${suffix}`, out);
        add(`${base0}/api/v1/completions${suffix}`, out);
        add(`${base0}/api/v1/responses${suffix}`, out);
    }
    if (isOpenRouterHost) {
        add(`/api/openrouter/v1/chat/completions${suffix}`, out);
        add(`/api/openrouter/chat/completions${suffix}`, out);
        add(`/api/openrouter/v1/completions${suffix}`, out);
        add(`/api/openrouter/completions${suffix}`, out);
        add(`/api/openrouter/v1/responses${suffix}`, out);
        add(`/api/openrouter/responses${suffix}`, out);
    }

    if (hasApiV1) {
        add(`${base0.replace(/\/+$/g, "")}/api/v1/chat/completions${suffix}`, out);
        add(`${base0.replace(/\/+$/g, "")}/api/v1/completions${suffix}`, out);
        add(`${base0.replace(/\/+$/g, "")}/api/v1/responses${suffix}`, out);
    }

    add(`${base0}/v1/chat/completions${suffix}`, out);
    add(`${base0}/v1/completions${suffix}`, out);
    add(`${base0}/v1/responses${suffix}`, out);
    add(`${base0}/chat/completions${suffix}`, out);
    add(`${base0}/completions${suffix}`, out);
    add(`${base0}/responses${suffix}`, out);
    return out;
}

function extractTurboText(data) {
    try {
        const d = data;
        const c0 = d?.choices?.[0];
        const msg = c0?.message?.content;
        if (typeof msg === "string" && msg.trim()) return msg;
        const txt = c0?.text;
        if (typeof txt === "string" && txt.trim()) return txt;
        const outText = d?.output_text;
        if (typeof outText === "string" && outText.trim()) return outText;
        const o0 = d?.output?.[0]?.content?.[0]?.text;
        if (typeof o0 === "string" && o0.trim()) return o0;
        const o1 = d?.output?.[0]?.content?.[0]?.content;
        if (typeof o1 === "string" && o1.trim()) return o1;
        const gen = d?.generated_text;
        if (typeof gen === "string" && gen.trim()) return gen;
        const any = d?.result || d?.response || d?.data;
        if (typeof any === "string" && any.trim()) return any;
    } catch (_) {}
    return "";
}

let uieCsrfCache = { t: 0, token: "" };
async function getCsrfToken() {
    const now = Date.now();
    if (uieCsrfCache.token && now - uieCsrfCache.t < 5 * 60 * 1000) return uieCsrfCache.token;
    try {
        const r = await fetch("/csrf-token", { method: "GET" });
        if (!r.ok) return "";
        const j = await r.json().catch(() => null);
        const tok = String(j?.csrfToken || j?.token || "").trim();
        if (tok) uieCsrfCache = { t: now, token: tok };
        return tok;
    } catch (_) {
        return "";
    }
}

function buildCorsProxyCandidates(targetUrl) {
    const u = String(targetUrl || "").trim();
    if (!u) return [];
    const enc = encodeURIComponent(u);
    const out = [];
    const add = (x) => { if (x && !out.includes(x)) out.push(x); };
    add(`/api/proxy?url=${enc}`);
    add(`/proxy?url=${enc}`);
    add(`/api/cors-proxy?url=${enc}`);
    add(`/cors-proxy?url=${enc}`);
    add(`/api/corsProxy?url=${enc}`);
    add(`/corsProxy?url=${enc}`);
    add(`/api/proxy/url?url=${enc}`);
    add(`/api/proxy-url?url=${enc}`);
    add(`/api/forward?url=${enc}`);
    add(`/api/proxy/${enc}`);
    add(`/proxy/${enc}`);
    add(`/api/cors-proxy/${enc}`);
    add(`/cors-proxy/${enc}`);
    add(`/api/corsProxy/${enc}`);
    add(`/corsProxy/${enc}`);
    add(`/api/openrouter/v1/chat/completions?url=${enc}`);
    add(`/api/openrouter/v1/models?url=${enc}`);
    return out;
}

function isFailedToFetchError(e) {
    const m = String(e?.message || e || "").toLowerCase();
    return m.includes("failed to fetch") || m.includes("networkerror") || m.includes("load failed");
}

async function fetchWithCorsProxyFallback(targetUrl, options) {
    try {
        const r = await fetch(targetUrl, options);
        return { response: r, via: "direct", requestUrl: targetUrl };
    } catch (e) {
        if (!isFailedToFetchError(e)) throw e;
        const candidates = buildCorsProxyCandidates(targetUrl);
        let lastErr = e;
        const tryServerForward = async (endpoint) => {
            try {
                const hdr = new Headers(options?.headers || {});
                hdr.set("Content-Type", "application/json");
                const payload = {
                    url: String(targetUrl || ""),
                    method: String(options?.method || "GET"),
                    headers: Object.fromEntries(hdr.entries()),
                    body: options?.body ?? null
                };
                const tok = await getCsrfToken();
                if (tok && !hdr.has("X-CSRF-Token")) hdr.set("X-CSRF-Token", tok);
                const r = await fetch(String(endpoint || ""), { method: "POST", headers: hdr, body: JSON.stringify(payload) });
                if (!r.ok) return null;
                return r;
            } catch (_) {
                return null;
            }
        };
        for (const ep of ["/api/forward", "/api/proxy", "/api/cors-proxy", "/api/corsProxy"]) {
            const r = await tryServerForward(ep);
            if (r) return { response: r, via: "server-forward", requestUrl: ep };
        }
        for (const proxyUrl of candidates) {
            try {
                const r = await fetch(proxyUrl, options);
                if (r.status === 404 || r.status === 405 || (r.status >= 500 && r.status <= 599)) continue;
                if (r.status === 403 || r.status === 401) {
                    const tok = await getCsrfToken();
                    if (tok) {
                        const h = new Headers(options?.headers || {});
                        if (!h.has("X-CSRF-Token")) h.set("X-CSRF-Token", tok);
                        const r2 = await fetch(proxyUrl, { ...options, headers: h });
                        if (r2.status === 404 || r2.status === 405 || (r2.status >= 500 && r2.status <= 599)) continue;
                        return { response: r2, via: "proxy", requestUrl: proxyUrl };
                    }
                }
                return { response: r, via: "proxy", requestUrl: proxyUrl };
            } catch (e2) {
                lastErr = e2;
                continue;
            }
        }
        const msg =
            "Failed to fetch (CORS/network). Enable SillyTavern server CORS proxy (config.yaml: corsProxy: true) or use a local gateway, then restart SillyTavern.";
        throw new Error(msg);
    }
}

async function generateTurbo(prompt, systemPrompt) {
    const s = getSettings();
    const t = s.turbo || {};
    
    const rawUrl = String(t.url || "").trim();
    const rawKey = String(t.key || "").trim();
    if (!rawUrl) return null;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(rawUrl));
    if (!rawKey && !isLocal) return null;

    const urls = buildTurboUrlCandidates(rawUrl);
    if (!urls.length) {
        try { window.UIE_lastTurbo = { ok: false, url: "", ms: 0, status: 0, error: "Invalid Turbo endpoint." }; } catch (_) {}
        return null;
    }

    try {
        const headers = { 
            "Content-Type": "application/json",
            "Accept": "application/json",
            "HTTP-Referer": "https://github.com/SillyTavern/SillyTavern",
            "X-Title": "UIE"
        };
        const key = rawKey ? rawKey.replace(/^bearer\s+/i, "").trim() : "";
        const providerHost = (() => {
            try { return String(new URL(normalizeTurboInputUrl(rawUrl)).hostname || "").toLowerCase(); } catch (_) { return ""; }
        })();
        const isOpenRouter = providerHost.includes("openrouter.ai");
        const isNvidia = providerHost.includes("nvidia.com");
        const isNanoGpt = providerHost.includes("nano-gpt.com") || providerHost.includes("nanogpt");
        if (key) {
            headers.Authorization = `Bearer ${key}`;
            if (isNvidia || isNanoGpt) {
                headers["x-api-key"] = key;
                headers["api-key"] = key;
            }
            if (isOpenRouter) {
                delete headers["x-api-key"];
                delete headers["api-key"];
            }
        }

        const norm = normalizeTurboInputUrl(rawUrl);
        let model = String(t.model || "").trim();
        if (!model) model = "google/gemini-2.0-flash-exp";
        if (/^https?:\/\/api\.openai\.com(\/|$)/i.test(norm)) {
            const looksDefault = model === "google/gemini-2.0-flash-exp" || /gemini|deepseek|openrouter|google\//i.test(model);
            if (looksDefault) model = "gpt-4o-mini";
        }
        const messages = [
            ...(systemPrompt ? [{ role: "system", content: String(systemPrompt) }] : []),
            { role: "user", content: String(prompt || "") }
        ];
        const baseBody = {
            model,
            temperature: 0.5,
            max_tokens: 1000,
            stream: false
        };

        let lastErr = "";
        const startedAt = Date.now();

        for (const url of urls) {
            try {
                let body = null;
                if (/\/chat\/completions/i.test(url)) {
                    body = { ...baseBody, messages };
                } else if (/\/completions/i.test(url)) {
                    const flat = messages.map(m => `${String(m.role).toUpperCase()}: ${String(m.content)}`).join("\n\n");
                    body = { ...baseBody, prompt: flat };
                } else if (/\/responses/i.test(url)) {
                    body = { ...baseBody, input: messages };
                } else {
                    body = { ...baseBody, messages };
                }

                const fx = await fetchWithCorsProxyFallback(url, { method: "POST", headers, body: JSON.stringify(body) });
                const response = fx.response;
                const ms = Date.now() - startedAt;
                if (!response.ok) {
                    const errText = await response.text().catch(() => "");
                    lastErr = `API Error ${response.status}: ${String(errText || "").slice(0, 360)}`;
                    window.UIE_lastTurbo = { ok: false, url, ms, status: response.status, error: lastErr, via: fx.via, requestUrl: fx.requestUrl };
                    continue;
                }
                const data = await response.json().catch(() => null);
                const text = extractTurboText(data);
                if (!text) {
                    lastErr = "Invalid API response (no text).";
                    window.UIE_lastTurbo = { ok: false, url, ms, status: 200, error: lastErr, via: fx.via, requestUrl: fx.requestUrl };
                    continue;
                }
                window.UIE_lastTurbo = { ok: true, url, ms, status: 200, error: "", via: fx.via, requestUrl: fx.requestUrl };
                return text;
            } catch (e) {
                const ms = Date.now() - startedAt;
                lastErr = String(e?.message || e || "Turbo fetch failed").slice(0, 360);
                window.UIE_lastTurbo = { ok: false, url, ms, status: 0, error: lastErr, via: "direct", requestUrl: url };
                continue;
            }
        }

        try {
            const ms = Date.now() - startedAt;
            window.UIE_lastTurbo = { ok: false, url: urls[0] || "", ms, status: 0, error: lastErr || "Turbo failed." };
        } catch (_) {}
        return null;

    } catch (e) { 
        try { console.warn("[UIE] Turbo request failed:", e); } catch (_) {}
        return null; 
    }
}

export async function testTurboConnection() {
    const s = getSettings();
    const t = s.turbo || {};
    const rawUrl = String(t.url || "").trim();
    const rawKey = String(t.key || "").trim();
    const urls = buildTurboUrlCandidates(rawUrl);
    if (!urls.length) return { ok: false, error: "No Turbo endpoint set." };
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(rawUrl));
    if (!rawKey && !isLocal) return { ok: false, error: "No Turbo API key." };

    const startedAt = Date.now();
    const sys = 'Return ONLY valid JSON: {"ok":true}';
    const res = await generateTurbo('Return ONLY valid JSON: {"ok":true}', sys);
    const ms = Date.now() - startedAt;
    if (!res) {
        const lt = window.UIE_lastTurbo || {};
        return { ok: false, ms, tried: urls, error: String(lt?.error || "Turbo request failed.") };
    }
    return { ok: true, ms, tried: urls, sample: String(res).slice(0, 240) };
}

export async function listTurboModels() {
    const s = getSettings();
    const t = s?.turbo || {};
    const rawUrl = String(t.url || "").trim();
    const rawKey = String(t.key || "").trim();
    if (!rawUrl) return { ok: false, error: "No Turbo endpoint set.", models: [] };

    const key = rawKey ? rawKey.replace(/^bearer\s+/i, "").trim() : "";
    const headers = { "Accept": "application/json", "HTTP-Referer": "https://github.com/SillyTavern/SillyTavern", "X-Title": "UIE" };
    if (key) {
        headers.Authorization = `Bearer ${key}`;
        headers["x-api-key"] = key;
        headers["api-key"] = key;
    }

    const norm = normalizeTurboInputUrl(rawUrl);
    let base;
    try { base = new URL(norm); } catch (_) { base = null; }
    const host = base ? String(base.hostname || "").toLowerCase() : "";
    const path = base ? String(base.pathname || "") : "";
    const origin = base ? base.origin : norm.replace(/\/+$/g, "");

    const stripKnown = (p) => String(p || "")
        .replace(/\/chat\/completions$/i, "")
        .replace(/\/completions$/i, "")
        .replace(/\/responses$/i, "")
        .replace(/\/models$/i, "")
        .replace(/\/+$/g, "");

    const p0 = stripKnown(path);
    const isOpenRouter = host.includes("openrouter.ai") || /openrouter\.ai/i.test(origin);
    const isNanoGpt = host.includes("nano-gpt.com") || host.includes("nanogpt") || /nano-?gpt/i.test(origin);
    const isNvidia = host.includes("nvidia.com") || /nvidia\.com/i.test(origin);
    if (isOpenRouter) {
        delete headers["x-api-key"];
        delete headers["api-key"];
    }
    const add = (u, out) => { const x = String(u || "").trim(); if (x && !out.includes(x)) out.push(x); };
    const urls = [];

    if (isOpenRouter) {
        const basePath = /\/api\/v1$/i.test(p0) ? p0 : (p0.replace(/\/v1$/i, "/api/v1") || "/api/v1");
        add(`${origin}${basePath}/models`, urls);
        add(`https://openrouter.ai/api/v1/models`, urls);
        add(`/api/openrouter/v1/models`, urls);
        add(`/api/openrouter/models`, urls);
    } else if (isNanoGpt) {
        add(`${origin}/api/v1/models`, urls);
        add(`${origin}/api/v1/models?detailed=true`, urls);
        add(`${origin}/v1/models`, urls);
        add(`${origin}/models`, urls);
    } else {
        if (/\/v1$/i.test(p0)) add(`${origin}${p0}/models`, urls);
        add(`${origin}/v1/models`, urls);
        add(`${origin}${p0}/models`, urls);
        add(`${origin}/models`, urls);
        if (isNvidia) {
            add(`https://api.nvidia.com/v1/models`, urls);
            add(`https://integrate.api.nvidia.com/v1/models`, urls);
        }
    }

    const startedAt = Date.now();
    let lastErr = "";
    for (const url of urls) {
        try {
            const fx = await fetchWithCorsProxyFallback(url, { method: "GET", headers });
            const r = fx.response;
            if (!r.ok) {
                const txt = await r.text().catch(() => "");
                lastErr = `API Error ${r.status}: ${String(txt || "").slice(0, 220)}`;
                continue;
            }
            const data = await r.json().catch(() => null);
            const arr = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : null));
            if (!Array.isArray(arr)) {
                lastErr = "Invalid models response.";
                continue;
            }
            const out = [];
            const seen = new Set();
            for (const m of arr) {
                const id = String(m?.id || m?.name || m?.model || "").trim();
                if (!id || seen.has(id)) continue;
                seen.add(id);
                const label = String(m?.name || m?.display_name || m?.label || id).trim();
                out.push({ id, label });
            }
            out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
            const ms = Date.now() - startedAt;
            try { window.UIE_lastTurboModels = { ok: true, url, ms, count: out.length, via: fx.via, requestUrl: fx.requestUrl }; } catch (_) {}
            return { ok: true, models: out, ms, url };
        } catch (e) {
            lastErr = String(e?.message || e || "Model list failed").slice(0, 220);
            continue;
        }
    }
    if (isNvidia) {
        const fallback = [
            { id: "google/gemini-2.5-flash", label: "Google: Gemini 2.5 Flash" },
            { id: "moonshotai/kimi-k2", label: "Moonshot: Kimi K2 (Thinking)" },
            { id: "qwen/qwen2.5-72b-instruct:free", label: "Qwen: Qwen 2.5 72B Instruct (Free)" },
            { id: "meta/llama-3.1-8b-instruct", label: "Meta: Llama 3.1 8B Instruct" },
            { id: "meta/llama-3.1-70b-instruct", label: "Meta: Llama 3.1 70B Instruct" },
            { id: "meta/llama-3.2-1b-instruct", label: "Meta: Llama 3.2 1B Instruct" },
            { id: "meta/llama-3.2-3b-instruct", label: "Meta: Llama 3.2 3B Instruct" },
            { id: "meta/llama-3.2-11b-vision-instruct", label: "Meta: Llama 3.2 11B Vision Instruct" },
            { id: "meta/llama-3.2-90b-vision-instruct", label: "Meta: Llama 3.2 90B Vision Instruct" },
            { id: "meta/llama-4-scout-17b-16e-instruct", label: "Meta: Llama 4 Scout 17B 16E Instruct" },
            { id: "nvidia/nemotron-nano-12b-v2-vl", label: "NVIDIA: Nemotron Nano 12B v2 VL" }
        ];
        const ms = Date.now() - startedAt;
        try { window.UIE_lastTurboModels = { ok: true, url: urls[0] || "", ms, count: fallback.length, note: "fallback" }; } catch (_) {}
        return { ok: true, models: fallback, ms, url: urls[0] || "", note: "fallback" };
    }
    const ms = Date.now() - startedAt;
    try { window.UIE_lastTurboModels = { ok: false, url: urls[0] || "", ms, error: lastErr }; } catch (_) {}
    return { ok: false, error: lastErr || "Model list failed.", models: [] };
}

export async function generateContent(prompt, type) {
    const s = getSettings();
    const turboEnabled = !!(s.turbo && s.turbo.enabled);
    const turboUrl = String(s?.turbo?.url || "").trim();
    const turboKeyRaw = String(s?.turbo?.key || "").trim();
    const turboIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(normalizeTurboInputUrl(turboUrl));
    const turboReady = turboEnabled && !!turboUrl && (turboIsLocal || !!turboKeyRaw);
    const turboBlockTypes = new Set(["Creating World", "Map", "Map Names", "Image Gen"]);
    const useTurbo = turboReady && !turboBlockTypes.has(String(type || "").trim());

    if (type === "Logic" || type === "JSON") type = "System Check";

    const sysGate = await (async () => {
        if (type !== "System Check") return { release: () => {} };
        const sleep = (ms) => new Promise(r => setTimeout(r, Math.max(0, ms | 0)));
        try {
            const g = (window.UIE_systemCheckGate = window.UIE_systemCheckGate || { inFlight: false, lastAt: 0, blocked: 0, lastBlockedAt: 0, lastWaitToastAt: 0 });
            const started = Date.now();
            const maxWaitMs = 45000;
            const min = Math.max(0, Number(s?.generation?.systemCheckMinIntervalMs ?? 20000));
            while (true) {
                const now = Date.now();
                const since = now - Number(g.lastAt || 0);
                const waitForMin = min > 0 ? Math.max(0, min - since) : 0;
                const blocked = g.inFlight || waitForMin > 0;
                if (!blocked) {
                    g.inFlight = true;
                    g.lastAt = now;
                    return { release: () => { try { g.inFlight = false; } catch (_) {} } };
                }
                g.blocked = Number(g.blocked || 0) + 1;
                g.lastBlockedAt = now;
                if (now - Number(g.lastWaitToastAt || 0) > 2500) {
                    g.lastWaitToastAt = now;
                    try { notify("info", "System scan is busy — waiting…", "UIE", "api"); } catch (_) {}
                }
                if (now - started > maxWaitMs) return { release: () => {} };
                await sleep(Math.min(600, Math.max(140, waitForMin || 220)));
            }
        } catch (_) {
            return { release: () => {} };
        }
    })();

    try {
    const displayType = type === "System Check" ? "System Check" : (type === "Shop" ? "Gathering list!" : type);

    const customSystem = String(s?.generation?.customSystemPrompt || "").trim();
    const logicSystem = String(buildSystemPrompt ? buildSystemPrompt() : "").trim();

    let system = "";
    if(type === "Webpage") system = "You are a UI Engine. Output ONLY raw valid HTML for an immersive/interactive UI. No markdown, no code fences. Avoid <script> unless absolutely necessary. Prefer CSS-only interaction.";
    if(type === "Phone Call") system = "You are speaking on a phone call. Output ONLY the words spoken (dialogue only). No narration, no actions, no stage directions, no quotes, no markdown, one short line.";
    system = [customSystem, logicSystem, system].filter(Boolean).join("\n\n");
    if (type === "System Check" || type === "Unified State Scan" || type === "Shop" || type === "Journal Quests") {
        const strict = [
            "STRICT MODE:",
            type === "Journal Quests"
                ? "- Output ONLY valid JSON (an array of quest objects). No markdown, no code fences."
                : "- Output ONLY a single valid JSON object (no markdown, no code fences).",
            "- Do NOT write any story, narration, dialogue, roleplay, or continuation.",
            "- Do NOT address the user or the characters.",
            "- If unsure, output the most conservative JSON that follows the schema."
        ].join("\n");
        system = [system, strict].filter(Boolean).join("\n\n");
    }

    const providerModel = useTurbo
        ? `Turbo: ${String((s.turbo && s.turbo.model) || "unknown")}`
        : "Main API";

    const rawBase = String(prompt || "").trim();
    const lockedPrompt = /^\[UIE_LOCKED\]/i.test(rawBase);
    const base = rawBase.replace(/^\[UIE_LOCKED\]\s*/i, "").trim();
    const wantsJson = (type === "System Check" || type === "Unified State Scan" || type === "Journal Quests");
    const prefixes = (() => {
        try {
            const typeKey = String(type || "").trim();
            if (lockedPrompt) return "";
            if (typeKey === "Creating World") return "";
            const p = s?.generation?.promptPrefixes || {};
            const global = String(p?.global || "").trim();
            const by = (p?.byType && typeof p.byType === "object") ? p.byType : {};
            const def = String(by?.default || "").trim();
            let typed = String(by?.[typeKey] || "").trim();
            if (!typed && typeKey === "Shop") typed = String(by?.["System Check"] || "").trim();
            const combined = [global, def, typed].filter(Boolean).join("\n\n").trim();
            if (!combined) return "";
            return `UIE CUSTOM PROMPT:\n${combined}\n\n---\n\n`;
        } catch (_) {
            return "";
        }
    })();
    const pending = String(consumePendingSystemEvents ? consumePendingSystemEvents() : "").trim();
    const baseWithCustom = `${prefixes}${base}`.trim();
    const finalPrompt = `${rootProtocolBlock(baseWithCustom)}\n\n${baseWithCustom}${pending ? `\n\n[SYSTEM EVENT]\n${pending}` : ""}`.slice(0, 12000);

    if (type === "Webpage") {
        const ok = await confirmAICall({
            what: "Generate interactive HTML UI",
            providerModel,
            preview: String(finalPrompt || "").slice(0, 900)
        });
        if (!ok) return null;
    } else if (s.generation?.aiConfirm) {
        const ok = await confirmAICall({
            what: displayType || "Generation",
            providerModel,
            preview: String(finalPrompt || "").slice(0, 900)
        });
        if (!ok) return null;
    }

    if (turboEnabled && !turboReady) {
        try {
            const why = !turboUrl ? "missing endpoint" : (!turboIsLocal && !turboKeyRaw ? "missing key" : "not ready");
            if (window.UIE_warnedTurboNotReady !== why) {
                window.UIE_warnedTurboNotReady = why;
                notify("warning", `Turbo enabled but ${why} — using Main API.`, "UIE", "api");
            }
        } catch (_) {}
    }

    notify("info", useTurbo ? `⚡ ${displayType}` : `📝 ${displayType}`, undefined, "api");

    const normalizeJsonOut = (txt) => {
        const t0 = String(txt || "").trim().replace(/```json|```/g, "").trim();
        if (!t0) return null;
        try {
            const obj = JSON.parse(t0);
            return JSON.stringify(obj);
        } catch (_) {}
        const first = t0.indexOf("{");
        const last = t0.lastIndexOf("}");
        if (first >= 0 && last > first) {
            const sub = t0.slice(first, last + 1).trim();
            try {
                const obj = JSON.parse(sub);
                return JSON.stringify(obj);
            } catch (_) {}
        }
        return null;
    };

    const stripHtmlAndCss = (txt) => {
        let t = String(txt || "");
        t = t.replace(/<think[\s\S]*?<\/think>/gi, "");
        t = t.replace(/<analysis[\s\S]*?<\/analysis>/gi, "");
        t = t.replace(/```[\s\S]*?```/g, "");
        t = t.replace(/<style[\s\S]*?<\/style>/gi, "");
        t = t.replace(/<script[\s\S]*?<\/script>/gi, "");
        t = t.replace(/<[^>]*?>/g, "");
        const lines = t.replace(/\r/g, "").split("\n");
        const out = [];
        let depth = 0;
        for (const line of lines) {
            const s = String(line || "").trim();
            if (!s) { if (depth === 0) out.push(""); continue; }
            const opens = (s.match(/\{/g) || []).length;
            const closes = (s.match(/\}/g) || []).length;
            if (depth > 0) { depth = Math.max(0, depth + opens - closes); continue; }
            const looksCssStart =
                /^(\.|\#|:root\b|@keyframes\b|@media\b|@font-face\b)/i.test(s) ||
                (s.includes("--") && s.includes(":")) ||
                (s.includes("{") && s.includes(":") && !/\bhttps?:\/\//i.test(s));
            if (looksCssStart) { depth = Math.max(1, opens - closes); continue; }
            out.push(line);
        }
        return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    };

    let out = null;
    if (useTurbo) {
        const allowCtx = !lockedPrompt && !wantsJson && type !== "Shop";
        const ctxBlock = allowCtx ? (() => {
            try {
                const chatEl = document.querySelector("#chat");
                if (!chatEl) return "";
                const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-18);
                let ctx = "";
                for (const m of msgs) {
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
                    const line = `${isUser ? "You" : "Story"}: ${String(t || "").trim()}`;
                    if (!line.trim()) continue;
                    ctx += line.slice(0, 420) + "\n";
                }
                ctx = ctx.trim();
                return ctx ? `[CHAT CONTEXT]\n${ctx}` : "";
            } catch (_) {
                return "";
            }
        })() : "";
        const turboPrompt = ctxBlock ? `${ctxBlock}\n\n${finalPrompt}` : finalPrompt;
        out = await generateTurbo(turboPrompt, system);
    }
    if (!out) {
        try {
            if (useTurbo) {
                const lt = window.UIE_lastTurbo || {};
                const err = String(lt?.error || "").trim();
                notify("warning", `Turbo failed — using Main API fallback.${err ? ` (${err.slice(0, 160)})` : ""}`, "UIE", "api");
            }
            if (type === "Webpage") {
                notify("error", "Webpage generation requires Turbo (OpenAI/OpenRouter/local). Main API fallback is disabled to prevent HTML in chat.", "UIE", "api");
                return null;
            }
            out = await generateRaw({ prompt: `${system}\n\n${finalPrompt}`, quietToLoud: false, skip_w_info: true });
        } catch (e) { return null; }
    }
    if (!out) return null;
    if (wantsJson) {
        const fixed = normalizeJsonOut(out);
        if (fixed) out = fixed;
        else {
            const correctionRule =
                type === "Journal Quests"
                    ? "Your previous output was invalid. Output ONLY valid JSON: an array like [{\"title\":\"...\",\"desc\":\"...\"}]. No markdown, no extra text."
                    : "Your previous output was invalid. Output ONLY a single valid JSON object. No markdown, no extra text.";
            const correction = `${finalPrompt}\n\n[CORRECTION]\n${correctionRule}`;
            try {
                if (useTurbo) out = await generateTurbo(correction, system);
                else out = await generateRaw({ prompt: `${system}\n\n${correction}`, quietToLoud: false, skip_w_info: true });
            } catch (_) {}
            const fixed2 = normalizeJsonOut(out);
            if (fixed2) out = fixed2;
        }
    }
    try {
        const vr = validateResponse ? validateResponse(out) : null;
        const issues = Array.isArray(vr?.issues) ? vr.issues : [];
        if (issues.length) console.warn("[UIE] LogicEnforcer issues:", issues);
        const baseOut = String(vr?.text ?? out);
        if (type !== "Webpage" && !wantsJson) return stripHtmlAndCss(baseOut);
        return baseOut;
    } catch (_) {
        if (type !== "Webpage" && !wantsJson) return stripHtmlAndCss(out);
        return out;
    }
    } finally {
        sysGate.release();
    }
}

export function cleanOutput(text) {
    if (!text) return "";
    return text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}

/* UIE turbo switch (extension-only) */
function uieTurboEnabled() {
  try {
    const st = window?.UIE?.getSettings?.() || null;
    if (!st) return false;
    return !!(st.uieTurbo && st.uieTurbo.enabled && st.uieTurbo.key);
  } catch (_) {
    return false;
  }
}
