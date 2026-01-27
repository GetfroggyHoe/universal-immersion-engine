import { getContext } from "/scripts/extensions.js";
import { saveSettingsDebounced } from "/script.js";

export const EXT_ID = "universal-immersion-engine";

let uieLauncherIconProbe = { src: "", ok: null, t: 0 };

export const SETTINGS_DEFAULT = {
    enabled: true,
    permadeath: false,
    rpg: { mode: "adventurer" },
    launcherX: 100, launcherY: 100,
    launcherIcon: "",
    launcher: { name: "", src: "", hidden: false, savedIcons: [], lastUploadName: "" },
    menuX: null,
    menuY: null,
    posX: 100, posY: 100,
    inventoryDesktopFullscreen: false,
    hearts: 5,
    maxHearts: 5,
    map: { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } },
    shop: { catalog: [], keywords: "" },
    activities: { active: [], loops: [] },
    menuHidden: { inventory:false, shop:false, journal:false, diary:false, social:false, party:false, battle:false, activities:false, stats:false, phone:false, map:false, calendar:false, databank:false, settings:false, debug:false, world:false, help:false },
    features: { codexEnabled: true, phoneEnabled: true },
    ai: {
        phoneBrowser: true,
        phoneMessages: true,
        phoneCalls: true,
        appBuilder: true,
        books: true,
        journalQuestGen: true,
        databankScan: true,
        map: true,
        shop: true,
        loot: true
    },
    generation: { requireConfirm: false, promptUI: true, aiConfirm: false, scanOnlyOnGenerateButtons: false, systemCheckMinIntervalMs: 20000, autoScanMinIntervalMs: 8000, allowSystemChecks: false, scanAllEnabled: false, customSystemPrompt: "", promptPrefixes: { global: "", byType: {} } },
    party: {
        name: "My Party",
        banner: "",
        leaderId: null,
        formation: { mode: "lanes", lanes: { front: [], mid: [], back: [] } },
        members: [],
        sharedItems: [],
        currencySplit: "shared",
        relationships: {},
        partyTactics: { preset: "Balanced", conserveMana: false, focus: "auto", protectId: "" }
    },
    hp: 100, maxHp: 100, mp: 50, maxMp: 50, ap: 10, maxAp: 10,
    xp: 0, maxXp: 1000, level: 1,
    shield: 0,
    currency: 150,
    currencySymbol: "G",   // Custom Symbol
    currencyRate: 0,       // 0 = Disabled, 10 = $10 per 1 Gold
    inventory: { items: [], skills: [], assets: [], statuses: [], equipped: [] },
    journal: { active: [], pending: [], abandoned: [], completed: [], codex: [] },
    social: { friends:[], enemies:[] },
    worldState: { location: "Unknown", threat: "None", status: "Normal", time: "Day", weather: "Clear", custom: {} },
    memories: { auto: false, chunks: [], lastIndex: 0, lastLen: 0 },
    diary: [],
    kitchenStyle: "modern",
    kitchenBgModern: "https://user.uploads.dev/file/4b56f0173d6b404e05bcdf1518d377be.jpg",
    kitchenBgMedieval: "https://user.uploads.dev/file/6995d56b2ee966ceff929f0199c82be7.jpg",
    phone: {
        bg: "",
        lockBg: "",
        deviceSkin: "classic",
        unlockedDevices: ["classic"],
        books: [],
        arrivals: [],
        smsThreads: {},
        windowPos: { x: null, y: null },
        browser: { pages: {}, history: [], index: -1 },
        customApps: [],
        bookmarks: [],
        sentColor: "#007aff",
        recvColor: "#e5e5ea",
        css: "",
        pin: ""
    },
    codex: { entries: [] },
    calendar: { events: {}, cursor: "" },
    battle: { auto: false, state: { active: false, enemies: [], turnOrder: [], log: [] } },
    character: { name: "", className: "Sanguine Shinobi", level: 1, avatar: "", portrait: "", syncPersona: true, reborn: false, activeMedallion: null, statPoints: 5, classLibrary: ["Sanguine Shinobi"], stats: { str:10,dex:10,con:10,int:10,wis:10,cha:10,per:10,luk:10,agi:10,vit:10,end:10,spi:10 }, statusEffects: [] },
    ui: {
        showPopups: true,
        notifications: {
            css: "",
            categories: {
                api: true,
                loot: true,
                currency: true,
                xp: true,
                levelUp: true,
                lowHp: true,
                phoneCalls: true,
                phoneMessages: false,
                questsAccepted: true,
                questsAbandoned: true,
                questsFailed: true,
                questsCompleted: true,
                postBattle: true,
                social: true
            },
            lowHp: { enabled: false, threshold: 0.25, lastWarnAt: 0 },
            postBattle: { enabled: false, lastSig: "" }
        },
        backgrounds: { menu: "", inventory: "", shop: "", journal: "", social: "https://user.uploads.dev/file/1d289e00dd974cb59c66d76cb8bcc1f1.png", party: "", phone: "", map: "" },
        icons: { heart: "" },
        css: { global: "" }
    },
    uiScale: 1.0,
    uiScaleUserSet: false,
    characterClass: "Sanguine Shinobi",
    turbo: { enabled: false, url: "https://openrouter.ai/api/v1/chat/completions", key: "", model: "google/gemini-2.0-flash-exp" },
    image: { enabled: false, url: "https://api.openai.com/v1/images/generations", key: "", model: "dall-e-3", negativePrompt: "", features: { map: true, doll: true, social: true, phoneBg: true, msg: true, party: true, items: true }, comfy: { workflow: "", checkpoint: "", quality: "balanced", positiveNodeId: "", negativeNodeId: "", outputNodeId: "" } },
    connections: { activeProfileId: "", profiles: [] },
    chatbox: { theme: "visual_novel", textScale: 1.0, highContrast: false, bgUrl: "" },
    chatState: { activeKey: "", states: {} }
};

function getSettingsStore() {
    try {
        if (extension_settings && typeof extension_settings === "object") return extension_settings;
    } catch (_) {}
    try {
        const w = typeof window !== "undefined" ? window : globalThis;
        if (!w.extension_settings || typeof w.extension_settings !== "object") w.extension_settings = {};
        return w.extension_settings;
    } catch (_) {
        return {};
    }
}

export function getSettings() {
    const store = getSettingsStore();
    if (!store[EXT_ID]) store[EXT_ID] = deepClone(SETTINGS_DEFAULT);
    return store[EXT_ID];
}

export function saveSettings() {
    try { if (typeof saveSettingsDebounced === "function") saveSettingsDebounced(); } catch (_) {}
}
export function emitStateUpdated() {
    try { $(document).trigger("uie:stateUpdated"); } catch (_) {}
}

export function commitStateUpdate(opts = {}) {
    const save = opts?.save !== false;
    const layout = opts?.layout !== false;
    const emit = opts?.emit !== false;
    if (save) saveSettings();
    if (layout) updateLayout();
    if (emit) emitStateUpdated();
}

export function withSettings(mutator, opts = {}) {
    const s = getSettings();
    try { if (typeof mutator === "function") mutator(s); } catch (_) {}
    commitStateUpdate(opts);
    return s;
}

const CHAT_SCOPED_KEYS = [
    "permadeath",
    "hearts", "maxHearts",
    "hp", "maxHp", "mp", "maxMp", "ap", "maxAp",
    "xp", "maxXp", "level", "shield",
    "currency", "currencySymbol",
    "map",
    "inventory",
    "shop",
    "journal",
    "activities",
    "party",
    "worldState",
    "memories",
    "diary",
    "phone",
    "codex",
    "calendar",
    "battle",
    "character",
    "databank",
    "social",
    "socialMeta",
    "quests",
    "life"
];

const FULL_STATE_KEYS = Object.keys(SETTINGS_DEFAULT).filter(k => k !== "chatState");

function deepClone(v) {
    if (v === undefined) return undefined;
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
}

function getChatKeyCandidatesSafe() {
    try {
        const ctx = getContext ? getContext() : null;
        const chatId =
            String(ctx?.chatId || ctx?.chat_id || ctx?.chatID || ctx?.chat?.id || ctx?.chat?.chatId || ctx?.chat?.chat_id || ctx?.saveId || "").trim();
        const chatName =
            String(ctx?.chatName || ctx?.chat_name || ctx?.chat?.name || ctx?.chat?.chatName || "").trim();
        const chatFile =
            String(ctx?.chatFile || ctx?.chat_file || ctx?.chat?.file || ctx?.chat?.filename || ctx?.chat?.path || "").trim();
        const cands = [];
        const add = (k) => {
            const v = String(k || "").trim();
            if (!v) return;
            if (!cands.includes(v)) cands.push(v);
        };
        if (chatFile) add(`chat:${chatFile}`);
        if (chatId) add(`chat:${chatId}`);
        if (chatName) add(`chat:${chatName}`);

        const groupId = String(ctx?.groupId || "").trim();
        const characterId = String(ctx?.characterId || "").trim();
        const name1 = String(ctx?.name1 || "").trim();
        const name2 = String(ctx?.name2 || "").trim();
        const parts = [];
        if (groupId) parts.push(`group:${groupId}`);
        if (characterId) parts.push(`char:${characterId}`);
        if (name1) parts.push(`n1:${name1}`);
        if (name2) parts.push(`n2:${name2}`);
        if (parts.length) add(parts.join("|"));
        return cands;
    } catch (_) {
        return [];
    }
}

function snapshotChatState(s) {
    const out = {};
    for (const k of CHAT_SCOPED_KEYS) {
        if (s[k] === undefined) continue;
        out[k] = deepClone(s[k]);
    }
    return out;
}

function snapshotFullState(s) {
    const out = deepClone(s) || {};
    try { delete out.chatState; } catch (_) { out.chatState = undefined; }
    return out;
}

function applyFullState(s, state) {
    const st0 = state && typeof state === "object" ? deepClone(state) : {};
    try { delete st0.chatState; } catch (_) { st0.chatState = undefined; }

    const prevChatState = s.chatState;
    try {
        for (const k of Object.keys(s)) {
            if (k === "chatState") continue;
            try { delete s[k]; } catch (_) { s[k] = undefined; }
        }
    } catch (_) {}

    try {
        for (const [k, v] of Object.entries(st0)) {
            if (k === "chatState") continue;
            s[k] = v;
        }
    } catch (_) {}
    if (prevChatState !== undefined) s.chatState = prevChatState;

    try { sanitizeSettings(); } catch (_) {}
}

