import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "../../../../../extensions.js"; 
import { injectRpEvent } from "./features/rp_log.js";
import { notify } from "./notifications.js";
import { checkAndGenerateImage } from "./imageGen.js";

let callTimerInt = null;
let activeContact = null; // Tracks who we are texting
let dialBuf = "";
let chatClock = null;
let arrivalObserver = null;
let arrivalLastMesId = null;
let callChatContext = "";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPersonaName() {
    try {
        const ctx = getContext?.();
        return String(ctx?.name1 || "You").trim() || "You";
    } catch (_) {
        return "You";
    }
}

function getSocialMemoryBlockForName(targetName, maxItems = 8) {
    const s = getSettings();
    const nm = String(targetName || "").trim().toLowerCase();
    if (!nm) return "";
    const all = ["friends", "romance", "family", "rivals"].flatMap(k => (s?.social?.[k] || []));
    const p = all.find(x => String(x?.name || "").trim().toLowerCase() === nm);
    const aff = Math.max(0, Math.min(100, Number(p?.affinity ?? 50)));
    const disp = (() => {
        if (aff <= 10) return "Hostile";
        if (aff <= 25) return "Wary";
        if (aff <= 45) return "Cold";
        if (aff <= 60) return "Neutral";
        if (aff <= 75) return "Warm";
        if (aff <= 90) return "Friendly";
        return "Devoted";
    })();
    const talkCap = (() => {
        if (aff <= 10) return 25;
        if (aff <= 25) return 40;
        if (aff <= 45) return 55;
        if (aff <= 60) return 70;
        if (aff <= 75) return 85;
        if (aff <= 90) return 92;
        return 100;
    })();
    const mems = Array.isArray(p?.memories) ? p.memories.slice() : [];
    if (!mems.length) return "";
    mems.sort((a, b) => Number(b?.t || 0) - Number(a?.t || 0));
    const who = getPersonaName();
    const lines = mems.slice(0, Math.max(1, Number(maxItems || 8))).map(m => `- ${String(m?.text || "").trim()}${m?.impact ? ` (Impact: ${String(m.impact).trim()})` : ""}`).filter(Boolean);
    if (!lines.length) return "";
    return `\n[RELATIONSHIP STATE]\nNPC: ${targetName}\nAffinity: ${aff}/100\nDisposition: ${disp}\nTalk-only cap: ${talkCap}/100 (words alone cannot exceed this; action is required beyond)\nRules: hostile NPCs do not de-escalate from words alone; compliments/manipulation can backfire.\n[/RELATIONSHIP STATE]\n\nVITAL SOCIAL MEMORIES (${targetName}'s memory of ${who}):\n${lines.join("\n")}\n`;
}

function getCharacterCardBlock(maxLen = 2200) {
    try {
        const ctx = getContext?.();
        const candidate =
            ctx?.character ||
            ctx?.char ||
            ctx?.characterCard ||
            (Array.isArray(ctx?.characters) ? ctx.characters[0] : null) ||
            null;
        const card = candidate?.data?.data || candidate?.data || candidate || {};

        const name = String(card?.name || candidate?.name || ctx?.name2 || "").trim();
        const description = String(card?.description || card?.desc || "").trim();
        const personality = String(card?.personality || "").trim();
        const scenario = String(card?.scenario || "").trim();
        const firstMes = String(card?.first_mes || card?.firstMessage || "").trim();
        const mesExample = String(card?.mes_example || card?.example_dialogue || card?.exampleDialogue || "").trim();
        const tags = Array.isArray(card?.tags) ? card.tags.map(t => String(t || "").trim()).filter(Boolean) : [];

        const lines = [];
        if (name) lines.push(`Name: ${name}`);
        if (description) lines.push(`Description: ${description}`);
        if (personality) lines.push(`Personality: ${personality}`);
        if (scenario) lines.push(`Scenario: ${scenario}`);
        if (firstMes) lines.push(`First Message: ${firstMes}`);
        if (mesExample) lines.push(`Example Dialogue: ${mesExample}`);
        if (tags.length) lines.push(`Tags: ${tags.slice(0, 20).join(", ")}`);

        return lines.join("\n").slice(0, maxLen);
    } catch (_) {
        return "";
    }
}

function getThreadTail(name, max = 10) {
    try {
        const s = getSettings();
        const list = (s.phone?.smsThreads && Array.isArray(s.phone.smsThreads[name])) ? s.phone.smsThreads[name] : [];
        return list.slice(-max).map(m => `${m.isUser ? getPersonaName() : name}: ${String(m.text || "").slice(0, 220)}`).join("\n");
    } catch (_) {
        return "";
    }
}

function shouldLogPhoneToChat() {
    return true;
}

function sanitizePhoneLine(text, maxLen = 600) {
    let t = String(text || "");
    t = t.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "");
    t = t.replace(/^[\s"'“”‘’]+|[\s"'“”‘’]+$/g, "");
    t = t.replace(/\*[^*]{0,400}\*/g, " ");
    t = t.replace(/\[[^\]]{0,400}\]/g, " ");
    t = t.replace(/\([^)]{0,400}\)/g, " ");
    t = t.replace(/\b(narration|scene|action|stage directions)\s*:\s*/gi, "");
    t = t.replace(/\s*\n+\s*/g, " ");
    t = t.replace(/\s{2,}/g, " ").trim();
    if (!t) return "";
    return t.slice(0, maxLen);
}

function cleanOutput(text, type) {
    if(!text) return "";
    let clean = text.trim();
    clean = clean.replace(/^```[a-z]*\s*/i, "").replace(/```$/g, "");
    if (type === "web") {
        if (clean.startsWith("# ")) clean = "<h1>" + clean.substring(2) + "</h1>";
        const match = clean.match(/<(div|style|body|html|header|nav|main|h1|h2|p)/i);
        if (match && match.index > -1) clean = clean.substring(match.index);
        else clean = `<div style="padding:20px; text-align:center; font-family:sans-serif;">${clean}</div>`;
    } else if (type === "json") {
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start > -1 && end > -1) clean = clean.substring(start, end + 1);
        else clean = "{}";
    } 
    return clean;
}

function syncToMainChat(actionDescription) {
    try {
        injectRpEvent(String(actionDescription || ""), { uie: { type: "phone" } });
    } catch (_) {}
}