function ensureManualSaveStore(s) {
    if (!s) return { key: "legacy:global", bucket: {} };
    if (!s.chatState || typeof s.chatState !== "object") s.chatState = { activeKey: "", states: {} };
    if (typeof s.chatState.legacyKey !== "string") s.chatState.legacyKey = "legacy:global";
    const key = String(s.chatState.activeKey || s.chatState.legacyKey || "legacy:global");
    if (!s.chatState.manualSaves || typeof s.chatState.manualSaves !== "object") s.chatState.manualSaves = {};
    if (!s.chatState.manualSaves[key] || typeof s.chatState.manualSaves[key] !== "object") s.chatState.manualSaves[key] = {};
    return { key, bucket: s.chatState.manualSaves[key] };
}

function listManualSaveNames(s) {
    try {
        const { bucket } = ensureManualSaveStore(s);
        return Object.keys(bucket || {}).sort((a, b) => a.localeCompare(b));
    } catch (_) {
        return [];
    }
}

function refreshStateSaveSelects() {
    const s = getSettings();
    const names = listManualSaveNames(s);
    $(".uie-state-select").each(function () {
        const sel = this;
        const cur = String($(sel).val() || "");
        try {
            sel.innerHTML = "";
            sel.appendChild(new Option("(Select Save...)", ""));
            for (const nm of names) sel.appendChild(new Option(nm, nm));
            if (cur && names.includes(cur)) $(sel).val(cur);
        } catch (_) {}
    });
}

function applyChatState(s, state, isNewChat = false) {
    const st = state && typeof state === "object" ? state : {};
    for (const k of CHAT_SCOPED_KEYS) {
        if (st[k] !== undefined) {
            s[k] = deepClone(st[k]);
            continue;
        }
        // If it's a new chat, we must reset to default to avoid leaking data from previous chat.
        // If it's an existing chat but the key is missing, we also reset to default (assuming it was never set or cleared).
        // However, user reported data loss. If we are reloading an existing chat and a key is missing from the snapshot,
        // it might be better to KEEP the current value? No, that leaks.
        // The user said: "Only 'reset' on new chat".
        // So if !isNewChat and st[k] is undefined, maybe we should Preserve?
        // But if I delete an item in Chat A, then switch to Chat B, then back to Chat A...
        // Chat A's state should reflect the deletion.
        // The issue is likely that 'st' is NOT fully populated when it should be.

        // Implemented User Request: "Never clear module data unless the user explicitly hits reset."
        // This is risky for cross-talk, but let's try to be conservative.
        if (isNewChat) {
             if (SETTINGS_DEFAULT[k] !== undefined) {
                s[k] = deepClone(SETTINGS_DEFAULT[k]);
            } else if (k === "databank" || k === "quests") {
                s[k] = [];
            } else if (k === "life") {
                s[k] = { trackers: [] };
            } else if (k === "socialMeta") {
                s[k] = { autoScan: false, deletedNames: [] };
            } else {
                s[k] = undefined;
            }
        }
        // If not new chat, and key is missing, we do NOTHING (preserve current memory state).
        // User requested: "Never clear module data unless the user explicitly hits reset."
        // This prevents data loss if the snapshot was partial or corrupted.
        // It implies that if Chat B has no saved inventory, it inherits Chat A's inventory (if we just switched).
        // This is "leaking", but safer than "deleting".
        else {
            // Do NOT reset. Preserve s[k].
            // If s[k] is undefined (fresh boot), load default.
            if (s[k] === undefined) {
                if (SETTINGS_DEFAULT[k] !== undefined) s[k] = deepClone(SETTINGS_DEFAULT[k]);
                else if (k === "databank" || k === "quests") s[k] = [];
                else if (k === "life") s[k] = { trackers: [] };
                else if (k === "socialMeta") s[k] = { autoScan: false, deletedNames: [] };
            }
        }
    }
}

export function ensureChatStateLoaded() {
    const store = getSettingsStore();
    const s = store?.[EXT_ID];
    if (!s) return;
    if (!s.chatState || typeof s.chatState !== "object") s.chatState = { activeKey: "", states: {} };
    if (typeof s.chatState.activeKey !== "string") s.chatState.activeKey = "";
    if (!s.chatState.states || typeof s.chatState.states !== "object") s.chatState.states = {};
    if (typeof s.chatState.legacyKey !== "string") s.chatState.legacyKey = "legacy:global";
    if (!s.chatState.states[s.chatState.legacyKey]) {
        try { s.chatState.states[s.chatState.legacyKey] = snapshotChatState(s); } catch (_) {}
    }

    const candidates = getChatKeyCandidatesSafe();
    if (!candidates.length) return;
    const key = candidates.find((k) => s.chatState.states[k]) || candidates[0];
    const cur = String(s.chatState.activeKey || "").trim();

    try {
        if (!s.chatState.manualSaves || typeof s.chatState.manualSaves !== "object") s.chatState.manualSaves = {};
        if (!s.chatState.manualSaves[s.chatState.legacyKey] || typeof s.chatState.manualSaves[s.chatState.legacyKey] !== "object") s.chatState.manualSaves[s.chatState.legacyKey] = {};
        if (!s.chatState.manualSaves[key] || typeof s.chatState.manualSaves[key] !== "object") s.chatState.manualSaves[key] = {};
        if (cur && (!s.chatState.manualSaves[cur] || typeof s.chatState.manualSaves[cur] !== "object")) s.chatState.manualSaves[cur] = {};
    } catch (_) {}

    // Initial Load (No active key yet)
    if (!cur) {
        s.chatState.activeKey = key;
        if (s.chatState.states[key]) {
             // Found existing state -> Load it
             applyChatState(s, s.chatState.states[key], false);
        } else {
             // No existing state -> New Chat -> Snapshot current defaults (or whatever is in 's')
             // But 's' might be dirty from global defaults.
             // We should probably ensure 's' is clean defaults?
             // Actually, if we just loaded, 's' is SETTINGS_DEFAULT.
             s.chatState.states[key] = snapshotChatState(s);
        }
        return;
    }

    // Same chat - do nothing (prevents reload/tab switch resets)
    if (cur === key) return;

    // Switching Chats
    // 1. Snapshot current state to 'cur'
    try { s.chatState.states[cur] = snapshotChatState(s); } catch (_) {}

    // 2. Load 'key'
    const next = s.chatState.states[key];
    if (next) {
        applyChatState(s, next, false);
    } else {
        // New Chat detected (or key not found)
        // User requested: "Never clear module data unless the user explicitly hits reset."
        // We pass isNewChat=false to PRESERVE the current state (carry-over from previous chat)
        // instead of resetting to defaults. This prevents data loss if the key changes or is temporary.
        applyChatState(s, {}, false);
        try { s.chatState.states[key] = snapshotChatState(s); } catch (_) {}
    }

    s.chatState.activeKey = key;
    // Save immediately after switch to persist the new active key and state
    saveSettings();
    // Force layout update and emit event so UI refreshes
    updateLayout();
    emitStateUpdated();
}

let uieChatStateWatch = null;
export function startChatStateWatcher() {
    if (uieChatStateWatch) return;
    try { ensureChatStateLoaded(); } catch (_) {}
    uieChatStateWatch = setInterval(() => {
        try { ensureChatStateLoaded(); } catch (_) {}
    }, 900);
}

export function isMobileUI() {
    try {
        const nav = (typeof navigator !== "undefined" ? navigator : null);
        const ua = String(nav?.userAgent || "");
        const uaLooksMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        if (uaLooksMobile) return true;
        const touchCapable =
            (typeof window !== "undefined" && ("ontouchstart" in window)) ||
            (nav && Number(nav.maxTouchPoints || 0) > 0) ||
            (nav && Number(nav.msMaxTouchPoints || 0) > 0);

        const w = Number(window.innerWidth || 0);
        const h = Number(window.innerHeight || 0);
        const minDim = Math.min(w || 0, h || 0);

        // Phone/tablet in landscape can have width > 700 while height is small.
        // Some mobile browsers in "desktop site" mode report larger CSS pixels.
        // Only treat small-ish min-dimension as mobile when the device is touch-capable.
        if (touchCapable && minDim > 0 && minDim <= 1100) return true;

        const smallScreen = window.matchMedia("(max-width: 700px)").matches;
        if (smallScreen) return true;

        const coarse = window.matchMedia("(pointer: coarse)").matches;
        const noHover = window.matchMedia("(hover: none)").matches;

        // Avoid false mobile detection on touch-capable desktops/laptops:
        // require a coarse pointer AND no hover when using touch capability.
        return touchCapable && coarse && noHover;
    } catch (_) {
        return window.innerWidth <= 700;
    }
}