export function initPhone() {
    $(document).off("click.phone change.phone input.phone keypress.phone");
    
    // BIND OPEN BUTTON (Fix for "Can't Open")
    $(document).off("click", "#btn-phn").on("click", "#btn-phn", () => {
        $("#uie-phone-window").fadeToggle(200);
    });

    const parseChatTimestamp = () => {
        try {
            const chat = document.querySelector("#chat");
            if (!chat) return null;

            const last =
                chat.querySelector(".mes:last-child") ||
                chat.querySelector(".mes")?.parentElement?.lastElementChild ||
                chat.lastElementChild;
            if (!last) return null;

            const timeEl =
                last.querySelector("time") ||
                last.querySelector(".timestamp") ||
                last.querySelector(".mes_time") ||
                last.querySelector(".mes__time") ||
                last.querySelector("[data-timestamp]") ||
                last.querySelector("[datetime]");

            const raw =
                (timeEl && (timeEl.getAttribute("datetime") || timeEl.getAttribute("data-timestamp") || timeEl.textContent)) ||
                last.getAttribute("data-timestamp") ||
                last.getAttribute("datetime") ||
                "";

            const txt = String(raw || "").trim();
            if (!txt) return null;

            const ms = Date.parse(txt);
            if (!Number.isNaN(ms)) return new Date(ms);

            const m = txt.match(/(\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
            if (m) {
                let hh = Number(m[1]);
                const mm = Number(m[2]);
                const ap = (m[3] || "").toUpperCase();
                if (ap === "PM" && hh < 12) hh += 12;
                if (ap === "AM" && hh === 12) hh = 0;
                const now = new Date();
                now.setHours(hh, mm, 0, 0);
                return now;
            }
        } catch (_) {}
        return null;
    };

    const updateClock = () => {
        const fromChat = parseChatTimestamp();
        if (fromChat) chatClock = { base: fromChat.getTime(), at: Date.now() };

        const now = chatClock ? new Date(chatClock.base + (Date.now() - chatClock.at)) : new Date();
        const time12 = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
        const parts = String(time12 || "").trim().split(/\s+/);
        const tMain = parts[0] || now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const tAmPm = (parts[1] || "").toUpperCase();
        const date = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
        $(".uie-phone-clock").text(tMain);
        const $timeLg = $(".uie-phone-clock-time-lg");
        const $ampmLg = $(".uie-phone-clock-ampm-lg");
        if ($timeLg.length && $ampmLg.length) {
            $timeLg.text(tMain);
            $ampmLg.text(tAmPm || "AM");
        } else {
            $(".uie-phone-clock-lg").text(tAmPm ? `${tMain} ${tAmPm}` : tMain);
        }
        $(".uie-phone-date").text(date);
    };
    updateClock();
    setInterval(updateClock, 15000);

    const getChatSnippet = (n = 20) => {
        try {
            let raw = "";
            const $txt = $(".chat-msg-txt");
            if ($txt.length) {
                $txt.slice(-Math.max(1, Number(n) || 20)).each(function () { raw += $(this).text() + "\n"; });
                return raw.trim().slice(0, 5200);
            }
            const chatEl = document.querySelector("#chat");
            if (!chatEl) return "";
            const msgs = Array.from(chatEl.querySelectorAll(".mes")).slice(-Math.max(1, Number(n) || 20));
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
                raw += `${isUser ? "You" : "Story"}: ${String(t).trim()}\n`;
            }
            return raw.trim().slice(0, 5200);
        } catch (_) {
            return "";
        }
    };

    const scheduleArrival = (who, turns = 1, reason = "") => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
        const eta = Math.max(1, Math.min(2, Number(turns) || 1));
        s.phone.arrivals.push({ id: Date.now(), who: String(who || "Someone"), etaTurns: eta, reason: String(reason || "").slice(0, 200) });
        saveSettings();
    };

    const tickArrivalsOnAssistantTurn = async () => {
        const s = getSettings();
        if (!s?.phone?.arrivals || !Array.isArray(s.phone.arrivals) || !s.phone.arrivals.length) return;
        let changed = false;
        for (const a of s.phone.arrivals) {
            if (typeof a.etaTurns !== "number") a.etaTurns = 1;
            a.etaTurns -= 1;
            changed = true;
        }
        const due = s.phone.arrivals.filter(a => a.etaTurns <= 0);
        s.phone.arrivals = s.phone.arrivals.filter(a => a.etaTurns > 0);
        if (changed) saveSettings();
        for (const a of due) {
            const who = String(a.who || "Someone");
            const why = String(a.reason || "").trim();
            const msg = why ? `${who} arrives. (${why})` : `${who} arrives.`;
            await injectRpEvent(msg, { uie: { type: "arrival", who, why } });
        }
    };

    // --- STRICT PHONE TRIGGER WATCHER ---
    const scanForPhoneEvents = async () => {
        const s = getSettings();
        if (s?.phone && s.phone.allowCalls === false && s.phone.allowTexts === false) return;

        const chatEl = document.querySelector("#chat");
        if (!chatEl) return;
        const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
        if (!last) return;

        // Only scan AI messages
        const isUser =
            last.classList?.contains("is_user") ||
            last.getAttribute("is_user") === "true" ||
            last.getAttribute("data-is-user") === "true";
        if (isUser) return;

        const id = last.getAttribute("mesid") || last.getAttribute("data-id") || last.textContent.substring(0, 20);
        if (id === arrivalLastMesId) return; // Re-using this var to track last processed message
        arrivalLastMesId = id;

        const lastText =
            last.querySelector(".mes_text")?.textContent ||
            last.querySelector(".mes-text")?.textContent ||
            last.textContent ||
            "";
        const txt = String(lastText || "").trim();
        if (!txt) return;

        const callTag = txt.match(/\[\s*UIE_CALL\s*:\s*([^\]]+?)\s*\]/i);
        const textTag = txt.match(/\[\s*UIE_TEXT\s*:\s*([^|\]]+?)\s*\|\s*([^\]]+?)\s*\]/i);
        const callPlain = txt.match(/call\s+incoming\s*(?:from)?\s*[:\-]?\s*([A-Za-z0-9 _'".-]{2,60})/i);
        const textPlain = txt.match(/new\s+message\s*(?:from)?\s*[:\-]?\s*([A-Za-z0-9 _'".-]{2,60})\s*[:\-]\s*([\s\S]{1,600})/i);

        if (callTag || callPlain) {
            if (s?.phone?.allowCalls === false) return;
            const who = String((callTag ? callTag[1] : callPlain[1]) || "Unknown").trim().slice(0, 80);
            notify("info", `Incoming call from ${who}`, "Phone", "phoneCalls");
            window.UIE_phone_incomingCall(who);
            return;
        }

        if (textTag || textPlain) {
            if (s?.phone?.allowTexts === false) return;
            const who = String((textTag ? textTag[1] : textPlain[1]) || "Unknown").trim().slice(0, 80);
            const body = String((textTag ? textTag[2] : textPlain[2]) || "").trim().slice(0, 1200);
            if (!body) return;
            notify("info", `New message from ${who}`, "Phone", "phoneMessages");
            window.UIE_phone_incomingText(who, body);
        }
    };

    const startArrivalWatcher = () => {
        if (arrivalObserver) return;
        const chatEl = document.querySelector("#chat");
        if (!chatEl) return;

        arrivalObserver = new MutationObserver(async () => {
            const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
            if (!last) return;
            
            // Run Arrival Logic
            const isUser =
                last.classList?.contains("is_user") ||
                last.getAttribute("is_user") === "true" ||
                last.getAttribute("data-is-user") === "true";
            if (!isUser) {
                await tickArrivalsOnAssistantTurn();
                // Run Phone Event Scan
                setTimeout(scanForPhoneEvents, 1500); // Small delay to let text settle
            }
        });
        arrivalObserver.observe(chatEl, { childList: true, subtree: false });
    };

    const loadPhoneVisuals = () => {
        const s = getSettings();
        if(!s.phone) s.phone = { bg: "", lockBg: "", pin: "", deviceSkin: "classic", unlockedDevices: ["classic"], customApps: [], bookmarks: [], browser: { pages: {}, history: [], index: -1 }, smsThreads: {}, arrivals: [], blockedContacts: [], numberBook: [] };
        if(!s.social) s.social = { friends: [], stats: {} }; 
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        if(!s.phone.browser.pages) s.phone.browser.pages = {};
        if(!Array.isArray(s.phone.browser.history)) s.phone.browser.history = [];
        if(typeof s.phone.browser.index !== "number") s.phone.browser.index = -1;
        if(!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        if(!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        try {
            const wp = s.phone.windowPos || null;
            const x = Number(wp?.x);
            const y = Number(wp?.y);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                const el = document.getElementById("uie-phone-window");
                const w = el?.getBoundingClientRect?.().width || Math.min(380, vw * 0.95);
                const h = el?.getBoundingClientRect?.().height || Math.min(vh * 0.9, 900);
                const clampedX = Math.max(0, Math.min(x, Math.max(0, vw - w)));
                const clampedY = Math.max(0, Math.min(y, Math.max(0, vh - h)));
                $("#uie-phone-window").css({ left: clampedX, top: clampedY, transform: "none" });
            }
        } catch (_) {}
        
        if(s.phone.bg) $("#uie-phone-window").css("background-image", `url('${s.phone.bg}')`);
        if(s.phone.lockBg) $("#uie-phone-lockscreen").css("background-image", `url('${s.phone.lockBg}')`).css("background-size","cover").css("background-position","center");
        else $("#uie-phone-lockscreen").css("background-image", "");

        $("#uie-phone-window").attr("data-device", String(s.phone.deviceSkin || "classic"));
        const skin = String(s.phone.deviceSkin || "classic");
        const theme = skin === "onyx"
            ? { accent:"#f1c40f", glass:"rgba(0,0,0,0.35)", surface:"rgba(10,12,18,0.78)", surface2:"rgba(10,12,18,0.92)", text:"#ffffff" }
            : skin === "notch"
                ? { accent:"#cba35c", glass:"rgba(0,0,0,0.30)", surface:"rgba(14,12,10,0.75)", surface2:"rgba(14,12,10,0.90)", text:"#ffffff" }
                : { accent:"#007aff", glass:"rgba(0,0,0,0.28)", surface:"rgba(11,16,28,0.74)", surface2:"rgba(11,16,28,0.90)", text:"#ffffff" };
        const bubbleColors = s.phone.bubbleColors || {};
        const sentColor = String(bubbleColors.sent || theme.accent);
        const recvColor = String(bubbleColors.received || "").trim() || "#ffffff";
        $("#uie-phone-custom-css").text(`
            #uie-phone-window .phone-screen { background: transparent; }
            #uie-phone-window #uie-phone-homescreen { background: linear-gradient(180deg, ${theme.glass}, rgba(0,0,0,0.05)); }
            #uie-phone-window .phone-status-bar { background: ${theme.glass}; }
            #uie-phone-window .phone-app-header { background: ${theme.surface}; border-bottom: 1px solid rgba(255,255,255,0.10); color:${theme.text}; }
            #uie-phone-window .phone-app-content { background: ${theme.surface2}; color:${theme.text}; }
            #uie-phone-window .phone-nav-bar { background: ${theme.surface}; border-top: 1px solid rgba(255,255,255,0.10); }
            #uie-phone-window .p-nav-btn { color: rgba(255,255,255,0.88); }
            #uie-phone-window .p-browser-bar { background: ${theme.surface}; border-bottom: 1px solid rgba(255,255,255,0.10); }
            #uie-phone-window #p-browser-url { background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.12); color: ${theme.text}; }
            #uie-phone-window #p-browser-go { color: ${theme.accent}; }
            #uie-phone-window #p-browser-content { background: #fff; color:#222; }
            #uie-phone-window .p-input-area{ display:flex; gap:8px; padding:10px; padding-bottom: calc(10px + env(safe-area-inset-bottom)); background:${theme.surface}; border-top:1px solid rgba(255,255,255,0.10); position:sticky; bottom:0; z-index:5; align-items:flex-end; }
            #uie-phone-window #msg-input{ background: rgba(0,0,0,0.18); border:1px solid rgba(255,255,255,0.12); color:${theme.text}; min-height:40px; border-radius:18px; padding:10px 14px; outline:none; pointer-events:auto; line-height:1.35; }
            #uie-phone-window #msg-input::placeholder{ color: rgba(255,255,255,0.6); }
            #uie-phone-window #msg-send-btn{ background:${theme.accent}; color:#000; border:none; border-radius:999px; width:44px; height:40px; display:grid; place-items:center; cursor:pointer; }
            #uie-phone-window #contact-add-manual{ position:relative; z-index:6; padding:10px; margin:-10px -6px -10px 0; }
            #uie-phone-window .p-msg-list{ padding: 10px 10px 0 10px; gap:10px; }
            #uie-phone-window .p-bubble{ max-width: 86%; padding:10px 12px; border-radius:14px; line-height:1.35; font-size:13px; border:1px solid rgba(255,255,255,0.10); }
            #uie-phone-window .p-bubble.sent{ margin-left:auto; background: ${sentColor}; border-color: rgba(255,255,255,0.10); color:${theme.text}; }
            #uie-phone-window .p-bubble.received{ margin-right:auto; background: ${recvColor}; border-color: rgba(0,0,0,0.10); color:#111; }
            #uie-phone-window #msg-block{ color: rgba(255,255,255,0.85); }
            #uie-phone-window #msg-block.blocked{ color: #f38ba8; }
        `);
        
        if(s.phone.pin && s.phone.pin.length > 0) {
            $("#uie-phone-pin").show().val(""); 
            $("#uie-phone-unlock-btn").text("Enter PIN");
        } else {
            $("#uie-phone-pin").hide();
            $("#uie-phone-unlock-btn").text("Swipe / Tap to Unlock");
        }
        
        $(".custom-app-icon").remove(); 
        if(s.phone.customApps) {
            s.phone.customApps.forEach(app => {
                $("#uie-phone-grid").append(`
                    <div class="phone-app-icon custom-app-icon" data-id="${app.id}" style="background:${app.color}; color:#fff;">
                        <i class="${app.icon}"></i>
                        <div class="custom-app-delete" title="Delete">x</div>
                    </div>
                `);
            });
        }
    };

    const openApp = (id) => {
        try {
            const s = getSettings();
            if (s?.phone) {
                s.phone.activeApp = String(id || "");
                const name =
                    id === "#uie-app-msg-view" ? "Messages" :
                    id === "#uie-app-dial-view" ? "Phone" :
                    id === "#uie-app-browser-view" ? "Browser" :
                    id === "#uie-app-contacts-view" ? "Contacts" :
                    id === "#uie-app-store-view" ? "App Builder" :
                    id === "#uie-app-settings-view" ? "Phone Settings" :
                    id === "#uie-app-books-view" ? "Books" :
                    id === "#uie-app-calc-view" ? "Calculator" :
                    id === "#uie-app-cookies-view" ? "Cookies" :
                    id === "#uie-call-screen" ? "Call" :
                    "Phone";
                s.phone.activeAppName = name;
            }
        } catch (_) {}
        $(".phone-app-window").hide();
        $("#uie-phone-homescreen").hide();
        $(id).css("display", "flex").hide().fadeIn(150);
        
        if(id === "#uie-app-contacts-view") renderContacts();
        if(id === "#uie-app-msg-view") {
            // Default header if not set via contact click
            if(!activeContact) $("#msg-contact-name").text("Messages");
            else $("#msg-contact-name").text(activeContact);
            renderMessages();
        }
        if(id === "#uie-app-store-view") renderAppStore();
        if(id === "#uie-app-books-view") renderBooks();
        if(id === "#uie-app-browser-view") renderBrowserHome();
        if(id === "#uie-app-cookies-view") renderCookies();
        if(id === "#uie-app-settings-view") {
            const s2 = getSettings();
            if (!s2.phone) s2.phone = {};
            $("#p-set-pin").val(String(s2.phone.pin || ""));
            $("#p-allow-calls").prop("checked", s2.phone.allowCalls !== false);
            $("#p-allow-texts").prop("checked", s2.phone.allowTexts !== false);
            const bc = s2.phone.bubbleColors || {};
            $("#p-bubble-sent").val(String(bc.sent || "#f1c40f"));
            $("#p-bubble-recv").val(String(bc.received || "#111111"));
        }
    };

    const goHome = () => {
        const wasBrowserOpen = $("#uie-app-browser-view").is(":visible");
        $(".phone-app-window").hide();
        $("#uie-app-browser-view").removeClass("browser-app-mode");
        $("#uie-phone-homescreen").css("display", "flex").hide().fadeIn(150);
        activeContact = null; // Reset selection on home
        try {
            const s = getSettings();
            if (s?.phone) {
                s.phone.activeApp = "home";
                s.phone.activeAppName = "Home";
            }
        } catch (_) {}
        if (wasBrowserOpen) {
            try { $("#p-browser-url").val(""); } catch (_) {}
            try { renderBrowserHome(); } catch (_) {}
        }
    };

    // --- MESSAGING LOGIC ---
    const getThread = (name) => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        const key = String(name || "").trim() || "_unknown";
        if(!Array.isArray(s.phone.smsThreads[key])) s.phone.smsThreads[key] = [];
        return { s, key, list: s.phone.smsThreads[key] };
    };

    const norm = (x) => String(x || "").trim();
    const isBlocked = (s, name) => {
        const n = norm(name).toLowerCase();
        if (!n) return false;
        const list = Array.isArray(s?.phone?.blockedContacts) ? s.phone.blockedContacts : [];
        return list.some(x => String(x || "").trim().toLowerCase() === n);
    };
    const setBlocked = (s, name, blocked) => {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        const n = norm(name);
        if (!n) return;
        const low = n.toLowerCase();
        s.phone.blockedContacts = s.phone.blockedContacts
            .map(x => String(x || "").trim())
            .filter(Boolean)
            .filter(x => x.toLowerCase() !== low);
        if (blocked) s.phone.blockedContacts.push(n);
    };

    const normalizeNumber = (n) => String(n || "").replace(/[^\d]/g, "").slice(0, 15);
    const formatNumber = (n) => {
        const d = normalizeNumber(n);
        if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
        if (d.length === 7) return `${d.slice(0,3)}-${d.slice(3)}`;
        return d || "—";
    };
    const generateNumber = (used) => {
        const u = used || new Set();
        for (let i = 0; i < 200; i++) {
            const a = 200 + Math.floor(Math.random() * 800);
            const b = 100 + Math.floor(Math.random() * 900);
            const c = 1000 + Math.floor(Math.random() * 9000);
            const digits = `${a}${b}${c}`;
            if (!u.has(digits)) return digits;
        }
        return String(Date.now()).slice(-10);
    };
    const SOCIAL_BUCKETS = ["friends", "romance", "family", "rivals"];
    const getSocialPeople = (s) => {
        const out = [];
        const social = s?.social && typeof s.social === "object" ? s.social : {};
        for (const k of SOCIAL_BUCKETS) {
            const arr = Array.isArray(social?.[k]) ? social[k] : [];
            for (const p of arr) {
                if (!p || typeof p !== "object") continue;
                const name = String(p.name || "").trim();
                if (!name) continue;
                out.push(p);
            }
        }
        return out;
    };
    const ensureNumbersState = (s) => {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];
        if (!s.social) s.social = {};
        for (const k of SOCIAL_BUCKETS) if (!Array.isArray(s.social[k])) s.social[k] = [];
    };
    const ensureContactNumbers = (s) => {
        ensureNumbersState(s);
        const used = new Set();
        for (const p of getSocialPeople(s)) {
            const d = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (d) used.add(d);
        }
        for (const nb of (s.phone.numberBook || [])) {
            const d = normalizeNumber(nb?.number || "");
            if (d) used.add(d);
        }
        let changed = false;
        for (const p of getSocialPeople(s)) {
            const cur = normalizeNumber(p?.phone || p?.phoneNumber || "");
            if (cur) continue;
            const digits = generateNumber(used);
            used.add(digits);
            p.phone = formatNumber(digits);
            changed = true;
        }
        if (changed) saveSettings();
    };

    const renderMessages = () => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        if(!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
        if(!Array.isArray(s.phone.blockedContacts)) s.phone.blockedContacts = [];
        if(!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];

        const container = $("#msg-container");
        container.empty();

        const $inputArea = $("#uie-app-msg-view .p-input-area");
        const $header = $("#msg-contact-name");
        const blocked = !!(activeContact && isBlocked(s, activeContact));
        $("#msg-block").toggle(!!activeContact);
        $("#msg-block").toggleClass("blocked", blocked);

        if(!activeContact) {
            $header.text("Messages");
            $inputArea.hide();

            const keys = Object.keys(s.phone.smsThreads || {})
                .filter(k => Array.isArray(s.phone.smsThreads[k]) && s.phone.smsThreads[k].length)
                .filter(k => !isBlocked(s, k));
            if(!keys.length) {
                container.html(`
                    <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:#333; opacity:0.7;">
                        <i class="fa-regular fa-comments" style="font-size:3em; margin-bottom:10px;"></i>
                        <span style="font-size:1.2em; font-weight:900;">No Conversations</span>
                        <div style="margin-top:8px; font-size:0.9em;">Open Contacts to start a text.</div>
                    </div>
                `);
                return;
            }

            keys.slice(0, 60).forEach(k => {
                const t = s.phone.smsThreads[k];
                const last = t[t.length - 1];
                container.append(`
                    <div class="contact-row" data-thread="${esc(k)}" style="display:flex; align-items:center; padding:15px; border-bottom:1px solid #eee; cursor:pointer;">
                        <div class="contact-avatar" style="width:40px; height:40px; background:#ddd; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:15px; font-weight:bold; color:#555;">${esc(k).charAt(0)}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:900; color:#222;">${esc(k)}</div>
                            <div style="opacity:0.7; font-size:0.85em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(last?.text || "")}</div>
                        </div>
                    </div>
                `);
            });
            return;
        }

        $header.text(String(activeContact));
        if (blocked) {
            $inputArea.hide();
            container.append(`<div style="padding:12px; margin:10px; border-radius:10px; border:1px solid rgba(243,139,168,0.35); background:rgba(243,139,168,0.12); color:#f38ba8; font-weight:900;">Blocked contact</div>`);
        } else {
            $inputArea.show();
        }

        const { list } = getThread(activeContact);
        if (!list.length) {
            container.html(`<div style="padding:20px; text-align:center; opacity:0.65;">No texts with ${esc(activeContact)} yet.</div>`);
            return;
        }

        list.forEach((m, idx) => {
            const cls = m.isUser ? "sent" : "received";
            const text = String(m.text || "");
            const img = String(m.image || "");
            const preview = img ? `<div style="margin-bottom:${text ? "8px" : "0"};"><img src="${esc(img)}" style="max-width:220px; width:100%; height:auto; border-radius:12px; display:block; border:1px solid rgba(255,255,255,0.10);"></div>` : "";
            const body = text ? `<div style="white-space:pre-wrap; word-break:break-word;">${esc(text)}</div>` : "";
            const del = `<button class="msg-del" data-mid="${idx}" title="Delete" style="position:absolute; top:6px; right:6px; width:20px; height:20px; border-radius:8px; border:1px solid rgba(0,0,0,0.10); background:rgba(255,255,255,0.55); color:#111; cursor:pointer; opacity:0.55; display:grid; place-items:center;"><i class="fa-solid fa-trash" style="font-size:10px;"></i></button>`;
            container.append(`<div class="p-bubble ${cls}" data-mid="${idx}" style="position:relative;">${del}${preview}${body}</div>`);
        });
        container.scrollTop(container.prop("scrollHeight"));
    };
    
    $(document).off("click.phoneMsgSend", "#msg-send-btn");
    $(document).on("click.phoneMsgSend", "#msg-send-btn", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const t = String($("#msg-input").val() || "");
        if(!t.trim()) return;
        
        // If no contact selected, check Social for a default or prompt
        let targetName = activeContact;
        if(!targetName) {
            const s = getSettings();
            if(s.social.friends.length > 0) targetName = s.social.friends[0].name; // Default to first friend
            else targetName = "Unknown";
        }
        const sBlock = getSettings();
        if (isBlocked(sBlock, targetName)) {
            notify("warning", "That contact is blocked.", "Messages", "phoneMessages");
            $("#msg-input").val("");
            renderMessages();
            return;
        }

        const th = getThread(targetName);
        const msgObj = { isUser: true, text: t, ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        $("#msg-input").val("");
        try { $("#msg-input").css("height", ""); } catch (_) {}
        notify("success", "Message sent.", "Messages", "phoneMessages");
        try {
            const inj = await injectRpEvent(`(Text) ${getPersonaName()} → ${targetName}: "${String(t).slice(0, 500)}"`, { uie: { type: "phone_text", who: targetName } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}

        const s2 = getSettings();
        const allow = !!(s2?.ai?.phoneMessages);
        if (!allow) return;

        const chat = getChatSnippet(50);
        const lore = (() => { try { const ctx = getContext?.(); const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo; const keys=[]; if(Array.isArray(maybe)){ for(const it of maybe){ const k=it?.key||it?.name||it?.title; if(k) keys.push(String(k)); } } return Array.from(new Set(keys)).slice(0, 60).join(", "); } catch(_) { return ""; } })();
        const character = (() => { try { const ctx = getContext?.(); return JSON.stringify({ user: ctx?.name1, character: ctx?.name2, chatId: ctx?.chatId, characterId: ctx?.characterId, groupId: ctx?.groupId }); } catch(_) { return "{}"; } })();
        const threadTail = getThreadTail(targetName, 10);
        const persona = getPersonaName();
        const card = getCharacterCardBlock(2600);
        const mem = getSocialMemoryBlockForName(targetName, 8);
        const prompt = `
Phone Text Rules:
- You are ${targetName} replying by text to ${persona}.
- Stay strictly in-character and consistent with the chat context; do not invent sudden personality changes.
- Reply MUST be a realistic text message (short).
- ABSOLUTE RULE: no narration, no scene description, no roleplay formatting, no quotes.
- Do NOT include: asterisks (*like this*), brackets [like this], parentheses (like this), or prefixes like "${targetName}:".
- Decide based on CONTEXT; if uncertain, keep the reply short or choose no reply.
- If the user asks ${targetName} to come over / meet up and ${targetName} agrees, set arrivalInTurns to 1 or 2.
- If you cannot comply with the formatting rules, set willReply=false.

Return ONLY JSON:
{
  "hasPhone": true,
  "willReply": true,
  "reply": "short realistic text reply (no narration)",
  "reason": "why they did/didn't reply (busy/kidnapped/no phone/etc)",
  "arrivalInTurns": 0,
  "arrivalReason": ""
}

TEXT SENT: "${t}"
TARGET: "${targetName}"
RECENT TEXT THREAD:
${threadTail}
<character_card>
${card}
</character_card>
${mem}
CONTEXT (recent chat, trimmed):
${chat}`.slice(0, 6000);

        try {
            const res = await generateContent(prompt, "System Check");
            const logic = JSON.parse(cleanOutput(res, "json"));

            if(logic.willReply) {
                setTimeout(async () => {
                    const th2 = getThread(targetName);
                    const replyText = sanitizePhoneLine(String(logic.reply || ""), 500);
                    if (!replyText) return;
                    const replyObj = { isUser: false, text: replyText, ts: Date.now() };
                    try {
                        const sImg = getSettings();
                        const img = await checkAndGenerateImage(`Phone text from ${targetName}:\n${replyText.slice(0, 800)}`, "msg");
                        if (img) replyObj.image = img;
                    } catch (_) {}
                    th2.list.push(replyObj);
                    saveSettings();
                    if($("#uie-app-msg-view").is(":visible")) renderMessages();
                    notify("success", `${targetName} replied.`, "Messages", "phoneMessages");
                    try {
                        const inj = await injectRpEvent(`(Text) ${targetName} → ${persona}: "${replyText}"${replyObj.image ? " [Image]" : ""}`, { uie: { type: "phone_text", who: targetName } });
                        if (inj && inj.ok && inj.mesid) {
                            replyObj.chatMesId = inj.mesid;
                            saveSettings();
                        }
                    } catch (_) {}
                }, 2000);

                const turns = Number(logic.arrivalInTurns || 0);
                if (turns > 0) scheduleArrival(targetName, turns, logic.arrivalReason || "They agreed to come over.");
            }
        } catch(e) {}
    });

    $(document)
        .off("keydown.phoneMsgEnter", "#msg-input")
        .on("keydown.phoneMsgEnter", "#msg-input", function (e) {
            if (e.key !== "Enter") return;
            if (e.shiftKey) return;
            e.preventDefault();
            e.stopPropagation();
            $("#msg-send-btn").trigger("click");
        });


    $(document).off("input.phoneMsgGrow", "#msg-input").on("input.phoneMsgGrow", "#msg-input", function () {
        try {
            this.style.height = "0px";
            const max = 120;
            const h = Math.min(max, this.scrollHeight || 0);
            this.style.height = `${Math.max(40, h)}px`;
        } catch (_) {}
    });

    $(document).off("click.phoneMsgAttach", "#msg-attach-btn").on("click.phoneMsgAttach", "#msg-attach-btn", function(e){
        e.preventDefault();
        e.stopPropagation();
        $("#msg-attach-file").trigger("click");
    });
    $(document).off("change.phoneMsgAttach", "#msg-attach-file").on("change.phoneMsgAttach", "#msg-attach-file", async function(e){
        const f = (e.target.files || [])[0];
        $(this).val("");
        if (!f) return;
        if (!activeContact) return;
        const s = getSettings();
        if (isBlocked(s, activeContact)) return;
        const dataUrl = await new Promise((resolve) => {
            const r = new FileReader();
            r.onload = (ev) => resolve(String(ev?.target?.result || ""));
            r.onerror = () => resolve("");
            r.readAsDataURL(f);
        });
        if (!dataUrl) return;
        const th = getThread(activeContact);
        const msgObj = { isUser: true, text: "", image: dataUrl, ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        try {
            const inj = await injectRpEvent(`(Text) ${getPersonaName()} → ${activeContact}: [Image]`, { uie: { type: "phone_text", who: activeContact } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}
    });

    const ensurePhoneStickers = (s) => {
        if (!s.phone) s.phone = {};
        if (!s.phone.stickers) s.phone.stickers = { packs: [], active: "" };
        if (!Array.isArray(s.phone.stickers.packs)) s.phone.stickers.packs = [];
        if (!s.phone.stickers.active) s.phone.stickers.active = s.phone.stickers.packs[0]?.name || "";
    };

    const renderStickerDrawer = () => {
        const s = getSettings();
        ensurePhoneStickers(s);
        let root = document.getElementById("uie-phone-sticker-drawer");
        if (!root) {
            root = document.createElement("div");
            root.id = "uie-phone-sticker-drawer";
            root.style.cssText = "position:fixed;inset:0;z-index:2147483664;display:none;background:rgba(0,0,0,0.35);backdrop-filter:blur(10px);";
            root.innerHTML = `
              <div style="position:absolute; inset:0; display:flex; flex-direction:column; background:rgba(10,12,18,0.92); border-top:1px solid rgba(255,255,255,0.10);">
                <div style="height:52px; display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.10);">
                  <div style="font-weight:900; color:#f1c40f; letter-spacing:0.6px;">Stickers</div>
                  <button id="uie-phone-sticker-import" style="margin-left:auto; height:34px; padding:0 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06); color:#fff; font-weight:900; cursor:pointer;">Import Pack</button>
                  <button id="uie-phone-sticker-close" style="width:38px; height:34px; border-radius:12px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.18); color:#fff; font-weight:900; cursor:pointer;">×</button>
                  <input type="file" id="uie-phone-sticker-files" accept="image/*" multiple style="display:none;">
                </div>
                <div id="uie-phone-sticker-tabs" style="display:flex; gap:8px; padding:10px 12px; overflow:auto; border-bottom:1px solid rgba(255,255,255,0.10);"></div>
                <div id="uie-phone-sticker-grid" style="flex:1; min-height:0; overflow:auto; padding:12px; display:grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap:10px;"></div>
                <div id="uie-phone-sticker-empty" style="display:none; padding:18px; text-align:center; opacity:0.75; font-weight:900;">No sticker packs yet. Import one.</div>
              </div>
            `;
            document.body.appendChild(root);
        }
        const packs = s.phone.stickers.packs || [];
        const active = String(s.phone.stickers.active || "");
        const tabs = root.querySelector("#uie-phone-sticker-tabs");
        const grid = root.querySelector("#uie-phone-sticker-grid");
        const empty = root.querySelector("#uie-phone-sticker-empty");
        if (tabs) tabs.innerHTML = "";
        if (grid) grid.innerHTML = "";
        if (empty) empty.style.display = "none";

        packs.forEach(p => {
            const b = document.createElement("button");
            b.className = "uie-phone-sticker-tab";
            b.setAttribute("data-pack", String(p.name || ""));
            b.textContent = String(p.name || "Pack");
            b.style.cssText = `height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:${String(p.name||"")===active ? "rgba(241,196,15,0.18)" : "rgba(0,0,0,0.18)"};color:${String(p.name||"")===active ? "#f1c40f" : "#fff"};font-weight:900;cursor:pointer;white-space:nowrap;`;
            tabs?.appendChild(b);
        });

        const pack = packs.find(p => String(p.name || "") === active) || packs[0] || null;
        if (!pack || !Array.isArray(pack.images) || !pack.images.length) {
            if (empty) empty.style.display = "block";
            return;
        }
        (pack.images || []).slice(0, 240).forEach((im, idx) => {
            const src = String(im?.dataUrl || "");
            if (!src) return;
            const tile = document.createElement("button");
            tile.className = "uie-phone-sticker-tile";
            tile.setAttribute("data-pack", String(pack.name || ""));
            tile.setAttribute("data-idx", String(idx));
            tile.style.cssText = "border:none;background:rgba(0,0,0,0.18);border:1px solid rgba(255,255,255,0.10);border-radius:12px;overflow:hidden;padding:0;cursor:pointer;aspect-ratio:1/1;";
            tile.innerHTML = `<img src="${esc(src)}" style="width:100%;height:100%;object-fit:contain;display:block;">`;
            grid?.appendChild(tile);
        });
    };

    const openStickerDrawer = () => {
        renderStickerDrawer();
        const root = document.getElementById("uie-phone-sticker-drawer");
        if (root) root.style.display = "block";
    };

    const closeStickerDrawer = () => {
        const root = document.getElementById("uie-phone-sticker-drawer");
        if (root) root.style.display = "none";
    };

    $(document).off("click.phoneStickerOpen", "#msg-sticker-btn").on("click.phoneStickerOpen", "#msg-sticker-btn", function(e){
        e.preventDefault();
        e.stopPropagation();
        openStickerDrawer();
    });
    $(document).off("click.phoneStickerClose", "#uie-phone-sticker-close").on("click.phoneStickerClose", "#uie-phone-sticker-close", function(e){
        e.preventDefault();
        e.stopPropagation();
        closeStickerDrawer();
    });
    $(document).off("click.phoneStickerTab", ".uie-phone-sticker-tab").on("click.phoneStickerTab", ".uie-phone-sticker-tab", function(e){
        e.preventDefault();
        e.stopPropagation();
        const pack = String($(this).data("pack") || "");
        const s = getSettings();
        ensurePhoneStickers(s);
        s.phone.stickers.active = pack;
        saveSettings();
        renderStickerDrawer();
    });
    $(document).off("click.phoneStickerImport", "#uie-phone-sticker-import").on("click.phoneStickerImport", "#uie-phone-sticker-import", function(e){
        e.preventDefault();
        e.stopPropagation();
        const name = (prompt("Sticker pack name:", "My Stickers") || "").trim();
        if (!name) return;
        const root = document.getElementById("uie-phone-sticker-drawer");
        if (!root) return;
        root.setAttribute("data-import-name", name.slice(0, 60));
        const input = root.querySelector("#uie-phone-sticker-files");
        try { input?.click(); } catch (_) {}
    });
    $(document).off("change.phoneStickerFiles", "#uie-phone-sticker-files").on("change.phoneStickerFiles", "#uie-phone-sticker-files", async function(e){
        const root = document.getElementById("uie-phone-sticker-drawer");
        const name = String(root?.getAttribute("data-import-name") || "").trim();
        if (root) root.removeAttribute("data-import-name");
        const files = Array.from(e.target.files || []);
        $(this).val("");
        if (!name || !files.length) return;
        const images = [];
        for (const f of files.slice(0, 120)) {
            const fname = String(f?.name || "");
            if (!fname) continue;
            const dataUrl = await new Promise((resolve) => {
                const r = new FileReader();
                r.onload = (ev) => resolve(String(ev?.target?.result || ""));
                r.onerror = () => resolve("");
                r.readAsDataURL(f);
            });
            if (!dataUrl) continue;
            images.push({ name: fname.slice(0, 120), dataUrl });
        }
        const s = getSettings();
        ensurePhoneStickers(s);
        s.phone.stickers.packs = (s.phone.stickers.packs || []).filter(p => String(p?.name || "") !== name);
        s.phone.stickers.packs.push({ name, images });
        s.phone.stickers.active = name;
        saveSettings();
        renderStickerDrawer();
    });
    $(document).off("click.phoneStickerPick", ".uie-phone-sticker-tile").on("click.phoneStickerPick", ".uie-phone-sticker-tile", async function(e){
        e.preventDefault();
        e.stopPropagation();
        if (!activeContact) return;
        const s = getSettings();
        ensurePhoneStickers(s);
        if (isBlocked(s, activeContact)) return;
        const packName = String($(this).data("pack") || "");
        const idx = Number($(this).data("idx"));
        const pack = (s.phone.stickers.packs || []).find(p => String(p?.name || "") === packName);
        const img = pack?.images?.[idx]?.dataUrl || "";
        if (!img) return;
        const th = getThread(activeContact);
        const msgObj = { isUser: true, text: "", image: String(img), ts: Date.now() };
        th.list.push(msgObj);
        saveSettings();
        renderMessages();
        closeStickerDrawer();
        try {
            const inj = await injectRpEvent(`(Text) ${getPersonaName()} → ${activeContact}: [Sticker]`, { uie: { type: "phone_text", who: activeContact } });
            if (inj && inj.ok && inj.mesid) {
                msgObj.chatMesId = inj.mesid;
                saveSettings();
            }
        } catch (_) {}
    });

    $(document).off("click.phoneMsgThread", "#msg-container .contact-row[data-thread]").on("click.phoneMsgThread", "#msg-container .contact-row[data-thread]", function(e){
        e.preventDefault();
        e.stopPropagation();
        activeContact = String($(this).data("thread") || "");
        renderMessages();
    });

    const removeChatMes = (mesid) => {
        const id = String(mesid || "").trim();
        if (!id) return;
        try {
            const sel = `#chat .mes[mesid="${CSS.escape(id)}"], #chat .mes[data-id="${CSS.escape(id)}"]`;
            const el = document.querySelector(sel);
            if (el) el.remove();
        } catch (_) {}
    };

    $(document).off("click.phoneMsgDel", "#msg-container .msg-del").on("click.phoneMsgDel", "#msg-container .msg-del", function(e){
        e.preventDefault();
        e.stopPropagation();
        if (!activeContact) return;
        const idx = Number($(this).data("mid"));
        if (!Number.isFinite(idx)) return;
        const s = getSettings();
        const th = getThread(activeContact);
        const msg = th.list[idx];
        if (!msg) return;
        if (!confirm("Delete this text?")) return;
        th.list.splice(idx, 1);
        saveSettings();
        if (msg?.chatMesId) removeChatMes(msg.chatMesId);
        renderMessages();
    });

    $(document).off("click.phoneMsgDelThread", "#msg-del-thread").on("click.phoneMsgDelThread", "#msg-del-thread", function(e){
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if (!s) return;
        if (!s.phone) s.phone = {};
        if (!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};

        if (!activeContact) {
            if (!confirm("Delete ALL conversations?")) return;
            s.phone.smsThreads = {};
            saveSettings();
            renderMessages();
            return;
        }

        const name = String(activeContact || "").trim();
        if (!name) return;
        if (!confirm(`Delete conversation with ${name}?`)) return;
        const th = getThread(name);
        for (const m of th.list) {
            if (m?.chatMesId) removeChatMes(m.chatMesId);
        }
        delete s.phone.smsThreads[th.key];
        activeContact = null;
        saveSettings();
        renderMessages();
    });

    $(document).off("click.phoneSnoop", "#msg-snoop").on("click.phoneSnoop", "#msg-snoop", async function(e){
        e.preventDefault();
        e.stopPropagation();
        const snooper = (prompt("Who is going through your phone?") || "").trim();
        if(!snooper) return;
        const s = getSettings();
        if(!s.phone?.smsThreads) return;
        const keys = Object.keys(s.phone.smsThreads);
        const lines = [];
        for (const k of keys) {
            const list = s.phone.smsThreads[k];
            if (!Array.isArray(list) || !list.length) continue;
            const tail = list.slice(-4);
            tail.forEach(m => {
                const who = m.isUser ? "You" : k;
                lines.push(`[Text ${k}] ${who}: ${String(m.text || "").slice(0, 180)}`);
            });
        }
        if (!lines.length) return;
        await injectRpEvent(`${snooper} goes through your phone and reads your messages:\n${lines.join("\n")}`, { uie: { type: "phone_snoop", who: snooper } });
    });

    $(document).off("click.phoneMsgBlock", "#msg-block").on("click.phoneMsgBlock", "#msg-block", function(e){
        e.preventDefault();
        e.stopPropagation();
        if (!activeContact) return;
        const s = getSettings();
        const blocked = isBlocked(s, activeContact);
        setBlocked(s, activeContact, !blocked);
        saveSettings();
        notify("info", `${!blocked ? "Blocked" : "Unblocked"} ${activeContact}.`, "Messages", "phoneMessages");
        renderMessages();
    });

    // --- CONTACTS LOGIC (Fixed Buttons) ---
    const renderContacts = () => {
        const s = getSettings();
        try { ensureContactNumbers(s); } catch (_) {}
        const l = $("#contact-list");
        l.empty();

        const socialPeople = getSocialPeople(s);
        const byName = new Set(socialPeople.map(p => String(p?.name || "").trim().toLowerCase()).filter(Boolean));
        const byNum = new Set(socialPeople.map(p => normalizeNumber(p?.phone || p?.phoneNumber || "")).filter(Boolean));
        const phoneBook = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const phoneOnly = phoneBook
            .map(x => ({ name: String(x?.name || "").trim(), number: String(x?.number || "").trim() }))
            .filter(x => x.name)
            .filter(x => !byName.has(x.name.toLowerCase()) && !byNum.has(normalizeNumber(x.number)));
        const combined = [
            ...socialPeople.map(p => ({ kind: "social", name: p.name, number: formatNumber(p?.phone || p?.phoneNumber || ""), avatar: p.avatar || "" })),
            ...phoneOnly.map(p => ({ kind: "phone", name: p.name, number: formatNumber(p.number), avatar: "" }))
        ].filter(p => p?.name).filter(p => !isBlocked(s, p.name));
        
        if(!combined.length) {
            l.html('<div style="padding:30px; text-align:center; color:#aaa;">No contacts found.<br>Tap + to add one.</div>');
        } else {
            combined.forEach(p => {
                const num = String(p.number || "—");
                l.append(`
                    <div class="contact-row" data-name="${esc(p.name)}" style="display:flex; align-items:center; padding:15px; border-bottom:1px solid #eee; cursor:pointer;">
                        <div class="contact-avatar" style="width:40px; height:40px; background:#ddd; border-radius:50%; display:flex; align-items:center; justify-content:center; margin-right:15px; font-weight:bold; color:#555;">${String(p.name || "?").charAt(0)}</div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-weight:bold; color:#333; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.name}</div>
                            <div style="font-size:0.78em; opacity:0.65; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(num)}</div>
                        </div>
                        
                        <i class="fa-solid fa-comment phone-msg-trigger" data-name="${p.name}" style="color:#3498db; padding:10px; cursor:pointer; font-size:1.2em; margin-right:10px;" title="Message"></i>
                        
                        <i class="fa-solid fa-phone phone-call-trigger" data-name="${p.name}" style="color:#2ecc71; padding:10px; cursor:pointer; font-size:1.2em;" title="Call"></i>
                    </div>
                `);
            });
        }
    };

    const openThread = (name) => {
        activeContact = String(name || "").trim();
        if (!activeContact) return;
        try { getThread(activeContact); } catch (_) {}
        $("#uie-phone-window").show().css("display", "flex");
        openApp("#uie-app-msg-view");
        try { $("#msg-contact-name").text(String(activeContact || "Messages")); } catch (_) {}
        try { renderMessages(); } catch (_) {}
        try { $("#msg-input").trigger("focus"); } catch (_) {}
    };
    try { window.UIE_phone_openThread = openThread; } catch (_) {}

    $(document).off("click.phoneMsgNewNumber", "#msg-new-number").on("click.phoneMsgNewNumber", "#msg-new-number", function(e){
        e.preventDefault();
        e.stopPropagation();
        const raw = (prompt("Text which number?") || "").trim();
        if (!raw) return;
        const s = getSettings();
        ensureContactNumbers(s);
        const digits = normalizeNumber(raw);
        const formatted = formatNumber(digits);
        const friends = Array.isArray(s?.social?.friends) ? s.social.friends : [];
        const hit = friends.find(p => normalizeNumber(p?.phone || p?.phoneNumber || "") === digits);
        if (hit?.name) {
            openThread(hit.name);
            return;
        }
        const name = (prompt("Name (optional):") || "").trim();
        if (name) {
            ensureNumbersState(s);
            s.phone.numberBook = (s.phone.numberBook || []).filter(x => normalizeNumber(x?.number || "") !== digits);
            s.phone.numberBook.push({ name: name.slice(0, 60), number: formatted, ts: Date.now() });
            saveSettings();
            openThread(name);
            return;
        }
        openThread(formatted);
    });

    $(document).off("click.phoneContactRow", "#contact-list .contact-row").on("click.phoneContactRow", "#contact-list .contact-row", function (e) {
        if ($(e.target).closest(".phone-msg-trigger, .phone-call-trigger").length) return;
        e.preventDefault();
        e.stopPropagation();
        openThread($(this).data("name"));
    });

    // TRIGGER MESSAGE FROM CONTACT
    $(document).on("click.phone", ".phone-msg-trigger", function(e) {
        e.stopPropagation();
        e.preventDefault();
        openThread($(this).data("name"));
    });

    const promptAddContact = () => {
        const n = (prompt("Enter Name for new contact:") || "").trim();
        if(!n) return;
        const s = getSettings();
        ensureNumbersState(s);
        const allSocial = getSocialPeople(s);
        const existsSocial = allSocial.some(p => String(p?.name || "").trim().toLowerCase() === n.toLowerCase());
        const existsPhone = (s.phone.numberBook || []).some(p => String(p?.name || "").trim().toLowerCase() === n.toLowerCase());
        if (existsSocial || existsPhone) { alert("Contact already exists!"); return; }
        const raw = (prompt("Number (optional):") || "").trim();
        const digits = raw ? normalizeNumber(raw) : generateNumber(new Set((s.phone.numberBook || []).map(x => normalizeNumber(x?.number || "")).filter(Boolean)));
        const formatted = formatNumber(digits);
        s.phone.numberBook.push({ name: n.slice(0, 60), number: formatted, ts: Date.now() });
        saveSettings();
        renderContacts();
    };
    $(document).on("click.phone", "#contact-add-manual", (e) => { e.preventDefault(); e.stopPropagation(); promptAddContact(); });
    $(document).on("click.phone", "#contact-add-fab", (e) => { e.preventDefault(); e.stopPropagation(); promptAddContact(); });

    // --- CALL LOGIC ---
    $(document).off("click.phoneCallTrigger", ".phone-call-trigger");
    $(document).on("click.phoneCallTrigger", ".phone-call-trigger", function(e) {
        e.stopPropagation();
        activeContact = $(this).data("name");
        startCall(activeContact);
    });

    const startCall = async (name) => {
        $("#uie-phone-homescreen").hide();
        $("#uie-app-contacts-view").hide();
        $("#uie-call-screen").css("display", "flex").hide().fadeIn(200);
        $("#call-name-disp").text(name);
        $(".call-status").text("Dialing...");
        $("#call-transcript").empty();
        syncToMainChat(`(On phone) Calling ${name}...`);

        const sAllow = getSettings();
        if (sAllow?.ai && sAllow.ai.phoneCalls === false) {
            $(".call-status").text("Calling disabled in settings");
            setTimeout(endCall, 2000);
            return;
        }

        try {
            callChatContext = getChatSnippet(50);
            const chat = callChatContext;
            const persona = getPersonaName();
            const card = getCharacterCardBlock(2600);
            const st = await generateContent(`
Phone Call Rules:
- Phone calls are audible to people in the room (not private like texts).
- You are a strict logic engine deciding if a call connects based on context.
- Decide if ${name} has a phone, answers, is busy, refuses, or is unreachable.
- If uncertain, set answers=false with a believable reason.
- If the user asks ${name} to come over / meet up and ${name} agrees, set arrivalInTurns to 1 or 2.
- greeting must be spoken words only: no narration, no roleplay formatting, no quotes, no speaker labels.

Return ONLY JSON:
{
  "hasPhone": true,
  "answers": true,
  "reason": "",
  "greeting": "short spoken greeting (spoken words only, one line)",
  "arrivalInTurns": 0,
  "arrivalReason": ""
}

TARGET: "${name}"
CALLER: "${persona}"
<character_card>
${card}
</character_card>
Context (recent chat, trimmed):
${chat}`.slice(0, 6000), "System Check");
            const logic = JSON.parse(cleanOutput(st, "json"));

            if (logic.hasPhone === false) {
                $(".call-status").text("No Phone");
                setTimeout(endCall, 2500);
                return;
            }
            if (logic.answers === false) {
                $(".call-status").text(logic.reason || "No Answer");
                setTimeout(endCall, 3000);
                return;
            }

            $(".call-status").text("Ringing...");
            setTimeout(() => connectCall(String(logic.greeting || "Hello?"), Number(logic.arrivalInTurns || 0), String(logic.arrivalReason || "")), 1200);
        } catch(e) { connectCall("Hello?", 0, ""); }
    };

    const connectCall = (greetingLine = "Hello?", arrivalTurns = 0, arrivalReason = "") => {
        $(".call-status").text("Connected");
        $("#call-timer-disp").text("00:00");
        let callSeconds = 0;
        if(callTimerInt) clearInterval(callTimerInt);
        callTimerInt = setInterval(() => {
            callSeconds++;
            $("#call-timer-disp").text(new Date(callSeconds * 1000).toISOString().substr(14, 5));
        }, 1000);
        const n = $("#call-name-disp").text();
        const gl = sanitizePhoneLine(cleanOutput(greetingLine, "chat"), 240) || "Hello?";
        $("#call-transcript").append(`<div style="text-align:left;color:#ccc;margin:5px;">${n}: ${gl}</div>`);
        injectRpEvent(`(On phone) Connected with ${n}.`, { uie: { type: "phone_call", who: n } });
        if (arrivalTurns > 0) scheduleArrival(n, arrivalTurns, arrivalReason || "They agreed to come over.");
    };

    const endCall = () => {
        clearInterval(callTimerInt);
        $("#uie-call-screen").fadeOut(200, () => goHome());
        syncToMainChat(`hung up the phone.`);
        callChatContext = "";
    };

    window.UIE_phone_incomingCall = (from) => {
        try {
            const s = getSettings();
            if (s?.phone && s.phone.allowCalls === false) return;
            activeContact = String(from || "Unknown");
            if (typeof window.UIE_forceOpenWindow === "function") {
                window.UIE_forceOpenWindow("#uie-phone-window", "./phone.js", "initPhone");
            }
            $("#uie-phone-window").show().css("display", "flex");
            if (window.toastr) toastr.info("Call incoming", "Phone");
            startCall(activeContact);
        } catch (e) { console.warn("[UIE] Incoming call handler failed:", e); }
    };

    window.UIE_phone_incomingText = (from, body) => {
        try {
            const s = getSettings();
            if (s?.phone && s.phone.allowTexts === false) return;
            const name = String(from || "Unknown").trim() || "Unknown";
            const msg = sanitizePhoneLine(String(body || ""), 1200);
            if (!msg) return;
            const th = getThread(name);
            th.list.push({ isUser: false, text: msg.slice(0, 1200), ts: Date.now() });
            saveSettings();
            if (typeof window.UIE_forceOpenWindow === "function") {
                window.UIE_forceOpenWindow("#uie-phone-window", "./phone.js", "initPhone");
            }
            $("#uie-phone-window").show().css("display", "flex");
            activeContact = name;
            openApp("#uie-app-msg-view");
            if (window.toastr) toastr.success("New message", "Phone");
            const persona = getPersonaName();
            injectRpEvent(`(Text) ${name} → ${persona}: "${msg.slice(0, 500)}"`, { uie: { type: "phone_text", who: name } });
        } catch (e) { console.warn("[UIE] Incoming text handler failed:", e); }
    };

    $(document).off("click.phoneCallEnd", "#call-end-btn").on("click.phoneCallEnd", "#call-end-btn", endCall);
    $(document).off("click.phoneCallSpeak", "#call-speak-btn").on("click.phoneCallSpeak", "#call-speak-btn", () => {
        const t = $("#call-input").val().trim();
        if(!t) return;
        $("#call-transcript").append(`<div style="text-align:right;color:white;margin:5px;">${t}</div>`);
        $("#call-input").val("");
        injectRpEvent(`(On phone) You: "${t}"`, { uie: { type: "phone_call_line", who: $("#call-name-disp").text() } });
        handleCallReply(t, $("#call-name-disp").text());
    });

    const handleCallReply = async (t, n, greeting=false) => {
        const s = getSettings();
        if (s?.ai && s.ai.phoneCalls === false) return;
        const chat = callChatContext || getChatSnippet(12);
        const lore = (() => { try { const ctx = getContext?.(); const maybe = ctx?.world_info || ctx?.lorebook || ctx?.lore || ctx?.worldInfo; const keys=[]; if(Array.isArray(maybe)){ for(const it of maybe){ const k=it?.key||it?.name||it?.title; if(k) keys.push(String(k)); } } return Array.from(new Set(keys)).slice(0, 60).join(", "); } catch(_) { return ""; } })();
        const character = (() => { try { const ctx = getContext?.(); return JSON.stringify({ user: ctx?.name1, character: ctx?.name2, chatId: ctx?.chatId, characterId: ctx?.characterId, groupId: ctx?.groupId }); } catch(_) { return "{}"; } })();
        const card = getCharacterCardBlock(2600);
        const persona = getPersonaName();
        const mem = getSocialMemoryBlockForName(n, 8);
        const transcript = $("#call-transcript").text().slice(0, 1200);
        const rules = [
            `You are ${n} speaking on a phone call with ${persona}.`,
            "STRICT FORMAT RULES (follow exactly):",
            "- Output ONLY the words spoken (dialogue only).",
            "- ONE line, 1–2 sentences max.",
            "- No narration, no actions, no stage directions.",
            "- No quotes, no markdown.",
            `- Do NOT include speaker labels like "${n}:" or "${persona}:".`,
            "- Do NOT use asterisks, brackets, or parentheses.",
            "",
        ].join("\n");
        const p = greeting
            ? `${rules}You just answered. Say a natural greeting.\n\nRecent call transcript:\n${transcript}\n\nContext:\n${chat}`
            : `${rules}${persona} just said: ${t}\n\nRecent call transcript:\n${transcript}\n\n<character check>\n${character}\n</character check>\n<lore check>\n${lore}\n</lore check>\nContext:\n${chat}`;
        const p2 = `${p}\n\n<character_card>\n${card}\n</character_card>\n${mem}`.slice(0, 7000);
        const r = await generateContent(p2, "Phone Call");
        if(r) {
            const line = sanitizePhoneLine(cleanOutput(r, "chat"), 320);
            if (!line) return;
            $("#call-transcript").append(`<div style="text-align:left;color:#ccc;margin:5px;">${n}: ${line}</div>`);
            injectRpEvent(`(On phone) ${n}: "${line}"`, { uie: { type: "phone_call_line", who: n } });
        }
    };

    // --- STANDARD BINDINGS ---
    $(document).on("click.phone", "#app-store", () => openApp("#uie-app-store-view"));
    $(document).on("click.phone", "#app-settings", () => openApp("#uie-app-settings-view"));
    $(document).on("click.phone", "#app-contacts", () => openApp("#uie-app-contacts-view"));
    $(document).on("click.phone", "#dock-btn-phone", () => { openApp("#uie-app-dial-view"); try { $("#dial-display").text(dialBuf || "—"); } catch (_) {} });
    $(document).on("click.phone", "#app-msg, #dock-btn-msg", () => openApp("#uie-app-msg-view"));
    $(document).on("click.phone", "#app-browser, #dock-btn-browser", () => openApp("#uie-app-browser-view"));
    $(document).on("click.phone", "#app-books", () => openApp("#uie-app-books-view"));
    $(document).on("click.phone", "#app-calc", () => openApp("#uie-app-calc-view"));
    $(document).on("click.phone", "#app-cookies", () => openApp("#uie-app-cookies-view"));
    
    const setDialDisplay = () => {
        try { $("#dial-display").text(dialBuf ? dialBuf : "—"); } catch (_) {}
    };

    $(document).off("click.phoneDialBtn", "#uie-app-dial-view .dial-btn").on("click.phoneDialBtn", "#uie-app-dial-view .dial-btn", function(e){
        e.preventDefault();
        e.stopPropagation();
        const d = String($(this).data("digit") || "");
        if (!d) return;
        if (dialBuf.length >= 24) return;
        dialBuf += d;
        setDialDisplay();
    });
    $(document).off("click.phoneDialDel", "#dial-backspace").on("click.phoneDialDel", "#dial-backspace", function(e){
        e.preventDefault();
        e.stopPropagation();
        dialBuf = dialBuf.slice(0, -1);
        setDialDisplay();
    });
    $(document).off("click.phoneDialCall", "#dial-call").on("click.phoneDialCall", "#dial-call", function(e){
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureContactNumbers(s);
        const digits = normalizeNumber(dialBuf);
        if (!digits) return;
        const friends = Array.isArray(s?.social?.friends) ? s.social.friends : [];
        const hit = friends.find(p => normalizeNumber(p?.phone || p?.phoneNumber || "") === digits);
        const nb = Array.isArray(s?.phone?.numberBook) ? s.phone.numberBook : [];
        const hit2 = nb.find(x => normalizeNumber(x?.number || "") === digits);
        const target = String(hit?.name || hit2?.name || formatNumber(digits) || "Unknown");
        dialBuf = "";
        setDialDisplay();
        startCall(target);
    });
    $(document).off("click.phoneDialSave", "#dial-save").on("click.phoneDialSave", "#dial-save", function(e){
        e.preventDefault();
        e.stopPropagation();
        const digits = normalizeNumber(dialBuf);
        if (!digits) return;
        const name = (prompt("Save number as:") || "").trim();
        if (!name) return;
        const s = getSettings();
        ensureNumbersState(s);
        const formatted = formatNumber(digits);
        s.phone.numberBook = (s.phone.numberBook || []).filter(x => normalizeNumber(x?.number || "") !== digits);
        s.phone.numberBook.push({ name: name.slice(0, 60), number: formatted, ts: Date.now() });
        saveSettings();
        notify("success", `Saved ${name}`, "Cookies", "phoneMessages");
    });

    const smartBack = (srcEl) => {
        const isMsg = $("#uie-app-msg-view").is(":visible");
        if (isMsg && activeContact) {
            activeContact = null;
            $("#msg-contact-name").text("Messages");
            renderMessages();
            return;
        }
        goHome();
    };

    $(document)
        .off("click.phoneBack pointerup.phoneBack", "#uie-phone-window .phone-back-btn, #uie-phone-window #p-browser-home")
        .on("click.phoneBack pointerup.phoneBack", "#uie-phone-window .phone-back-btn, #uie-phone-window #p-browser-home", function(e){
            if (e.type === "pointerup" && e.pointerType !== "touch") return;
            e.preventDefault();
            e.stopPropagation();
            smartBack(this);
        });
    $(document).on("click.phone", "#uie-phone-close", () => $("#uie-phone-window").hide());

    $(document).on("click.phone", "#uie-phone-lock-btn", () => {
        $(".phone-app-window").hide();
        $("#uie-phone-homescreen").hide();
        $("#uie-phone-lockscreen").css("display", "flex");
        $("#uie-phone-pin").val("");
    });

    $(document).on("click.phone", "#uie-phone-unlock-btn", (e) => {
        e.preventDefault();
        const s = getSettings();
        const storedPin = s.phone ? s.phone.pin : "";
        const enteredPin = $("#uie-phone-pin").val();
        if (storedPin && storedPin !== "" && enteredPin !== storedPin) {
            $("#uie-lock-msg").text("Incorrect PIN");
            return;
        }
        $("#uie-lock-msg").text("");
        $("#uie-phone-lockscreen").fadeOut(200, () => goHome());
    });

    const browserRender = (key) => {
        const s = getSettings();
        if(!s || !s.phone || !s.phone.browser) return;
        const html0 = s.phone.browser.pages[key] || "";
        const html = sanitizeWebHtml(html0);
        $("#p-browser-content").html(html || '<div style="text-align:center;margin-top:50px; opacity:0.7;">No cached page.</div>');
        $("#p-browser-url").val(key);
    };

    let calcExpr = "0";
    const calcSet = (v) => {
        calcExpr = String(v || "0");
        if (!calcExpr.trim()) calcExpr = "0";
        $("#calc-display").text(calcExpr);
    };
    const calcAppend = (ch) => {
        const s = String(ch);
        if (calcExpr === "0" && /[0-9.]/.test(s)) calcExpr = "";
        calcExpr += s;
        $("#calc-display").text(calcExpr);
    };
    const calcBack = () => {
        calcExpr = calcExpr.slice(0, -1);
        if (!calcExpr) calcExpr = "0";
        $("#calc-display").text(calcExpr);
    };
    const calcPercent = () => {
        const m = calcExpr.match(/(-?\d+(\.\d+)?)\s*$/);
        if (!m) return;
        const n = Number(m[1]);
        if (!Number.isFinite(n)) return;
        calcExpr = calcExpr.slice(0, m.index) + String(n / 100);
        $("#calc-display").text(calcExpr);
    };
    const calcEval = () => {
        const expr = String(calcExpr || "").replace(/×/g, "*").replace(/÷/g, "/");
        if (!/^[0-9+\-*/().\s]+$/.test(expr)) return;
        try {
            const out = Function(`"use strict"; return (${expr});`)();
            if (Number.isFinite(out)) calcSet(String(out));
        } catch (_) {}
    };

    $(document).on("click.phone", ".calc-btn", function(e) {
        e.preventDefault(); e.stopPropagation();
        const act = $(this).data("act");
        const val = $(this).data("val");
        if (act === "clear") return calcSet("0");
        if (act === "back") return calcBack();
        if (act === "eq") return calcEval();
        if (String(val) === "%") return calcPercent();
        if (val !== undefined) return calcAppend(String(val));
    });

    const browserPush = (key, html) => {
        const s = getSettings();
        if(!s || !s.phone) return;
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        s.phone.browser.pages[key] = html;

        if (s.phone.browser.index < s.phone.browser.history.length - 1) {
            s.phone.browser.history = s.phone.browser.history.slice(0, s.phone.browser.index + 1);
        }
        s.phone.browser.history.push(key);
        s.phone.browser.index = s.phone.browser.history.length - 1;
        saveSettings();
    };

    const browserNavigate = async (raw) => {
        const t = String(raw || "").trim();
        if(!t) return;

        const s = getSettings();
        if(!s || !s.phone) return;
        if(!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };

        if (s.phone.browser.pages[t]) {
            browserPush(t, s.phone.browser.pages[t]);
            browserRender(t);
            return;
        }

        if (s.ai && s.ai.phoneBrowser === false) {
            $("#p-browser-content").html('<div style="text-align:center;margin-top:50px; opacity:0.8;">Browser generation disabled in settings.</div>');
            return;
        }

        $("#p-browser-content").html('<div style="text-align:center;margin-top:50px; opacity:0.8;">Loading…</div>');
        const r = await generateContent(`Webpage for "${t}". RULES: Raw HTML. No scripts. Mobile layout.`, "Webpage");
        const html = sanitizeWebHtml(cleanOutput(r, "web"));
        browserPush(t, html);
        browserRender(t);
    };

    $(document).off("click.phone", "#p-browser-go");
    $(document).on("click.phone", "#p-browser-refresh", async () => {
        const t = String($("#p-browser-url").val() || "").trim();
        if(!t) return;
        const s0 = getSettings();
        if (s0?.ai && s0.ai.phoneBrowser === false) return;
        const r = await generateContent(`Webpage for "${t}". RULES: Raw HTML. No scripts. Mobile layout.`, "Webpage");
        const html = sanitizeWebHtml(cleanOutput(r, "web"));
        const s = getSettings();
        if(s?.phone?.browser) {
            s.phone.browser.pages[t] = html;
            saveSettings();
        }
        browserRender(t);
    });

    $(document).on("click.phone", "#p-browser-go", async () => {
        const t = String($("#p-browser-url").val() || "").trim();
        if (!t) return;
        const s = getSettings();
        if (s?.phone?.browser?.pages && s.phone.browser.pages[t]) {
            await browserNavigate(t);
            return;
        }
        await browserNavigate(t);
    });
    $(document).on("click.phone", "#p-browser-back", () => {
        const s = getSettings();
        if(!s?.phone?.browser) return;
        const b = s.phone.browser;
        if (b.index <= 0) return;
        b.index -= 1;
        saveSettings();
        browserRender(b.history[b.index]);
    });
    $(document).on("click.phone", "#p-browser-fwd", () => {
        const s = getSettings();
        if(!s?.phone?.browser) return;
        const b = s.phone.browser;
        if (b.index >= b.history.length - 1) return;
        b.index += 1;
        saveSettings();
        browserRender(b.history[b.index]);
    });

    $(document).on("keydown.phone", "#p-browser-url", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            $("#p-browser-go").click();
        }
    });
    $(document).on("input.phone", "#p-browser-url", function () {
        try {
            this.style.height = "auto";
            const h = Math.min(70, Math.max(34, this.scrollHeight || 34));
            this.style.height = `${h}px`;
        } catch (_) {}
    });

    $(document)
        .off("click.phoneWeb pointerup.phoneWeb", "#p-browser-content a")
        .on("click.phoneWeb pointerup.phoneWeb", "#p-browser-content a", function(e){
            if (e.type === "pointerup" && e.pointerType !== "touch") return;
            const href = String($(this).attr("href") || "").trim();
            if(!href || href.startsWith("#")) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            $("#p-browser-url").val(href);
            $("#p-browser-go").trigger("click");
        });

    function sanitizeWebHtml(input) {
        const raw = String(input || "");
        if (!raw.trim()) return "";
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(raw, "text/html");
            doc.querySelectorAll("script, iframe, frame, frameset, object, embed, base, meta[http-equiv], link[rel], style").forEach((n) => {
                const tag = (n.tagName || "").toLowerCase();
                if (tag === "meta") {
                    const he = String(n.getAttribute("http-equiv") || "").toLowerCase();
                    if (he === "refresh") n.remove();
                    return;
                }
                if (tag === "link") {
                    const rel = String(n.getAttribute("rel") || "").toLowerCase();
                    if (rel === "stylesheet" || rel === "preload") n.remove();
                    return;
                }
                n.remove();
            });
            doc.querySelectorAll("*").forEach((el) => {
                const attrs = Array.from(el.attributes || []);
                for (const a of attrs) {
                    const name = String(a.name || "").toLowerCase();
                    if (name.startsWith("on")) el.removeAttribute(a.name);
                }
            });
            doc.querySelectorAll("a[href]").forEach((a) => {
                const href = String(a.getAttribute("href") || "").trim();
                if (/^javascript:/i.test(href)) a.setAttribute("href", "#");
                a.removeAttribute("target");
                a.setAttribute("rel", "noopener noreferrer");
            });
            doc.querySelectorAll("form").forEach((f) => {
                f.setAttribute("action", "#");
                f.addEventListener?.("submit", (ev) => ev.preventDefault());
            });
            return String(doc.body?.innerHTML || "");
        } catch (_) {
            return raw.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
        }
    }

    function ensureBrowser(s) {
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.bookmarks)) s.phone.bookmarks = [];
        if (!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
        if (!s.phone.browser.pages) s.phone.browser.pages = {};
        if (!Array.isArray(s.phone.browser.history)) s.phone.browser.history = [];
        if (typeof s.phone.browser.index !== "number") s.phone.browser.index = -1;
    }

    function renderBrowserHome() {
        const s = getSettings();
        ensureBrowser(s);
        const $c = $("#p-browser-content");
        if (!$c.length) return;
        const list = Array.isArray(s.phone.bookmarks) ? s.phone.bookmarks : [];
        if (!list.length) {
            $c.html(`<div style="padding:18px; opacity:0.8; text-align:center;">No saved pages yet.<div style="margin-top:8px; opacity:0.75; font-size:12px;">Open a page, then tap the bookmark button.</div></div>`);
            return;
        }
        const items = list.slice().reverse().slice(0, 40).map(b => {
            const url = String(b.url || "").slice(0, 160);
            const title = String(b.title || b.url || "Saved Page").slice(0, 80);
            return `<div class="p-bookmark" data-url="${esc(url)}" style="padding:12px; border-bottom:1px solid rgba(0,0,0,0.08); cursor:pointer;">
                <div style="font-weight:900; color:#222;">${esc(title)}</div>
                <div style="opacity:0.7; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(url)}</div>
            </div>`;
        }).join("");
        $c.html(`<div style="background:#fff; color:#222;">${items}</div>`);
    }

    $(document).on("click.phone", "#p-browser-save", function(e){
        e.preventDefault(); e.stopPropagation();
        const key = String($("#p-browser-url").val() || "").trim();
        if (!key) return;
        const s = getSettings();
        ensureBrowser(s);
        const html = String(s.phone.browser.pages[key] || $("#p-browser-content").html() || "");
        const title = (prompt("Save as:", key) || "").trim() || key;
        const exists = s.phone.bookmarks.some(b => String(b.url || "") === key);
        if (!exists) s.phone.bookmarks.push({ url: key, title: title.slice(0, 80), ts: Date.now() });
        s.phone.browser.pages[key] = html;
        saveSettings();
        notify("success", "Saved.", "Phone", "phoneMessages");
    });

    $(document).on("click.phone", "#p-browser-content .p-bookmark", function(e){
        e.preventDefault(); e.stopPropagation();
        const url = String($(this).data("url") || "").trim();
        if (!url) return;
        $("#p-browser-url").val(url);
        $("#p-browser-go").click();
    });

    function tryOpenSillyTavernChat(name) {
        const target = String(name || "").trim();
        if (!target) return false;
        const norm = target.toLowerCase();
        const selectors = [
            ".character_select",
            ".char_select",
            ".character-card",
            ".character",
            ".chara-card",
            ".chara",
            "#rm_print_characters_block .character_select",
            "#rm_print_characters_block .character-card"
        ];
        const nodes = [];
        selectors.forEach(sel => { document.querySelectorAll(sel).forEach(n => nodes.push(n)); });
        for (const n of nodes) {
            const txt = String(n.textContent || "").toLowerCase();
            if (!txt.includes(norm)) continue;
            try { n.click(); return true; } catch (_) {}
        }
        const nameNodes = document.querySelectorAll(".character_name, .char_name, .name, .ch_name");
        for (const n of nameNodes) {
            const txt = String(n.textContent || "").trim();
            if (!txt) continue;
            if (txt.toLowerCase() !== norm) continue;
            const card = n.closest(".character_select, .char_select, .character-card, .character, .chara-card, .chara");
            try { (card || n).click(); return true; } catch (_) {}
        }
        return false;
    }

    $(document).on("click.phone", "#p-save-btn", () => {
        const s = getSettings();
        if(!s.phone) s.phone = {};
        s.phone.pin = $("#p-set-pin").val();
        s.phone.allowCalls = $("#p-allow-calls").is(":checked");
        s.phone.allowTexts = $("#p-allow-texts").is(":checked");
        s.phone.bubbleColors = {
            sent: String($("#p-bubble-sent").val() || "").trim() || (s.phone.bubbleColors?.sent || ""),
            received: String($("#p-bubble-recv").val() || "").trim() || (s.phone.bubbleColors?.received || "")
        };
        saveSettings();
        loadPhoneVisuals();
        alert("Settings Saved");
        goHome();
    });

    $(document).on("change.phone", "#p-set-bg-file", function(e){
        const f = e.target.files[0];
        if(f){
            const r = new FileReader();
            r.onload = function(ev){
                const s = getSettings();
                if(!s.phone) s.phone = {};
                s.phone.bg = ev.target.result;
                saveSettings();
                loadPhoneVisuals();
            };
            r.readAsDataURL(f);
        }
    });

    // Browser Interactions
    $(document).on("click.phone", ".browser-app-mode #p-browser-content *", async function(e) {
        const target = $(this);
        if(!target.is("button, a, div[onclick], li, span.clickable, div.card, .btn")) return;
        if (target.is("a")) {
            const href = String(target.attr("href") || "").trim();
            if (href && !href.startsWith("#")) return;
        }
        
        const appId = $("#uie-app-browser-view").data("active-app");
        const app = getSettings().phone.customApps.find(a => a.id == appId);
        if(!app) return;
        e.preventDefault();
        e.stopPropagation();
        notify("info", "Processing...", "Phone", "api");

        const prompt = `User clicked "${target.text().substring(0,30)}" in app "${app.name}". 
        Return JSON action: {"action": "navigate"|"message"|"alert", "content": "..."}`;
        
        try {
            const res = await generateContent(prompt, "System Check");
            const logic = JSON.parse(cleanOutput(res, "json"));
            
            if(logic.action === "navigate") {
                if (logic.content.length < 50 && !logic.content.includes("<")) {
                    $("#p-browser-content").html('<div style="text-align:center;margin-top:50px;">Loading...</div>');
                    const newHtml = await generateContent(`Generate mobile UI for "${logic.content}" in app "${app.name}". HTML Only.`, "Webpage");
                    $("#p-browser-content").html(cleanOutput(newHtml, "web"));
                } else {
                    $("#p-browser-content").html(cleanOutput(logic.content, "web"));
                }
            }
            else if (logic.action === "message") { 
                activeContact = String(app.name || "App");
                openApp("#uie-app-msg-view"); 
                const th = getThread(activeContact);
                th.list.push({ isUser: false, text: String(logic.content || ""), ts: Date.now() });
                saveSettings();
                renderMessages();
                syncToMainChat(`received a notification from ${app.name}.`);
            }
            else if (logic.action === "alert") alert(logic.content);
        } catch(e) { console.warn(e); }
    });

    const ensurePhoneState = () => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.customApps)) s.phone.customApps = [];
        if (!Array.isArray(s.phone.unlockedDevices)) s.phone.unlockedDevices = ["classic"];
        if (!Array.isArray(s.phone.featuredApps)) s.phone.featuredApps = [];
        if (!s.phone.shop) s.phone.shop = { tab: "skins" };
        return s;
    };

    const setDraftStatus = (txt) => {
        const el = $("#store-draft-status");
        if (el.length) el.text(String(txt || ""));
    };

    const generateAppDraft = async () => {
        const sAllow = getSettings();
        if (sAllow?.ai && sAllow.ai.appBuilder === false) return null;
        const name = String($("#store-app-name").val() || "").trim();
        const desc = String($("#store-app-desc").val() || "").trim();
        const template = String($("#store-app-template").val() || "tool");
        if (!name) return null;

        setDraftStatus("Generating draft...");

        const resMeta = await generateContent(
            `Create app icon metadata for "${name}". Return JSON only: {"icon":"fa-solid fa-cube","color":"#333333"}.`,
            "System Check"
        );

        let icon = "fa-solid fa-cube";
        let color = "#333";
        try {
            if (resMeta) {
                const obj = JSON.parse(cleanOutput(resMeta, "json"));
                if (obj?.icon) icon = String(obj.icon);
                if (obj?.color) color = String(obj.color);
            }
        } catch (_) {}

        const uiPrompt = `
You are building a PHONE APP UI that will be injected into a sandboxed div.
Output RAW HTML only. Inline CSS only. No scripts. No external assets.
App name: "${name}"
Template: "${template}"
Description: "${desc}"
Requirements:
- Use a compact mobile layout. Assume a narrow viewport.
- Include a header bar inside the HTML with the app name.
- Provide at least 2 interactive-looking sections (lists/buttons) even if they are placeholders.
- Avoid position:fixed. Avoid full-screen overlays.
`;

        const resUI = await generateContent(uiPrompt.slice(0, 5000), "Webpage");
        const html = cleanOutput(resUI, "web");
        if (!html) return null;

        const s = ensurePhoneState();
        s.phone.draftApp = { id: Date.now(), name, desc, template, icon, color, html, createdAt: Date.now() };
        saveSettings();
        setDraftStatus(`Draft ready: ${name}`);
        return s.phone.draftApp;
    };

    const previewDraft = () => {
        const s = ensurePhoneState();
        const d = s.phone.draftApp;
        if (!d || !d.html) return false;
        openApp("#uie-app-browser-view");
        $("#uie-app-browser-view").removeClass("browser-app-mode");
        $("#p-app-title").text(d.name || "Draft");
        $("#p-app-header").show();
        $("#p-browser-content").html(d.html);
        return true;
    };

    // App Builder: Generate
    $(document).on("click.phone", "#store-gen-btn", async () => {
        const btn = $("#store-gen-btn");
        btn.text("...").prop("disabled", true);
        try {
            const d = await generateAppDraft();
            if (!d) setDraftStatus("Draft generation failed.");
        } catch (_) {
            setDraftStatus("Draft generation failed.");
        }
        btn.text("GENERATE").prop("disabled", false);
    });

    // App Builder: Preview
    $(document).on("click.phone", "#store-preview-btn", async () => {
        const s = ensurePhoneState();
        if (!s.phone.draftApp) {
            const btn = $("#store-preview-btn");
            btn.text("...").prop("disabled", true);
            try { await generateAppDraft(); } catch (_) {}
            btn.text("PREVIEW").prop("disabled", false);
        }
        if (!previewDraft()) {
            notify("warning", "No draft to preview.", "App Builder", "api");
        }
    });

    // App Builder: Install Draft
    $(document).on("click.phone", "#store-create-btn", async () => {
        const btn = $("#store-create-btn");
        btn.text("...").prop("disabled", true);
        try {
            const s = ensurePhoneState();
            if (!s.phone.draftApp) await generateAppDraft();
            const d = ensurePhoneState().phone.draftApp;
            if (!d) { setDraftStatus("No draft to install."); return; }

            if (!s.phone.customApps.find(a => String(a.name) === String(d.name))) {
                s.phone.customApps.push({ id: Date.now(), name: d.name, desc: d.desc, icon: d.icon, color: d.color, html: d.html });
                s.phone.draftApp = null;
                saveSettings();
                notify("success", "App Installed!", "App Store", "phoneMessages");
            } else {
                notify("info", "App already installed.", "App Store", "phoneMessages");
            }
            loadPhoneVisuals();
            renderAppStore();
            setDraftStatus("No draft yet.");
        } finally {
            btn.text("INSTALL DRAFT").prop("disabled", false);
        }
    });
    
    const renderCookies = () => {
        const s = getSettings();
        if (!s.phone) s.phone = {};
        if (!Array.isArray(s.phone.numberBook)) s.phone.numberBook = [];
        
        // Calculate sizes
        const getBytes = (obj) => new Blob([JSON.stringify(obj)]).size;
        const fmtSize = (bytes) => {
            if (bytes < 1024) return bytes + " B";
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
            return (bytes / (1024 * 1024)).toFixed(1) + " MB";
        };

        const logsSize = 0; // Logs are handled externally or via RP logs if stored
        const browserSize = getBytes(s.phone.browser || {});
        const mapsSize = getBytes(s.map || {});
        const booksSize = getBytes(s.phone.books || []);
        const stateSize = getBytes(s.worldState || {});
        const numbersSize = getBytes(s.phone.numberBook || []);
        const total = logsSize + browserSize + mapsSize + booksSize + numbersSize + stateSize;

        $("#cookies-total-size").text(fmtSize(total) + " Used");
        $("#size-logs").text("N/A"); // Placeholder
        $("#size-browser").text(fmtSize(browserSize));
        $("#size-maps").text(fmtSize(mapsSize));
        $("#size-books").text(fmtSize(booksSize));
        $("#size-numbers").text(fmtSize(numbersSize));
        $("#size-state").text(fmtSize(stateSize));

        // Category Click Handlers
        $(".cookie-row").off("click.phone").on("click.phone", function() {
            const cat = $(this).data("cat");
            renderCookiesDetail(cat);
        });

        // Clear All
        $("#cookies-clear-all").off("click.phone").on("click.phone", function() {
            if (confirm("Permanently delete all generated data?")) {
                if (s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
                if (s.map) s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } };
                if (s.phone.books) s.phone.books = [];
                if (s.worldState) s.worldState = { location: "Unknown", threat: "None", status: "Normal", time: "Day", weather: "Clear", custom: {} };
                saveSettings();
                renderCookies();
                alert("All data cleared.");
            }
        });
    };

    const renderCookiesDetail = (cat) => {
        const s = getSettings();
        $("#cookies-detail-view").css("display", "flex").hide().fadeIn(150);
        $("#cookies-detail-title").text(cat === "browser" ? "Saved Web Data" : cat === "maps" ? "Maps" : cat === "books" ? "Books" : cat === "numbers" ? "Saved Numbers" : cat === "state" ? "World State" : "Logs");
        
        const $list = $("#cookies-detail-list").empty();
        let items = [];

        if (cat === "browser" && s.phone.browser?.pages) {
            items = Object.keys(s.phone.browser.pages).map(k => ({ id: k, title: k, type: "Page" }));
        } else if (cat === "maps" && s.map?.data) {
            items = [{ id: "current", title: s.map.prompt || "Current Map", type: "Map Data" }];
        } else if (cat === "books" && Array.isArray(s.phone.books)) {
            items = s.phone.books.map(b => ({ id: b.id, title: b.title, type: "Book" }));
        } else if (cat === "numbers" && Array.isArray(s.phone.numberBook)) {
            items = s.phone.numberBook.map((n, idx) => ({ id: String(idx), title: `${n.name || "Unknown"} — ${n.number || ""}`, type: "Number" }));
        } else if (cat === "state" && s.worldState) {
            items = Object.keys(s.worldState).map(k => ({ id: k, title: k, type: String(s.worldState[k]) }));
        }

        const renderItems = (list) => {
            $list.empty();
            if (!list.length) {
                $list.html('<div style="padding:20px; text-align:center; color:#aaa;">No data found.</div>');
                return;
            }
            list.forEach(i => {
                $list.append(`
                    <div class="cookie-item-row" data-id="${i.id}" style="padding:12px 16px; border-bottom:1px solid #e5e5e5; display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1; min-width:0; margin-right:10px;">
                            <div style="font-weight:600; color:#1d1d1f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(i.title)}</div>
                            <div style="font-size:12px; color:#86868b;">${esc(i.type)}</div>
                        </div>
                        <i class="fa-solid fa-trash cookie-del-btn" data-cat="${cat}" data-id="${i.id}" style="color:#ff3b30; cursor:pointer; padding:8px;"></i>
                    </div>
                `);
            });
        };
        renderItems(items);

        // Search Filter
        $("#cookies-search").off("input.phone").on("input.phone", function() {
            const q = $(this).val().toLowerCase();
            const filtered = items.filter(i => i.title.toLowerCase().includes(q) || i.type.toLowerCase().includes(q));
            renderItems(filtered);
        });

        // Delete Single
        $(document).off("click.phone", ".cookie-del-btn").on("click.phone", ".cookie-del-btn", function(e) {
            e.stopPropagation();
            const id = $(this).data("id");
            const c = $(this).data("cat");
            if (c === "browser") delete s.phone.browser.pages[id];
            else if (c === "maps") s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } };
            else if (c === "books") s.phone.books = s.phone.books.filter(b => b.id != id);
            else if (c === "numbers") s.phone.numberBook = (s.phone.numberBook || []).filter((_, i) => String(i) !== String(id));
            else if (c === "state") delete s.worldState[id];
            saveSettings();
            renderCookies(); // Update totals
            renderCookiesDetail(c); // Refresh list
        });

        // Delete Category
        $("#cookies-delete-cat").off("click.phone").on("click.phone", function() {
            if (confirm("Delete all items in this category?")) {
                if (cat === "browser") s.phone.browser.pages = {};
                else if (cat === "maps") s.map = { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } };
                else if (cat === "books") s.phone.books = [];
                else if (cat === "numbers") s.phone.numberBook = [];
                else if (cat === "state") s.worldState = { location: "Unknown", threat: "None", status: "Normal", time: "Day", weather: "Clear", custom: {} };
                saveSettings();
                renderCookies();
                $("#cookies-detail-back").click();
            }
        });

        $("#cookies-detail-back").off("click.phone").on("click.phone", function() {
            $("#cookies-detail-view").fadeOut(150);
        });
    };

    const renderAppStore = () => {
        const s = ensurePhoneState();
        const list = $("#store-installed-list"); 
        if(!list.length) return;
        list.empty();
        if (s.phone.draftApp && s.phone.draftApp.name) setDraftStatus(`Draft ready: ${s.phone.draftApp.name}`);
        else setDraftStatus("No draft yet.");
        (s.phone.customApps || []).forEach(app => {
            list.append(`
                <div style="display:flex; align-items:center; gap:10px; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.22); margin-bottom:8px;">
                    <div style="background:${app.color}; width:40px; height:40px; border-radius:14px; display:grid; place-items:center; border:1px solid rgba(255,255,255,0.10); font-size:1.1em;"><i class="${app.icon}"></i></div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(app.name)}</div>
                        <div style="opacity:0.7; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(app.desc || "")}</div>
                    </div>
                    <button class="btn-delete-app" data-id="${app.id}" style="height:34px; padding:0 10px; border-radius:12px; border:1px solid rgba(243,139,168,0.35); background:rgba(0,0,0,0.25); color:#f38ba8; font-weight:900;">Delete</button>
                </div>
            `);
        });
    };

    $(document).on("click.phone", ".btn-delete-app", function() {
        const id = $(this).data("id"); if(confirm("Delete app?")) {
            const s = getSettings(); s.phone.customApps = s.phone.customApps.filter(a => a.id != id);
            saveSettings(); loadPhoneVisuals(); renderAppStore();
        }
    });
    
    $(document).on("click.phone", ".custom-app-icon", function(e) {
        if($(e.target).hasClass("custom-app-delete")) return;
        const id = $(this).data("id");
        const app = getSettings().phone.customApps.find(a => a.id == id);
        if(!app) return;
        openApp("#uie-app-browser-view");
        $("#uie-app-browser-view").addClass("browser-app-mode");
        $("#p-app-title").text(app.name);
        $("#p-app-header").show();
        $("#p-browser-content").html(app.html);
        $("#uie-app-browser-view").data("active-app", id);
    });

    loadPhoneVisuals();
    startArrivalWatcher();

    // Settings: Wallpaper / Lockscreen local pickers
    $(document).off("change.phoneBg", "#p-set-bg-file").on("change.phoneBg", "#p-set-bg-file", function() {
        const f = this.files && this.files[0];
        if(!f) return;
        const r = new FileReader();
        r.onload = () => {
            const s = getSettings();
            if(!s.phone) s.phone = {};
            s.phone.bg = String(r.result || "");
            saveSettings();
            $("#p-bg-filename").text(f.name || "Chosen");
            loadPhoneVisuals();
        };
        r.readAsDataURL(f);
    });

    $(document).off("change.phoneLock", "#p-set-lock-file").on("change.phoneLock", "#p-set-lock-file", function() {
        const f = this.files && this.files[0];
        if(!f) return;
        const r = new FileReader();
        r.onload = () => {
            const s = getSettings();
            if(!s.phone) s.phone = {};
            s.phone.lockBg = String(r.result || "");
            saveSettings();
            $("#p-lock-filename").text(f.name || "Chosen");
            loadPhoneVisuals();
        };
        r.readAsDataURL(f);
    });
}