export function sanitizeSettings() {
    const store = getSettingsStore();
    if (!store[EXT_ID]) store[EXT_ID] = deepClone(SETTINGS_DEFAULT);
    const s = store[EXT_ID];
    for(const k in SETTINGS_DEFAULT) if(s[k] === undefined) s[k] = deepClone(SETTINGS_DEFAULT[k]);

    if (isNaN(parseFloat(s.uiScale))) s.uiScale = 1.0;
    if (typeof s.uiScaleUserSet !== "boolean") s.uiScaleUserSet = false;
    try {
        const isMobile = isMobileUI();
        if (isMobile && s.uiScaleUserSet !== true) {
            const cur = Number(s.uiScale);
            if (!Number.isFinite(cur) || cur === 1.0) {
                s.uiScale = 0.9;
            }
        }
    } catch (_) {}
    if (!s.phone) s.phone = SETTINGS_DEFAULT.phone;
    if (!s.phone.browser) s.phone.browser = { pages: {}, history: [], index: -1 };
    if (!s.phone.browser.pages) s.phone.browser.pages = {};
    if (!Array.isArray(s.phone.browser.history)) s.phone.browser.history = [];
    if (typeof s.phone.browser.index !== "number") s.phone.browser.index = -1;
    if (!Array.isArray(s.phone.unlockedDevices)) s.phone.unlockedDevices = ["classic"];
    if (!Array.isArray(s.phone.customApps)) s.phone.customApps = [];
    if (!Array.isArray(s.phone.bookmarks)) s.phone.bookmarks = [];
    if (!Array.isArray(s.phone.books)) s.phone.books = [];
    if (!Array.isArray(s.phone.arrivals)) s.phone.arrivals = [];
    if (!s.phone.smsThreads || typeof s.phone.smsThreads !== "object") s.phone.smsThreads = {};
    if (!s.phone.windowPos || typeof s.phone.windowPos !== "object") s.phone.windowPos = { x: null, y: null };
    if (s.phone.windowPos.x !== null && !Number.isFinite(Number(s.phone.windowPos.x))) s.phone.windowPos.x = null;
    if (s.phone.windowPos.y !== null && !Number.isFinite(Number(s.phone.windowPos.y))) s.phone.windowPos.y = null;
    if (!s.codex) s.codex = SETTINGS_DEFAULT.codex;
    if (!Array.isArray(s.codex.entries)) s.codex.entries = [];
    if (!s.calendar) s.calendar = SETTINGS_DEFAULT.calendar;
    if (!s.calendar.events || typeof s.calendar.events !== "object") s.calendar.events = {};
    if (typeof s.calendar.cursor !== "string") s.calendar.cursor = "";
    if (typeof s.calendar.rpEnabled !== "boolean") s.calendar.rpEnabled = false;
    if (typeof s.calendar.rpDate !== "string") s.calendar.rpDate = "";
    if (!s.battle) s.battle = SETTINGS_DEFAULT.battle;
    if (typeof s.battle.auto !== "boolean") s.battle.auto = false;
    if (!s.battle.state) s.battle.state = SETTINGS_DEFAULT.battle.state;
    if (!Array.isArray(s.battle.state.enemies)) s.battle.state.enemies = [];
    if (!Array.isArray(s.battle.state.turnOrder)) s.battle.state.turnOrder = [];
    if (!Array.isArray(s.battle.state.log)) s.battle.state.log = [];
    if (!s.character) s.character = SETTINGS_DEFAULT.character;
    if (s.character.syncPersona === undefined) s.character.syncPersona = true;
    if (typeof s.character.statPoints !== "number") s.character.statPoints = SETTINGS_DEFAULT.character.statPoints || 0;
    if (!Array.isArray(s.character.classLibrary)) s.character.classLibrary = ["Sanguine Shinobi"];
    if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = { ...SETTINGS_DEFAULT.character.stats };
    const d = SETTINGS_DEFAULT.character.stats;
    for (const k of Object.keys(d)) {
        if (!Number.isFinite(Number(s.character.stats[k]))) s.character.stats[k] = d[k];
    }
    if (!Array.isArray(s.character.statusEffects)) s.character.statusEffects = [];
    if (!s.rpg) s.rpg = { ...SETTINGS_DEFAULT.rpg };
    if (!s.rpg.mode) s.rpg.mode = "adventurer";
    if (!s.generation) s.generation = SETTINGS_DEFAULT.generation;
    if (typeof s.generation.requireConfirm !== "boolean") s.generation.requireConfirm = false;
    if (typeof s.generation.promptUI !== "boolean") s.generation.promptUI = true;
    if (typeof s.generation.aiConfirm !== "boolean") s.generation.aiConfirm = false;
    if (typeof s.generation.scanOnlyOnGenerateButtons !== "boolean") s.generation.scanOnlyOnGenerateButtons = false;
    if (typeof s.generation.allowSystemChecks !== "boolean") s.generation.allowSystemChecks = false;
    if (typeof s.generation.scanAllEnabled !== "boolean") s.generation.scanAllEnabled = false;
    if (!Number.isFinite(Number(s.generation.systemCheckMinIntervalMs))) s.generation.systemCheckMinIntervalMs = Number(SETTINGS_DEFAULT.generation.systemCheckMinIntervalMs ?? 20000) || 20000;
    if (!Number.isFinite(Number(s.generation.autoScanMinIntervalMs))) s.generation.autoScanMinIntervalMs = Number(SETTINGS_DEFAULT.generation.autoScanMinIntervalMs ?? 8000) || 8000;
    if (typeof s.generation.customSystemPrompt !== "string") s.generation.customSystemPrompt = String(s.generation.customSystemPrompt || "");
    if (!s.generation.promptPrefixes || typeof s.generation.promptPrefixes !== "object") s.generation.promptPrefixes = { global: "", byType: {} };
    if (typeof s.generation.promptPrefixes.global !== "string") s.generation.promptPrefixes.global = String(s.generation.promptPrefixes.global || "");
    if (!s.generation.promptPrefixes.byType || typeof s.generation.promptPrefixes.byType !== "object") s.generation.promptPrefixes.byType = {};
    for (const [k, v] of Object.entries(s.generation.promptPrefixes.byType)) {
        if (typeof v !== "string") s.generation.promptPrefixes.byType[k] = String(v || "");
    }
    if (!s.ui) s.ui = SETTINGS_DEFAULT.ui;
    if (s.ui.showPopups === undefined) s.ui.showPopups = true;
    if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = SETTINGS_DEFAULT.ui.notifications;
    if (!s.ui.notifications.categories || typeof s.ui.notifications.categories !== "object") s.ui.notifications.categories = SETTINGS_DEFAULT.ui.notifications.categories;
    for (const k of Object.keys(SETTINGS_DEFAULT.ui.notifications.categories)) {
        if (s.ui.notifications.categories[k] === undefined) s.ui.notifications.categories[k] = SETTINGS_DEFAULT.ui.notifications.categories[k];
    }
    if (!s.ui.notifications.lowHp || typeof s.ui.notifications.lowHp !== "object") s.ui.notifications.lowHp = { ...SETTINGS_DEFAULT.ui.notifications.lowHp };
    if (s.ui.notifications.lowHp.enabled === undefined) s.ui.notifications.lowHp.enabled = SETTINGS_DEFAULT.ui.notifications.lowHp.enabled;
    if (!Number.isFinite(Number(s.ui.notifications.lowHp.threshold))) s.ui.notifications.lowHp.threshold = SETTINGS_DEFAULT.ui.notifications.lowHp.threshold;
    if (!Number.isFinite(Number(s.ui.notifications.lowHp.lastWarnAt))) s.ui.notifications.lowHp.lastWarnAt = 0;
    if (!s.ui.notifications.postBattle || typeof s.ui.notifications.postBattle !== "object") s.ui.notifications.postBattle = { ...SETTINGS_DEFAULT.ui.notifications.postBattle };
    if (s.ui.notifications.postBattle.enabled === undefined) s.ui.notifications.postBattle.enabled = SETTINGS_DEFAULT.ui.notifications.postBattle.enabled;
    if (s.ui.notifications.postBattle.lastSig === undefined) s.ui.notifications.postBattle.lastSig = "";
    if (s.ui.notifications.css === undefined) s.ui.notifications.css = "";
    if (!s.ui.backgrounds) s.ui.backgrounds = { ...SETTINGS_DEFAULT.ui.backgrounds };
    else {
        // Polyfill missing background keys
        for (const k in SETTINGS_DEFAULT.ui.backgrounds) {
            if (s.ui.backgrounds[k] === undefined) s.ui.backgrounds[k] = SETTINGS_DEFAULT.ui.backgrounds[k];
        }
    }
    if (!s.ui.css) s.ui.css = SETTINGS_DEFAULT.ui.css;
    if (!s.ai) s.ai = SETTINGS_DEFAULT.ai;
    for (const k of Object.keys(SETTINGS_DEFAULT.ai || {})) {
        if (typeof s.ai[k] !== "boolean") s.ai[k] = SETTINGS_DEFAULT.ai[k];
    }
    if (!s.turbo || typeof s.turbo !== "object") s.turbo = { ...SETTINGS_DEFAULT.turbo };
    if (typeof s.turbo.enabled !== "boolean") {
        const raw = String(s.turbo.enabled ?? "").toLowerCase().trim();
        s.turbo.enabled = raw === "true" ? true : raw === "false" ? false : SETTINGS_DEFAULT.turbo.enabled;
    }
    if (typeof s.turbo.url !== "string") s.turbo.url = String(s.turbo.url || SETTINGS_DEFAULT.turbo.url || "");
    if (typeof s.turbo.key !== "string") s.turbo.key = String(s.turbo.key || "");
    if (typeof s.turbo.model !== "string") s.turbo.model = String(s.turbo.model || SETTINGS_DEFAULT.turbo.model || "");

    if (!s.image || typeof s.image !== "object") s.image = { ...SETTINGS_DEFAULT.image };
    if (typeof s.image.enabled !== "boolean") s.image.enabled = SETTINGS_DEFAULT.image.enabled;
    if (typeof s.image.url !== "string") s.image.url = String(s.image.url || SETTINGS_DEFAULT.image.url || "");
    if (typeof s.image.key !== "string") s.image.key = String(s.image.key || "");
    if (typeof s.image.model !== "string") s.image.model = String(s.image.model || SETTINGS_DEFAULT.image.model || "");
    if (typeof s.image.negativePrompt !== "string") s.image.negativePrompt = String(s.image.negativePrompt || "");
    if (!s.image.features || typeof s.image.features !== "object") s.image.features = { ...SETTINGS_DEFAULT.image.features };
    for (const k of Object.keys(SETTINGS_DEFAULT.image.features || {})) {
        if (typeof s.image.features[k] !== "boolean") s.image.features[k] = SETTINGS_DEFAULT.image.features[k];
    }
    if (!s.image.comfy || typeof s.image.comfy !== "object") s.image.comfy = { ...SETTINGS_DEFAULT.image.comfy };
    if (typeof s.image.comfy.workflow !== "string") s.image.comfy.workflow = String(s.image.comfy.workflow || "");
    if (typeof s.image.comfy.checkpoint !== "string") s.image.comfy.checkpoint = String(s.image.comfy.checkpoint || "");
    if (String(s.image.comfy.checkpoint || "").trim() === "[object Object]") s.image.comfy.checkpoint = "";
    if (typeof s.image.comfy.quality !== "string") s.image.comfy.quality = String(s.image.comfy.quality || "balanced");
    if (typeof s.image.comfy.positiveNodeId !== "string") s.image.comfy.positiveNodeId = String(s.image.comfy.positiveNodeId || "");
    if (typeof s.image.comfy.negativeNodeId !== "string") s.image.comfy.negativeNodeId = String(s.image.comfy.negativeNodeId || "");
    if (typeof s.image.comfy.outputNodeId !== "string") s.image.comfy.outputNodeId = String(s.image.comfy.outputNodeId || "");

    if (!s.connections || typeof s.connections !== "object") s.connections = { ...SETTINGS_DEFAULT.connections };
    if (typeof s.connections.activeProfileId !== "string") s.connections.activeProfileId = "";
    if (!Array.isArray(s.connections.profiles)) s.connections.profiles = [];
    s.connections.profiles = s.connections.profiles
        .filter(p => p && typeof p === "object")
        .map(p => ({
            id: String(p.id || ""),
            name: String(p.name || "").slice(0, 60),
            turbo: p.turbo && typeof p.turbo === "object" ? {
                enabled: p.turbo.enabled === true,
                url: String(p.turbo.url || ""),
                key: String(p.turbo.key || ""),
                model: String(p.turbo.model || ""),
            } : null,
            image: p.image && typeof p.image === "object" ? {
                enabled: p.image.enabled === true,
                url: String(p.image.url || ""),
                key: String(p.image.key || ""),
                model: String(p.image.model || ""),
                negativePrompt: String(p.image.negativePrompt || ""),
                comfy: p.image.comfy && typeof p.image.comfy === "object" ? {
                    workflow: String(p.image.comfy.workflow || ""),
                    checkpoint: String(p.image.comfy.checkpoint || ""),
                    quality: String(p.image.comfy.quality || "balanced"),
                } : null,
            } : null,
        }))
        .filter(p => p.id && p.name);
    if (s.connections.activeProfileId && !s.connections.profiles.find(p => p.id === s.connections.activeProfileId)) s.connections.activeProfileId = "";

    if (!s.chatbox || typeof s.chatbox !== "object") s.chatbox = { ...SETTINGS_DEFAULT.chatbox };
    if (typeof s.chatbox.theme !== "string") s.chatbox.theme = SETTINGS_DEFAULT.chatbox.theme;
    if (!Number.isFinite(Number(s.chatbox.textScale))) s.chatbox.textScale = SETTINGS_DEFAULT.chatbox.textScale;
    if (typeof s.chatbox.highContrast !== "boolean") s.chatbox.highContrast = SETTINGS_DEFAULT.chatbox.highContrast;
    if (typeof s.chatbox.bgUrl !== "string") s.chatbox.bgUrl = String(s.chatbox.bgUrl || "");
    if (!s.features) s.features = SETTINGS_DEFAULT.features;
    if (!s.menuHidden) s.menuHidden = SETTINGS_DEFAULT.menuHidden;
    if (!s.launcher || typeof s.launcher !== "object") s.launcher = { ...SETTINGS_DEFAULT.launcher };
    if (typeof s.launcher.name !== "string") s.launcher.name = String(s.launcher.name || "");
    if (typeof s.launcher.src !== "string") s.launcher.src = String(s.launcher.src || "");
    if (typeof s.launcher.hidden !== "boolean") s.launcher.hidden = false;
    if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
    if (typeof s.launcher.lastUploadName !== "string") s.launcher.lastUploadName = String(s.launcher.lastUploadName || "");
    if (s.menuX === undefined) s.menuX = SETTINGS_DEFAULT.menuX;
    if (s.menuY === undefined) s.menuY = SETTINGS_DEFAULT.menuY;
    if (!s.party) s.party = SETTINGS_DEFAULT.party;
    if (!Array.isArray(s.party.members)) s.party.members = [];
    if (!Array.isArray(s.party.sharedItems)) s.party.sharedItems = [];
    if (!s.party.relationships || typeof s.party.relationships !== "object") s.party.relationships = {};
    if (!s.party.partyTactics) s.party.partyTactics = { preset: "Balanced", conserveMana: false, focus: "auto", protectId: "" };
    if (!s.party.formation) s.party.formation = { mode: "lanes", lanes: { front: [], mid: [], back: [] } };
    if (!s.party.formation.lanes) s.party.formation.lanes = { front: [], mid: [], back: [] };

    if (!s.worldState || typeof s.worldState !== "object") s.worldState = { ...SETTINGS_DEFAULT.worldState };
    if (!s.memories || typeof s.memories !== "object") s.memories = { ...SETTINGS_DEFAULT.memories };
    if (typeof s.memories.auto !== "boolean") s.memories.auto = SETTINGS_DEFAULT.memories.auto;
    if (!Array.isArray(s.memories.chunks)) s.memories.chunks = [];
    if (typeof s.memories.lastIndex !== "number") s.memories.lastIndex = 0;
    if (typeof s.memories.lastLen !== "number") s.memories.lastLen = 0;

    if (!s.inventory) s.inventory = SETTINGS_DEFAULT.inventory;
    if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
    if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
    if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
    if (!Array.isArray(s.inventory.statuses)) s.inventory.statuses = [];
    if (!Array.isArray(s.inventory.equipped)) s.inventory.equipped = [];

    if (!s.shop || typeof s.shop !== "object") s.shop = { ...SETTINGS_DEFAULT.shop };
    if (!Array.isArray(s.shop.catalog)) s.shop.catalog = [];
    if (typeof s.shop.keywords !== "string") s.shop.keywords = String(s.shop.keywords || "");

    if (!s.activities || typeof s.activities !== "object") s.activities = { ...SETTINGS_DEFAULT.activities };
    if (!Array.isArray(s.activities.active)) s.activities.active = [];
    if (!Array.isArray(s.activities.loops)) s.activities.loops = [];
    const symRaw = (typeof s.currencySymbol === "string") ? s.currencySymbol.trim() : "";
    const sym = symRaw || SETTINGS_DEFAULT.currencySymbol || "G";
    const curFromSetting = Number(s.currency);
    let curItem = s.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
    const curFromItem = Number(curItem?.qty);
    const amt = Number.isFinite(curFromSetting) ? Math.max(0, curFromSetting) : (Number.isFinite(curFromItem) ? Math.max(0, curFromItem) : 0);
    s.currencySymbol = sym;
    s.currency = amt;
    if (!curItem) {
        curItem = { kind: "item", name: `${sym} Currency`, type: "currency", symbol: sym, description: `Currency item for ${sym}.`, rarity: "common", qty: amt, mods: {}, statusEffects: [] };
        s.inventory.items.push(curItem);
    } else {
        curItem.qty = amt;
        if (!curItem.name) curItem.name = `${sym} Currency`;
        curItem.type = "currency";
        curItem.symbol = sym;
    }

    try { startChatStateWatcher(); } catch (_) {}
    try { ensureChatStateLoaded(); } catch (_) {}
    // saveSettings(); // Removed to prevent overwriting data on load race condition
    return s;
}