export function openBooksGuide() {
    $("#uie-phone-window").show().css("display", "flex");
    $("#uie-phone-lockscreen").hide();
    $("#uie-phone-homescreen").hide();
    $(".phone-app-window").hide();
    $("#uie-app-books-view").css("display", "flex").show();
    try { renderBooks(); } catch (_) {}
    $("#books-view-guide").show();
    $("#books-view-library").hide();
    $("#books-tab-guide").addClass("active");
    $("#books-tab-library").removeClass("active");
}

function renderBooks() {
    const s = getSettings();
    if(!s.phone) s.phone = {};
    if(!Array.isArray(s.phone.books)) s.phone.books = [];

    $("#books-view-guide").show();
    $("#books-view-library").hide();
    $("#books-tab-guide").addClass("active");
    $("#books-tab-library").removeClass("active");

    const $list = $("#books-list").empty();
    if (!s.phone.books.length) {
        $list.html(`<div style="opacity:0.75; padding:10px; border:1px dashed #ccc; border-radius:12px;">No books yet.</div>`);
    } else {
        s.phone.books.slice().reverse().forEach(b => {
            $list.append(`
                <div class="book-row" data-id="${b.id}" style="padding:12px; border-radius:12px; border:1px solid rgba(0,0,0,0.10); background:#f7f2e8; cursor:pointer; color:#2c1e10;">
                    <div style="font-weight:900; color:#000;">${String(b.title || "Book")}</div>
                    <div style="opacity:0.75; font-size:12px; color:#2c1e10;">${new Date(b.createdAt || Date.now()).toLocaleString()}</div>
                </div>
            `);
        });
    }

    $(document).off("click.phoneBooksTabs");
    $(document).on("click.phoneBooksTabs", "#books-tab-guide", () => {
        $("#books-view-guide").show();
        $("#books-view-library").hide();
        $("#books-tab-guide").addClass("active");
        $("#books-tab-library").removeClass("active");
    });
    $(document).on("click.phoneBooksTabs", "#books-tab-library", () => {
        $("#books-view-guide").hide();
        $("#books-view-library").show();
        $("#books-tab-guide").removeClass("active");
        $("#books-tab-library").addClass("active");
    });

    const doGen = async () => {
        const s2 = getSettings();
        if (s2?.ai && s2.ai.books === false) return;
        const prompt = String($("#books-prompt").val() || "").trim();
        if(!prompt) return;
        $("#books-prompt").val("");
        const title = "";
        const html = await generateContent(`Write an immersive book as raw HTML. Style like a parchment book. User request: "${prompt}". No scripts. Do not add a title header unless the user explicitly asks for one.`, "Webpage");
        if(!html) return;
        const clean = cleanOutput(html, "web");
        const s3 = getSettings();
        if(!s3.phone) s3.phone = {};
        if(!Array.isArray(s3.phone.books)) s3.phone.books = [];
        s3.phone.books.push({ id: Date.now(), title, html: clean, createdAt: Date.now() });
        saveSettings();
        renderBooks();
        $("#books-view-guide").hide();
        $("#books-view-library").show();
        $("#books-tab-guide").removeClass("active");
        $("#books-tab-library").addClass("active");
    };

    $(document).off("click.phoneBooksGen").on("click.phoneBooksGen", "#books-go", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await doGen();
    });

    $(document).off("keydown.phoneBooksPrompt").on("keydown.phoneBooksPrompt", "#books-prompt", async (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault(); e.stopPropagation();
        await doGen();
    });

    $(document).off("click.phoneBooksOpen").on("click.phoneBooksOpen", "#books-list .book-row", function() {
        const id = Number($(this).data("id"));
        const s2 = getSettings();
        const b = (s2.phone.books || []).find(x => Number(x.id) === id);
        if(!b) return;
        $("#books-reader-body").html(String(b.html || ""));
        $("#books-reader").show();
    });

    $(document).off("click.phoneBooksClose").on("click.phoneBooksClose", "#books-reader-close", () => {
        $("#books-reader").hide();
    });
}