export function updateLayout() {
    const s = getSettings();
    const inv = $("#uie-inventory-window");
    const isFs = String(inv.attr("data-fullscreen") || "").toLowerCase() === "true" || inv.data("fullscreen") === true;
    const isMobile = isMobileUI();
    const scale = Number(s.uiScale) || 1;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const clampToViewport = (left, top, w, h, pad = 0) => {
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        // Keep at least some of the element visible even if it is larger than the viewport.
        // This avoids "stuck at top" when (vh - h) becomes negative (common on mobile + scaling).
        const minVisible = 40;
        const maxX = Math.max(pad, vw - minVisible);
        const maxY = Math.max(pad, vh - minVisible);
        const x = clamp(left, -Math.max(0, w - minVisible), maxX);
        const y = clamp(top, -Math.max(0, h - minVisible), maxY);
        return { x, y, vw, vh };
    };
    try {
        if (isMobile) document.body.classList.add("uie-mobile");
        else document.body.classList.remove("uie-mobile");
    } catch (_) {}
    try {
        $("#uie-scale-display").text(scale.toFixed(1));
        $("#uie-scale-slider").val(scale.toFixed(1));
        $("#uie-setting-enable").prop("checked", s.enabled === false);
        $("#uie-scanall-enable").prop("checked", s.generation?.scanAllEnabled === true);
        $("#uie-systemchecks-enable").prop("checked", s.generation?.allowSystemChecks === true);
        $("#uie-sw-scanall-enable").prop("checked", s.generation?.scanAllEnabled === true);
        $("#uie-sw-systemchecks-enable").prop("checked", s.generation?.allowSystemChecks === true);
    } catch (_) {}
    try {
        const img = (s.image && typeof s.image === "object") ? s.image : {};
        $("#uie-sw-img-enable").prop("checked", img.enabled === true);
        if (typeof img.url === "string") $("#uie-sw-img-url").val(img.url);
        if (typeof img.model === "string") $("#uie-sw-img-model").val(img.model);
        if (typeof img.key === "string") $("#uie-sw-img-key").val(img.key);
        const f = (img.features && typeof img.features === "object") ? img.features : {};
        $("#uie-sw-img-map").prop("checked", f.map !== false);
        $("#uie-sw-img-doll").prop("checked", f.doll !== false);
        $("#uie-sw-img-social").prop("checked", f.social !== false);
        $("#uie-sw-img-phone-bg").prop("checked", f.phoneBg !== false);
        $("#uie-sw-img-msg").prop("checked", f.msg !== false);
        $("#uie-sw-img-party").prop("checked", f.party !== false);
        $("#uie-sw-img-items").prop("checked", f.items !== false);
    } catch (_) {}

    // INVENTORY: Mobile layout - always fullscreen, position next to launcher
    if (isMobile) {
        // Always fullscreen on mobile
        inv.attr("data-fullscreen", "true");
        inv.css({ 
            top: 0, 
            left: 0, 
            width: "100vw", 
            height: "100vh", 
            transform: "none", 
            maxWidth: "none", 
            maxHeight: "none",
            position: "fixed",
            zIndex: "2147483600"
        });

        // PARTY: Match inventory behavior on mobile (fullscreen, no scaling)
        try {
            const party = $("#uie-party-window");
            if (party && party.length) {
                party.css({
                    top: 0,
                    left: 0,
                    width: "100vw",
                    height: "100vh",
                    transform: "none",
                    maxWidth: "none",
                    maxHeight: "none",
                    borderRadius: 0,
                    position: "fixed",
                    zIndex: "2147483600"
                });
            }
        } catch (_) {}
    } else if (isFs) {
        inv.css({ top: 0, left: 0, width: "100vw", height: "100vh", transform: "none", maxWidth: "none", maxHeight: "none" });
    } else {
        // Windowed Mode: Smart Position & Clamp
        inv.css({ width: "", height: "", maxWidth: "", maxHeight: "" }); // Reset to CSS
        let x = Number(s.posX);
        let y = Number(s.posY);
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // If default (100,100) or invalid, center it
        if (isNaN(x) || isNaN(y) || (x === 100 && y === 100)) {
             const w = inv.outerWidth() || Math.min(1150, vw * 0.92);
             const h = inv.outerHeight() || Math.min(950, vh * 0.92);
             x = (vw - w) / 2;
             y = (vh - h) / 2;
        }

        // Safety Clamp
        {
            const w = inv.outerWidth() || Math.min(1150, vw * 0.92);
            const h = inv.outerHeight() || Math.min(950, vh * 0.92);
            const pos = clampToViewport(x, y, w, h, 0);
            x = pos.x;
            y = pos.y;
        }

        inv.css({ left: x, top: y, transform: "none" });
    }

    // LAUNCHER: Position
    try {
        let lx = Number(s.launcherX);
        let ly = Number(s.launcherY);
        if (!Number.isFinite(lx)) lx = 20;
        if (!Number.isFinite(ly)) ly = 120;
        if (isMobile) {
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const w = $("#uie-launcher").outerWidth() || 60;
            const h = $("#uie-launcher").outerHeight() || 60;
            lx = Math.max(0, Math.min(lx, vw - w));
            ly = Math.max(0, Math.min(ly, vh - h));
            s.launcherX = lx;
            s.launcherY = ly;
        }
        $("#uie-launcher").css({ top: ly, left: lx, right: "auto", bottom: "auto" });
    } catch (_) {
        $("#uie-launcher").css({ top: s.launcherY, left: s.launcherX, right: "auto", bottom: "auto" });
    }
    try {
        if (s.launcher?.hidden === true) $("#uie-launcher").hide();
        else $("#uie-launcher").show();
    } catch (_) {}
    const baseUrl = (() => {
        try {
            const u = String(window.UIE_BASEURL || "");
            if (u) return u.endsWith("/") ? u : `${u}/`;
        } catch (_) {}
        return "/scripts/extensions/third-party/universal-immersion-engine/";
    })();

    const defaultIcon = "https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png";
    let icon = String(s.launcher?.src || s.launcherIcon || defaultIcon);
    if (/^\.\//.test(icon)) icon = icon.slice(2);
    if (/^assets\/launcher\//i.test(icon) || /^\/assets\/launcher\//i.test(icon)) {
        icon = `${baseUrl}${icon.replace(/^\/+/, "")}`;
    }
    if (/^assets\//i.test(icon)) icon = `${baseUrl}${icon.replace(/^\/+/, "")}`;

    const launcherEl = document.getElementById("uie-launcher");
    if (launcherEl && !launcherEl.querySelector(".uie-launcher-fallback")) {
        launcherEl.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none;stroke:#cba35c;stroke-width:2;display:block;opacity:0.92;" class="uie-launcher-fallback"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`);
    }

    const knownOk = (() => {
        if (!icon) return false;
        if (icon.startsWith("data:")) return true;
        if (uieLauncherIconProbe.src === icon && Date.now() - Number(uieLauncherIconProbe.t || 0) < 60 * 60 * 1000) return uieLauncherIconProbe.ok;
        return null;
    })();

    try {
        const fb = launcherEl ? launcherEl.querySelector(".uie-launcher-fallback") : null;
        if (fb) fb.style.display = knownOk === true ? "none" : "block";
    } catch (_) {}

    if (knownOk === null && icon && !icon.startsWith("data:")) {
        const src = icon;
        uieLauncherIconProbe = { src, ok: null, t: Date.now() };
        try {
            const img = new Image();
            img.onload = () => {
                uieLauncherIconProbe = { src, ok: true, t: Date.now() };
                const el = document.getElementById("uie-launcher");
                const fb = el ? el.querySelector(".uie-launcher-fallback") : null;
                if (fb) fb.style.display = "none";
            };
            img.onerror = () => {
                uieLauncherIconProbe = { src, ok: false, t: Date.now() };
                const el = document.getElementById("uie-launcher");
                const fb = el ? el.querySelector(".uie-launcher-fallback") : null;
                if (fb) fb.style.display = "block";
                try { $("#uie-launcher").css({ backgroundImage: "" }); } catch (_) {}
            };
            img.src = src;
        } catch (_) {}
    }

    $("#uie-launcher").css({
        backgroundImage: icon && knownOk !== false ? `url("${icon}")` : "",
        backgroundSize: "contain",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundColor: "transparent",
        border: "none",
        borderRadius: "6px",
        boxShadow: "none",
        filter: icon ? "drop-shadow(0 0 8px rgba(0,0,0,0.55))" : ""
    });

    // Add subtle shadow only if it's the default round one? No, usually icons need drop-shadow filter
    // We can add filter: drop-shadow(...) via CSS, but let's leave it clean for now.

    // LAUNCHER NAME (Menu Title)
    if (s.launcher?.name) {
        $("#uie-menu-title").text(s.launcher.name);
        $("#uie-launcher").attr("title", s.launcher.name);
    } else {
        $("#uie-menu-title").text("SYSTEM MENU");
        $("#uie-launcher").attr("title", "Open Menu");
    }

    // MAIN MENU: keep draggable positioning; only auto-place when missing/off-screen
    const menuEl = document.getElementById("uie-main-menu");
    const isDraggingNow = (() => { try { return window.UIE_isDragging === true; } catch (_) { return false; } })();
    if (!isDraggingNow && isMobile && menuEl && getComputedStyle(menuEl).display !== "none") {
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const mrect = menuEl.getBoundingClientRect();
        const styleLeft = String(menuEl.style.left || "");
        const styleTop = String(menuEl.style.top || "");
        const usesPercent = styleLeft.includes("%") || styleTop.includes("%");
        let left = usesPercent ? NaN : Number.parseFloat(styleLeft);
        let top = usesPercent ? NaN : Number.parseFloat(styleTop);

        // If not set on element, try settings
        if (!Number.isFinite(left)) {
            const sx = (s.menuX === null || s.menuX === undefined) ? NaN : Number(s.menuX);
            if (Number.isFinite(sx)) left = sx;
        }
        if (!Number.isFinite(top)) {
            const sy = (s.menuY === null || s.menuY === undefined) ? NaN : Number(s.menuY);
            if (Number.isFinite(sy)) top = sy;
        }

        // Default: center only when unset/percent-based; otherwise keep/clamp pixel position.
        // Do NOT re-center just because it's "offscreen"; scaled windows can be larger than the viewport,
        // and that causes an endless reset loop which feels like the UI is stuck at the top.
        if (!Number.isFinite(left) || !Number.isFinite(top) || usesPercent) {
            $(menuEl).css({ left: "50%", top: "50%", transform: "translate(-50%, -50%)", position: "fixed" });
        } else {
            const w = mrect.width || 320;
            const h = mrect.height || 420;
            const pos = clampToViewport(left, top, w, h, 0);
            $(menuEl).css({ left: pos.x, top: pos.y, transform: "none", position: "fixed" });
        }
    } else if (!isMobile && menuEl && launcherEl && getComputedStyle(menuEl).display !== "none") {
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const mrect = menuEl.getBoundingClientRect();
        const lrect = launcherEl.getBoundingClientRect();
        const styleLeft = String(menuEl.style.left || "");
        const styleTop = String(menuEl.style.top || "");
        const usesPercent = styleLeft.includes("%") || styleTop.includes("%");
        let left = usesPercent ? NaN : Number.parseFloat(styleLeft);
        let top = usesPercent ? NaN : Number.parseFloat(styleTop);

        // If not set on element, try settings
        if (!Number.isFinite(left)) {
            const sx = (s.menuX === null || s.menuX === undefined) ? NaN : Number(s.menuX);
            if (Number.isFinite(sx)) left = sx;
        }
        if (!Number.isFinite(top)) {
            const sy = (s.menuY === null || s.menuY === undefined) ? NaN : Number(s.menuY);
            if (Number.isFinite(sy)) top = sy;
        }

        // Default behavior: open next to launcher (mobile + desktop)
        if (!Number.isFinite(left) || !Number.isFinite(top) || (left === 0 && top === 0)) {
            // Smart Positioning relative to Launcher - always position next to launcher
            const w = mrect.width || 320;
            const h = mrect.height || 420;

            // Prefer opening BESIDE the launcher (right, else left)
            left = lrect.right + 10;
            if (left + w > vw) left = lrect.left - w - 10;
            top = lrect.top;
        }

        if (Number.isFinite(left) && Number.isFinite(top)) {
            const w = mrect.width || 320;
            const h = mrect.height || 420;
            const pos = clampToViewport(left, top, w, h, 0);
            $("#uie-main-menu").css({ left: pos.x, top: pos.y, transform: "none", position: "fixed" });
        }
    } else if (!isMobile && Number.isFinite(Number(s.menuX)) && Number.isFinite(Number(s.menuY))) {
        const menu = document.getElementById("uie-main-menu");
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const topPad = 0; // Relaxed from 60
        const pad = 0; // Relaxed from 8
        const w = menu?.getBoundingClientRect?.().width || 320;
        const h = menu?.getBoundingClientRect?.().height || 420;

        // Free Drag: Allow menu to go anywhere, just keep a bit on screen
        const maxLeft = vw - 40; // Keep at least 40px visible on left
        const maxTop = vh - 40; // Keep at least 40px visible on top

        // We still want to ensure it's not completely lost, but "Free Drag" implies minimal clamping
        // Let's just clamp so it doesn't disappear entirely.
        const pos = clampToViewport(Number(s.menuX), Number(s.menuY), w, h, 0);
        $("#uie-main-menu").css({ left: pos.x, top: pos.y, transform: "none", position: "fixed" });
    }
    {
        const needsTranslate = (v) => typeof v === "string" && v.includes("%");
        $(".uie-window, #uie-main-menu, #uie-launcher").each(function () {
            const $el = $(this);
            const id = String($el.attr("id") || "");
            if (id === "uie-inventory-window") {
                const $panel = $el.find(".uie-inv-panel");
                if (isFs) $panel.css("transform", "");
                else $panel.css("transform", ""); // User requested no scaling for inventory
                $panel.css("transform-origin", "top left");
                $el.css("transform", "none");
                return;
            }
            if (id === "uie-party-window" && isMobile) {
                $el.css("transform", "none");
                $el.css("transform-origin", "");
                return;
            }
            if (isMobile && ($el.hasClass("uie-window") || id === "uie-main-menu")) {
                if (id === "uie-inventory-window") {
                    $el.css("transform", "none");
                    $el.css("transform-origin", "");
                    return;
                }
                // Apply scale on mobile while preserving centering translate when the element is opened centered
                const inlineTop = String($el[0]?.style?.top || "");
                const inlineLeft = String($el[0]?.style?.left || "");
                const isCentered = inlineTop.includes("%") && inlineLeft.includes("%");
                const base = isCentered ? "translate(-50%, -50%)" : "";
                const t = scale === 1 ? (base || "none") : `${base ? base + " " : ""}scale(${scale})`;
                $el.css("transform", t);
                $el.css("transform-origin", isCentered ? "" : "top left");
                return;
            }
            const top = $el.css("top");
            const left = $el.css("left");
            const useTranslate = needsTranslate(top) && needsTranslate(left);
            const t = scale === 1
                ? (useTranslate ? "" : "none")
                : (useTranslate ? `translate(-50%, -50%) scale(${scale})` : `scale(${scale})`);
            $el.css("transform", t);
            $el.css("transform-origin", useTranslate ? "" : "top left");
        });
    }
    if (s.enabled === false) $("#uie-launcher").css({ opacity: 0.6, filter: "grayscale(1)" });
    else $("#uie-launcher").css({ opacity: "", filter: "" });

    $("#uie-gen-prompt-wrap").toggle(s.generation?.promptUI !== false);

    // Feature Toggles (Kill Switches)
    if (s.features?.phoneEnabled === false) $("#uie-btn-open-phone").hide(); else $("#uie-btn-open-phone").show();
    if (s.features?.codexEnabled === false) $("#uie-btn-databank").hide(); else $("#uie-btn-databank").show();

    // Global Kill Switch
    if (s.enabled === false) {
        $("#uie-launcher").hide();
        $(".uie-window").hide();
        $("#uie-main-menu").hide();
    }

    const css = String(s.ui?.css?.global || "");
    let styleEl = document.getElementById("uie-user-css");
    if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "uie-user-css";
        document.head.appendChild(styleEl);
    }
    styleEl.textContent = css;

    const scopeCss = (input, scopeSel, inKeyframes = false) => {
        const cssText = String(input || "");
        if (!cssText.trim() || !scopeSel) return "";
        const s = String(scopeSel).trim();

        const findMatchingBrace = (str, openAt) => {
            let depth = 0;
            for (let i = openAt; i < str.length; i++) {
                const ch = str[i];
                if (ch === "{") depth++;
                else if (ch === "}") {
                    depth--;
                    if (depth === 0) return i;
                }
            }
            return -1;
        };

        const scopeSelectors = (selText) => {
            const raw = String(selText || "").trim();
            if (!raw) return raw;
            const parts = raw.split(",").map(x => String(x || "").trim()).filter(Boolean);
            const out = parts.map(p => {
                const lower = p.toLowerCase();
                if (p.startsWith(s)) return p;
                if (lower === ":root" || lower === "html" || lower === "body") return p;
                if (/^(from|to|\d+%)$/.test(lower)) return p;
                return `${s} ${p}`;
            });
            return out.join(", ");
        };

        const walk = (str, keyframesCtx = false) => {
            if (keyframesCtx) return String(str || "");
            let i = 0;
            let out = "";
            const src = String(str || "");
            while (i < src.length) {
                const ch = src[i];
                if (ch === "@") {
                    const semi = src.indexOf(";", i);
                    const open = src.indexOf("{", i);
                    if (open !== -1 && (semi === -1 || open < semi)) {
                        const header = src.slice(i, open + 1);
                        const close = findMatchingBrace(src, open);
                        if (close === -1) { out += src.slice(i); break; }
                        const inner = src.slice(open + 1, close);
                        const isKeyframes = /@(-webkit-)?keyframes/i.test(header);
                        out += header + walk(inner, isKeyframes) + "}";
                        i = close + 1;
                        continue;
                    }
                    if (semi !== -1) {
                        out += src.slice(i, semi + 1);
                        i = semi + 1;
                        continue;
                    }
                    out += ch;
                    i++;
                    continue;
                }

                const open = src.indexOf("{", i);
                if (open === -1) { out += src.slice(i); break; }
                const sel = src.slice(i, open);
                const close = findMatchingBrace(src, open);
                if (close === -1) { out += src.slice(i); break; }
                const body = src.slice(open, close + 1);
                out += scopeSelectors(sel) + body;
                i = close + 1;
            }
            return out;
        };

        return walk(cssText, inKeyframes);
    };

    const cssTargets = s.ui?.css?.targets && typeof s.ui.css.targets === "object" ? s.ui.css.targets : {};
    const scopeMap = {
        menu: "#uie-main-menu",
        inventory: "#uie-inventory-window",
        shop: "#uie-shop-window",
        journal: "#uie-journal-window",
        diary: "#uie-diary-window",
        social: "#uie-social-window",
        party: "#uie-party-window",
        phone: "#uie-phone-window",
        map: "#uie-map-window",
        stats: "#uie-stats-window",
        activities: "#uie-activities-window"
    };
    let scopedTargets = "";
    for (const k of Object.keys(scopeMap)) {
        const raw = String(cssTargets?.[k] || "");
        if (!raw.trim()) continue;
        const scoped = scopeCss(raw, scopeMap[k]);
        if (scoped.trim()) scopedTargets += scoped + "\n";
    }
    let styleTargetsEl = document.getElementById("uie-user-css-targets");
    if (!styleTargetsEl) {
        styleTargetsEl = document.createElement("style");
        styleTargetsEl.id = "uie-user-css-targets";
        document.head.appendChild(styleTargetsEl);
    }
    styleTargetsEl.textContent = scopedTargets.trim();

    const popupCssDefault = `
#toast-container > div.toast{
  background: rgba(15,10,8,0.92) !important;
  border: 1px solid rgba(225,193,122,0.35) !important;
  box-shadow: 0 18px 45px rgba(0,0,0,0.65) !important;
  border-radius: 14px !important;
  color: rgba(255,255,255,0.92) !important;
  font-family: serif !important;
  padding: 14px 14px 14px 14px !important;
  backdrop-filter: blur(6px) !important;
}
#toast-container > div.toast .toast-title{ font-weight: 900 !important; letter-spacing: 0.3px !important; }
#toast-container > div.toast .toast-message{ opacity: 0.92 !important; }
#toast-container > div.toast.toast-success{ border-color: rgba(46, 204, 113, 0.35) !important; }
#toast-container > div.toast.toast-warning{ border-color: rgba(241, 196, 15, 0.35) !important; }
#toast-container > div.toast.toast-error{ border-color: rgba(231, 76, 60, 0.35) !important; }
#toast-container > div.toast.toast-info{ border-color: rgba(52, 152, 219, 0.30) !important; }
#toast-container > .toast-progress{
  height: 2px !important;
  opacity: 0.9 !important;
  background-color: rgba(225,193,122,0.65) !important;
}
`;
    const popupCssUser = String(s.ui?.notifications?.css || "");
    let popupStyleEl = document.getElementById("uie-popup-css");
    if (!popupStyleEl) {
        popupStyleEl = document.createElement("style");
        popupStyleEl.id = "uie-popup-css";
        document.head.appendChild(popupStyleEl);
    }
    popupStyleEl.textContent = `${popupCssDefault}\n${popupCssUser}`;

    const bg = s.ui?.backgrounds || {};
    const setBg = (sel, url) => {
        if (!url) return;
        $(sel).css({ backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center" });
    };
    const clearBg = (sel, url) => {
        if (url !== "") return;
        $(sel).css({ backgroundImage: "" });
    };

    if (bg.menu !== undefined) { clearBg("#uie-main-menu", bg.menu); setBg("#uie-main-menu", bg.menu); }
    if (bg.inventory !== undefined) { clearBg("#uie-inventory-window .uie-inv-panel", bg.inventory); setBg("#uie-inventory-window .uie-inv-panel", bg.inventory); }
    if (bg.shop !== undefined) { clearBg("#uie-shop-window", bg.shop); setBg("#uie-shop-window", bg.shop); }
    if (bg.journal !== undefined) { clearBg("#uie-journal-window", bg.journal); setBg("#uie-journal-window", bg.journal); }
    if (bg.social !== undefined) { clearBg("#uie-social-window", bg.social); setBg("#uie-social-window", bg.social); }
    if (bg.party !== undefined) { clearBg("#uie-party-window", bg.party); setBg("#uie-party-window", bg.party); }
    if (bg.phone !== undefined) { clearBg("#uie-phone-window", bg.phone); setBg("#uie-phone-window", bg.phone); }
    if (bg.map !== undefined) { clearBg("#uie-map-window", bg.map); setBg("#uie-map-window", bg.map); }
}

// --- GLOBAL EVENT LISTENERS (Settings Window & More) ---
// We bind to body to ensure we catch events even if elements are re-injected
// We use a specific selector for the settings block to avoid conflicts
$("body").on("pointerup click touchstart", ".uie-settings-block .uie-set-tab", function(e) {
    e.preventDefault();
    e.stopPropagation(); // Stop propagation to prevent closing drawers if they are listening
    const tab = $(this).attr("data-tab");
    if(!tab) return;

    // Switch Active Class
    const container = $(this).closest(".uie-settings-block");
    container.find(".uie-set-tab").removeClass("active").css("border-bottom-color", "transparent").css("color", "#888");
    $(this).addClass("active").css("border-bottom-color", "#cba35c").css("color", "#cba35c");

    // Show Content
    // The content IDs are #uie-sw-{tab} inside #uie-settings-block
    // Note: The HTML structure in settings.html uses id="uie-set-{tab}" (e.g. uie-set-general)
    // Let's match the HTML structure we read: <div id="uie-set-general">
    container.find("[id^='uie-set-']").hide();
    container.find(`#uie-set-${tab}`).show();
});

$("body").on("pointerup click touchstart", "#uie-settings-window .uie-set-tab", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const tab = $(this).attr("data-tab");
    if (!tab) return;

    const container = $(this).closest("#uie-settings-window");
    container.find(".uie-set-tab").removeClass("active").css("border-bottom-color", "transparent").css("color", "#888");
    $(this).addClass("active").css("border-bottom-color", "#cba35c").css("color", "#fff");

    container.find("[id^='uie-sw-']").hide();
    container.find(`#uie-sw-${tab}`).show();
});

let uieLastStateBtnPointerTime = 0;

let uieSettingsApplyLastTouch = 0;

const uieSettingsRoot = (el) => $(el).closest("#uie-settings-window, .uie-settings-block");

$("body")
    .off("pointerup.uieCustomCssApply click.uieCustomCssApply", "#uie-settings-window #uie-custom-css-apply, .uie-settings-block #uie-custom-css-apply")
    .on("pointerup.uieCustomCssApply click.uieCustomCssApply", "#uie-settings-window #uie-custom-css-apply, .uie-settings-block #uie-custom-css-apply", function (e) {
        if (e?.type === "pointerup" && e.pointerType === "touch") {
            uieSettingsApplyLastTouch = Date.now();
        } else if (e?.type === "click" && Date.now() - uieSettingsApplyLastTouch < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        if (e?.type === "pointerup" && e.pointerType && e.pointerType !== "touch") return;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

        const root = uieSettingsRoot(this);
        const s = getSettings();
        if (!s.ui) s.ui = {};
        if (!s.ui.css) s.ui.css = {};
        if (!s.ui.css.targets || typeof s.ui.css.targets !== "object") s.ui.css.targets = {};
        s.ui.css.global = String(root.find("#uie-custom-css").val() || "");
        s.ui.css.targets.stats = String(root.find("#uie-custom-css-stats").val() || "");
        s.ui.css.targets.activities = String(root.find("#uie-custom-css-activities").val() || "");
        saveSettings();
        try { updateLayout(); } catch (_) {}
        try { window.toastr?.success?.("Applied CSS", "UIE"); } catch (_) {}
    });

$("body")
    .off("pointerup.uiePopupCssApply click.uiePopupCssApply", "#uie-settings-window #uie-popup-css-apply, .uie-settings-block #uie-popup-css-apply")
    .on("pointerup.uiePopupCssApply click.uiePopupCssApply", "#uie-settings-window #uie-popup-css-apply, .uie-settings-block #uie-popup-css-apply", function (e) {
        if (e?.type === "pointerup" && e.pointerType === "touch") {
            uieSettingsApplyLastTouch = Date.now();
        } else if (e?.type === "click" && Date.now() - uieSettingsApplyLastTouch < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        if (e?.type === "pointerup" && e.pointerType && e.pointerType !== "touch") return;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

        const root = uieSettingsRoot(this);
        const s = getSettings();
        if (!s.ui) s.ui = {};
        if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = {};
        s.ui.notifications.css = String(root.find("#uie-popup-css-text").val() || "");
        saveSettings();
        try { updateLayout(); } catch (_) {}
        try { window.toastr?.success?.("Applied popup CSS", "UIE"); } catch (_) {}
    });

$("body")
    .off("pointerup.uiePopupCssReset click.uiePopupCssReset", "#uie-settings-window #uie-popup-css-reset, .uie-settings-block #uie-popup-css-reset")
    .on("pointerup.uiePopupCssReset click.uiePopupCssReset", "#uie-settings-window #uie-popup-css-reset, .uie-settings-block #uie-popup-css-reset", function (e) {
        if (e?.type === "pointerup" && e.pointerType === "touch") {
            uieSettingsApplyLastTouch = Date.now();
        } else if (e?.type === "click" && Date.now() - uieSettingsApplyLastTouch < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        if (e?.type === "pointerup" && e.pointerType && e.pointerType !== "touch") return;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

        const root = uieSettingsRoot(this);
        root.find("#uie-popup-css-text").val("");
        const s = getSettings();
        if (!s.ui) s.ui = {};
        if (!s.ui.notifications || typeof s.ui.notifications !== "object") s.ui.notifications = {};
        s.ui.notifications.css = "";
        saveSettings();
        try { updateLayout(); } catch (_) {}
        try { window.toastr?.success?.("Reset popup CSS", "UIE"); } catch (_) {}
    });

$("body")
    .off("pointerup.uiePopupTest click.uiePopupTest", "#uie-settings-window #uie-popup-test, .uie-settings-block #uie-popup-test")
    .on("pointerup.uiePopupTest click.uiePopupTest", "#uie-settings-window #uie-popup-test, .uie-settings-block #uie-popup-test", function (e) {
        if (e?.type === "pointerup" && e.pointerType === "touch") {
            uieSettingsApplyLastTouch = Date.now();
        } else if (e?.type === "click" && Date.now() - uieSettingsApplyLastTouch < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        if (e?.type === "pointerup" && e.pointerType && e.pointerType !== "touch") return;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        try { window.toastr?.info?.("This is a test popup.", "UIE"); } catch (_) {}
    });

try { window.UIE_refreshStateSaves = refreshStateSaveSelects; } catch (_) {}

$("body")
    .off("pointerup.uieStateSave click.uieStateSave", ".uie-state-save-btn")
    .on("pointerup.uieStateSave click.uieStateSave", ".uie-state-save-btn", function (e) {
        if (e?.type === "pointerup") {
            if (e.pointerType && e.pointerType !== "touch") return;
            uieLastStateBtnPointerTime = Date.now();
        } else if (e?.type === "click" && Date.now() - uieLastStateBtnPointerTime < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        try { ensureChatStateLoaded(); } catch (_) {}
        const root = $(this).closest("#uie-settings-window, .uie-settings-block");
        const rawName = String(root.find(".uie-state-name").first().val() || "").trim();
        const { bucket } = ensureManualSaveStore(s);

        let name = rawName;
        if (!name) {
            const base = "Save";
            let n = 1;
            while (bucket[`${base} ${n}`]) n++;
            name = `${base} ${n}`;
        }
        name = name.slice(0, 80);
        bucket[name] = { ts: Date.now(), kind: "full", state: snapshotFullState(s) };
        saveSettings();
        refreshStateSaveSelects();
        root.find(".uie-state-select").val(name);
        root.find(".uie-state-name").val(name);
        try { window.toastr?.success?.(`Saved state: ${name}`); } catch (_) {}
    });

$("body")
    .off("pointerup.uieStateLoad click.uieStateLoad", ".uie-state-load-btn")
    .on("pointerup.uieStateLoad click.uieStateLoad", ".uie-state-load-btn", function (e) {
        if (e?.type === "pointerup") {
            if (e.pointerType && e.pointerType !== "touch") return;
            uieLastStateBtnPointerTime = Date.now();
        } else if (e?.type === "click" && Date.now() - uieLastStateBtnPointerTime < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        try { ensureChatStateLoaded(); } catch (_) {}
        const root = $(this).closest("#uie-settings-window, .uie-settings-block");
        const name = String(root.find(".uie-state-select").first().val() || "").trim();
        if (!name) return;
        const { bucket } = ensureManualSaveStore(s);
        const entry = bucket?.[name];
        const snap = entry && typeof entry === "object" ? entry.state : null;
        const kind = entry && typeof entry === "object" ? String(entry.kind || "") : "";
        if (!snap || typeof snap !== "object") return;
        if (kind === "full" || snap.enabled !== undefined || snap.ui !== undefined || snap.turbo !== undefined) {
            applyFullState(s, snap);
        } else {
            applyChatState(s, snap, false);
        }

        // IMPORTANT:
        // Keep the per-chat autosave snapshot in sync with what we just loaded.
        // Otherwise, the periodic ensureChatStateLoaded() / chat switching logic can
        // re-apply an older snapshot and make it look like the load "didn't stick".
        try {
            if (!s.chatState || typeof s.chatState !== "object") s.chatState = { activeKey: "", states: {} };
            if (!s.chatState.states || typeof s.chatState.states !== "object") s.chatState.states = {};
            const active = String(s.chatState.activeKey || s.chatState.legacyKey || "").trim();
            if (active) s.chatState.states[active] = snapshotChatState(s);
        } catch (_) {}

        saveSettings();
        updateLayout();
        emitStateUpdated();
        try { window.toastr?.success?.(`Loaded state: ${name}`); } catch (_) {}
    });

$("body")
    .off("pointerup.uieStateDel click.uieStateDel", ".uie-state-del-btn")
    .on("pointerup.uieStateDel click.uieStateDel", ".uie-state-del-btn", function (e) {
        if (e?.type === "pointerup") {
            if (e.pointerType && e.pointerType !== "touch") return;
            uieLastStateBtnPointerTime = Date.now();
        } else if (e?.type === "click" && Date.now() - uieLastStateBtnPointerTime < 300) {
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        try { ensureChatStateLoaded(); } catch (_) {}
        const root = $(this).closest("#uie-settings-window, .uie-settings-block");
        const name = String(root.find(".uie-state-select").first().val() || "").trim();
        if (!name) return;
        const { bucket } = ensureManualSaveStore(s);
        if (bucket && bucket[name]) {
            try { delete bucket[name]; } catch (_) { bucket[name] = undefined; }
            saveSettings();
            refreshStateSaveSelects();
            root.find(".uie-state-select").val("");
            try { window.toastr?.success?.(`Deleted state: ${name}`); } catch (_) {}
        }
    });

const uieGetStConnectionProfiles = () => {
    const out = [];
    const pushOne = (name, data) => {
        const nm = String(name || "").trim();
        if (!nm) return;
        if (out.some(x => x.name === nm)) return;
        out.push({ name: nm, data });
    };
    try {
        const selects = Array.from(document.querySelectorAll("select"));
        const scoreSel = (el) => {
            const id = String(el?.id || "");
            const name = String(el?.getAttribute?.("name") || "");
            const cls = String(el?.className || "");
            const blob = `${id} ${name} ${cls}`;
            let score = 0;
            if (/connection/i.test(blob)) score += 4;
            if (/profile|preset/i.test(blob)) score += 4;
            if (/api|openrouter|openai|kobold|ooba|ollama|claude|gemini/i.test(blob)) score += 1;
            return score;
        };
        const ranked = selects
            .map(el => ({ el, score: scoreSel(el) }))
            .filter(x => x.score > 0)
            .sort((a, b) => b.score - a.score);

        for (const { el } of ranked) {
            const opts = Array.from(el.options || []);
            if (!opts.length) continue;
            for (const o of opts) {
                const text = String(o?.text || "").trim();
                const val = String(o?.value || "").trim();
                if (!text) continue;
                if (/^\(.*\)$/.test(text)) continue;
                if (/select/i.test(text) && !val) continue;
                pushOne(text, { value: val });
            }
            if (out.length) break;
        }
        if (out.length) return out.slice(0, 80);
    } catch (_) {}
    try {
        const es = window.extension_settings;
        if (es && typeof es === "object") {
            for (const k of Object.keys(es)) {
                if (!/connection/i.test(k) || !/profile|preset/i.test(k)) continue;
                const v = es[k];
                if (Array.isArray(v)) {
                    for (const it of v) pushOne(it?.name || it?.title || it?.id, it);
                } else if (v && typeof v === "object") {
                    const arr = Array.isArray(v.profiles) ? v.profiles : (Array.isArray(v.items) ? v.items : null);
                    if (arr) for (const it of arr) pushOne(it?.name || it?.title || it?.id, it);
                    else if (Object.keys(v).length && Object.values(v).every(x => x && typeof x === "object")) {
                        for (const it of Object.values(v)) pushOne(it?.name || it?.title || it?.id, it);
                    }
                }
            }
        }
    } catch (_) {}
    try {
        for (let i = 0; i < (window.localStorage?.length || 0); i++) {
            const key = window.localStorage.key(i);
            if (!key) continue;
            if (!/connection/i.test(key) || !/profile|preset/i.test(key)) continue;
            const raw = window.localStorage.getItem(key);
            if (!raw) continue;
            let data = null;
            try { data = JSON.parse(raw); } catch (_) { continue; }
            if (Array.isArray(data)) {
                for (const it of data) pushOne(it?.name || it?.title || it?.id, it);
            } else if (data && typeof data === "object") {
                const arr = Array.isArray(data.profiles) ? data.profiles : (Array.isArray(data.items) ? data.items : null);
                if (arr) for (const it of arr) pushOne(it?.name || it?.title || it?.id, it);
            }
        }
    } catch (_) {}
    return out.slice(0, 80);
};

const uiePopulateStPresets = () => {
    const sel = document.getElementById("uie-st-preset-select");
    if (!sel) return;
    const profiles = uieGetStConnectionProfiles();
    sel.innerHTML = "";
    if (!profiles.length) {
        sel.innerHTML = `<option value="">(No connection profiles found)</option>`;
        return;
    }
    sel.appendChild(new Option("(Select a profile...)", ""));
    for (const p of profiles) {
        sel.appendChild(new Option(p.name, p.name));
    }
};

const uieApplyStPresetByName = (name) => {
    const nm = String(name || "").trim();
    if (!nm) return false;
    const selects = Array.from(document.querySelectorAll("select"));
    const ranked = selects
        .map(el => {
            const id = String(el.id || "");
            const score = (/connection/i.test(id) ? 2 : 0) + (/profile|preset/i.test(id) ? 2 : 0);
            return { el, score };
        })
        .sort((a, b) => b.score - a.score);
    for (const { el } of ranked) {
        const opts = Array.from(el.options || []);
        const hit = opts.find(o => String(o.text || "").trim() === nm) || opts.find(o => String(o.value || "").trim() === nm);
        if (!hit) continue;
        el.value = hit.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
    }
    return false;
};

$("body").on("click", ".uie-settings-block #uie-st-preset-refresh", function(e) {
    e.preventDefault();
    e.stopPropagation();
    uiePopulateStPresets();
});

$("body").on("change", ".uie-settings-block #uie-st-preset-select", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const name = String($(this).val() || "");
    if (!name) return;
    const ok = uieApplyStPresetByName(name);
    try { window.toastr?.[ok ? "success" : "warning"]?.(ok ? `Applied ${name}` : `Could not apply ${name} automatically (no matching SillyTavern selector found).`); } catch (_) {}
});

setTimeout(() => { try { uiePopulateStPresets(); } catch (_) {} }, 1200);

// Close button if it exists (usually settings is in a drawer, but if standalone)
$("body").on("click", "#uie-settings-close", function(e) {
    e.preventDefault();
    $("#uie-settings-window").hide();
});

$("body").on("click", "#uie-open-settings", function(e) {
    e.preventDefault();
    $("#uie-settings-window").css("display", "flex");
});

// Settings: UI Scale + Kill Switch
$("body").on("input change", ".uie-settings-block #uie-scale-slider", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    const raw = Number($(this).val());
    const next = Number.isFinite(raw) ? Math.max(0.5, Math.min(2, raw)) : 1.0;
    s.uiScale = next;
    s.uiScaleUserSet = true;
    try { $("#uie-scale-display").text(next.toFixed(1)); } catch (_) {}
    saveSettings();
    try { updateLayout(); } catch (_) {}
});

$("body").off("change.uieLauncherIconSetting").on("change.uieLauncherIconSetting", ".uie-settings-block #uie-launcher-icon", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const val = String($(this).val() || "");
    if (val === "custom") {
        try { document.getElementById("uie-launcher-file")?.click(); } catch (_) {}
        return;
    }
    const s = getSettings();
    if (!s.launcher) s.launcher = {};
    s.launcher.src = val;
    try {
        const prev = document.getElementById("uie-launcher-preview");
        if (prev && val) {
            prev.style.backgroundImage = `url("${val}")`;
            prev.style.display = "block";
        } else if (prev) {
            prev.style.backgroundImage = "";
            prev.style.display = "none";
        }
    } catch (_) {}
    try { uieLauncherIconProbe = { src: "", ok: null, t: 0 }; } catch (_) {}
    saveSettings();
    try { updateLayout(); } catch (_) {}
});

$("body").off("change.uieLauncherFileSetting").on("change.uieLauncherFileSetting", ".uie-settings-block #uie-launcher-file", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const file = this.files && this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (evt) {
        const src = String(evt?.target?.result || "");
        if (!src) return;
        const s = getSettings();
        if (!s.launcher) s.launcher = {};
        s.launcher.src = src;
        s.launcher.lastUploadName = String(file.name || "");
        if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
        if (!s.launcher.savedIcons.includes(src)) s.launcher.savedIcons.unshift(src);
        try {
            const prev = document.getElementById("uie-launcher-preview");
            if (prev) {
                prev.style.backgroundImage = `url("${src}")`;
                prev.style.display = "block";
            }
        } catch (_) {}
        try { uieLauncherIconProbe = { src: "", ok: null, t: 0 }; } catch (_) {}
        saveSettings();
        try { updateLayout(); } catch (_) {}
    };
    try { reader.readAsDataURL(file); } catch (_) {}
    try { this.value = ""; } catch (_) {}
});

$("body").off("click.uieLauncherSaveSetting").on("click.uieLauncherSaveSetting", ".uie-settings-block #uie-launcher-save", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const sel = document.getElementById("uie-launcher-icon");
    const val = String(sel?.value || "");
    const s = getSettings();
    if (!s.launcher) s.launcher = {};
    if (val && val !== "custom") {
        s.launcher.src = val;
        if (!Array.isArray(s.launcher.savedIcons)) s.launcher.savedIcons = [];
        if (!s.launcher.savedIcons.includes(val)) s.launcher.savedIcons.unshift(val);
    }
    try { uieLauncherIconProbe = { src: "", ok: null, t: 0 }; } catch (_) {}
    saveSettings();
    try { updateLayout(); } catch (_) {}
});

$("body").off("click.uieLauncherDeleteSetting").on("click.uieLauncherDeleteSetting", ".uie-settings-block #uie-launcher-delete", function (e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.launcher) s.launcher = {};
    const cur = String(s.launcher.src || "");
    if (cur && Array.isArray(s.launcher.savedIcons)) {
        s.launcher.savedIcons = s.launcher.savedIcons.filter(x => String(x || "") !== cur);
    }
    s.launcher.src = "";
    try {
        const sel = document.getElementById("uie-launcher-icon");
        if (sel) sel.value = "custom";
        const prev = document.getElementById("uie-launcher-preview");
        if (prev) {
            prev.style.backgroundImage = "";
            prev.style.display = "none";
        }
    } catch (_) {}
    try { uieLauncherIconProbe = { src: "", ok: null, t: 0 }; } catch (_) {}
    saveSettings();
    try { updateLayout(); } catch (_) {}
});

$("body").on("change", ".uie-settings-block #uie-setting-enable", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    const killOn = $(this).prop("checked") === true;
    s.enabled = !killOn;
    saveSettings();
    try { updateLayout(); } catch (_) {}
});

// Settings: Scan All + System Checks
$("body").on("change", ".uie-settings-block #uie-scanall-enable, #uie-sw-scanall-enable", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    s.generation.scanAllEnabled = $(this).prop("checked") === true;
    saveSettings();
});
$("body").on("change", ".uie-settings-block #uie-systemchecks-enable, #uie-sw-systemchecks-enable", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    s.generation.allowSystemChecks = $(this).prop("checked") === true;
    saveSettings();
});

$("body").on("change", "#uie-sw-img-enable", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    s.image.enabled = $(this).prop("checked") === true;
    saveSettings();
});

$("body").on("input change", "#uie-sw-img-url", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    s.image.url = String($(this).val() || "");
    saveSettings();
});

$("body").on("input change", "#uie-sw-img-model", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    s.image.model = String($(this).val() || "");
    saveSettings();
});

$("body").on("input change", "#uie-sw-img-key", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    s.image.key = String($(this).val() || "");
    saveSettings();
});

$("body").on("change", "#uie-sw-img-map, #uie-sw-img-doll, #uie-sw-img-social, #uie-sw-img-phone-bg, #uie-sw-img-msg, #uie-sw-img-party, #uie-sw-img-items", function(e) {
    e.preventDefault();
    e.stopPropagation();
    const s = getSettings();
    if (!s.image) s.image = {};
    if (!s.image.features) s.image.features = {};
    const id = String(this.id || "");
    const on = $(this).prop("checked") === true;
    if (id === "uie-sw-img-map") s.image.features.map = on;
    if (id === "uie-sw-img-doll") s.image.features.doll = on;
    if (id === "uie-sw-img-social") s.image.features.social = on;
    if (id === "uie-sw-img-phone-bg") s.image.features.phoneBg = on;
    if (id === "uie-sw-img-msg") s.image.features.msg = on;
    if (id === "uie-sw-img-party") s.image.features.party = on;
    if (id === "uie-sw-img-items") s.image.features.items = on;
    saveSettings();
});
