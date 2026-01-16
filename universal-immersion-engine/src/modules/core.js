import { extension_settings } from "../../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../../script.js";

export const EXT_ID = "universal-immersion-engine";

export const SETTINGS_DEFAULT = { 
    enabled: true, 
    permadeath: false,
    rpg: { mode: "adventurer" },
    launcherX: 100, launcherY: 100,
    launcherIcon: "",
    menuX: null,
    menuY: null,
    posX: 100, posY: 100, 
    inventoryDesktopFullscreen: false,
    hearts: 5,
    maxHearts: 5,
    map: { mode: "procedural", html: "", data: null, seed: "", scope: "local", prompt: "", location: "Unknown", marker: { x: 0.5, y: 0.5 } },
    menuHidden: { inventory:false, shop:false, journal:false, diary:false, social:false, party:false, battle:false, phone:false, map:false, calendar:false, databank:false, settings:false, debug:false, world:false, help:false },
    features: { codexEnabled: false, phoneEnabled: true },
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
    generation: { requireConfirm: false, promptUI: true, aiConfirm: false, customSystemPrompt: "", promptPrefixes: { global: "", byType: {} } },
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
    inventory: { items: [], skills: [], assets: [], statuses: [] },
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
    character: { name: "", className: "Sanguine Shinobi", level: 1, avatar: "", portrait: "", syncPersona: true, classLibrary: ["Sanguine Shinobi"], stats: { str:10,dex:10,con:10,int:10,wis:10,cha:10,per:10,luk:10,agi:10,vit:10,end:10,spi:10 }, statusEffects: [] },
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
        backgrounds: { menu: "", inventory: "", shop: "", journal: "", social: "https://files.catbox.moe/072b9m.png", party: "", phone: "", map: "" },
        css: { global: "" }
    },
    uiScale: 1.0,
    characterClass: "Sanguine Shinobi",
    turbo: { enabled: false, url: "https://openrouter.ai/api/v1/chat/completions", key: "", model: "google/gemini-2.0-flash-exp" },
    image: { enabled: false, url: "https://api.openai.com/v1/images/generations", key: "", model: "dall-e-3", features: { map: true, doll: true, social: true, phoneBg: true, msg: true, party: true, items: true }, comfy: { workflow: "", positiveNodeId: "", negativeNodeId: "", outputNodeId: "" } },
    connections: { activeProfileId: "", profiles: [] }
};

export function getSettings() { return extension_settings[EXT_ID]; }
export function saveSettings() { saveSettingsDebounced(); }

export function isMobileUI() {
    try {
        const byMedia = window.matchMedia("(max-width: 700px), (pointer: coarse), (hover: none)").matches;
        const byTouch = (typeof navigator !== "undefined" && Number(navigator.maxTouchPoints || 0) > 0);
        return byMedia || byTouch;
    } catch (_) {
        return window.innerWidth <= 700;
    }
}

export function sanitizeSettings() {
    if (!extension_settings[EXT_ID]) extension_settings[EXT_ID] = SETTINGS_DEFAULT;
    const s = extension_settings[EXT_ID];
    for(const k in SETTINGS_DEFAULT) if(s[k] === undefined) s[k] = SETTINGS_DEFAULT[k];
    
    if (isNaN(parseFloat(s.uiScale))) s.uiScale = 1.0;
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
    if (!s.battle) s.battle = SETTINGS_DEFAULT.battle;
    if (typeof s.battle.auto !== "boolean") s.battle.auto = false;
    if (!s.battle.state) s.battle.state = SETTINGS_DEFAULT.battle.state;
    if (!Array.isArray(s.battle.state.enemies)) s.battle.state.enemies = [];
    if (!Array.isArray(s.battle.state.turnOrder)) s.battle.state.turnOrder = [];
    if (!Array.isArray(s.battle.state.log)) s.battle.state.log = [];
    if (!s.character) s.character = SETTINGS_DEFAULT.character;
    if (s.character.syncPersona === undefined) s.character.syncPersona = true;
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
    if (!s.ui.backgrounds) s.ui.backgrounds = SETTINGS_DEFAULT.ui.backgrounds;
    if (!s.ui.css) s.ui.css = SETTINGS_DEFAULT.ui.css;
    if (!s.ai) s.ai = SETTINGS_DEFAULT.ai;
    for (const k of Object.keys(SETTINGS_DEFAULT.ai || {})) {
        if (typeof s.ai[k] !== "boolean") s.ai[k] = SETTINGS_DEFAULT.ai[k];
    }
    if (!s.turbo || typeof s.turbo !== "object") s.turbo = { ...SETTINGS_DEFAULT.turbo };
    if (typeof s.turbo.enabled !== "boolean") s.turbo.enabled = SETTINGS_DEFAULT.turbo.enabled;
    if (typeof s.turbo.url !== "string") s.turbo.url = String(s.turbo.url || SETTINGS_DEFAULT.turbo.url || "");
    if (typeof s.turbo.key !== "string") s.turbo.key = String(s.turbo.key || "");
    if (typeof s.turbo.model !== "string") s.turbo.model = String(s.turbo.model || SETTINGS_DEFAULT.turbo.model || "");

    if (!s.image || typeof s.image !== "object") s.image = { ...SETTINGS_DEFAULT.image };
    if (typeof s.image.enabled !== "boolean") s.image.enabled = SETTINGS_DEFAULT.image.enabled;
    if (typeof s.image.url !== "string") s.image.url = String(s.image.url || SETTINGS_DEFAULT.image.url || "");
    if (typeof s.image.key !== "string") s.image.key = String(s.image.key || "");
    if (typeof s.image.model !== "string") s.image.model = String(s.image.model || SETTINGS_DEFAULT.image.model || "");
    if (!s.image.features || typeof s.image.features !== "object") s.image.features = { ...SETTINGS_DEFAULT.image.features };
    for (const k of Object.keys(SETTINGS_DEFAULT.image.features || {})) {
        if (typeof s.image.features[k] !== "boolean") s.image.features[k] = SETTINGS_DEFAULT.image.features[k];
    }
    if (!s.image.comfy || typeof s.image.comfy !== "object") s.image.comfy = { ...SETTINGS_DEFAULT.image.comfy };
    if (typeof s.image.comfy.workflow !== "string") s.image.comfy.workflow = String(s.image.comfy.workflow || "");
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
            } : null,
        }))
        .filter(p => p.id && p.name);
    if (s.connections.activeProfileId && !s.connections.profiles.find(p => p.id === s.connections.activeProfileId)) s.connections.activeProfileId = "";
    if (!s.features) s.features = SETTINGS_DEFAULT.features;
    if (!s.menuHidden) s.menuHidden = SETTINGS_DEFAULT.menuHidden;
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

    saveSettings();
    return s;
}

export function updateLayout() {
    const s = getSettings();
    const inv = $("#uie-inventory-window");
    const isFs = String(inv.attr("data-fullscreen") || "").toLowerCase() === "true" || inv.data("fullscreen") === true;
    const isMobile = isMobileUI();
    const scale = Number(s.uiScale) || 1;

    // INVENTORY: Mobile layout without forcing fullscreen
    if (isMobile) {
        if (isFs) {
            inv.css({ top: 0, left: 0, width: "100vw", height: "100vh", transform: "none", maxWidth: "none", maxHeight: "none" });
        } else {
            inv.css({ position: "fixed", inset: "auto", top: "12vh", left: "3vw", width: "94vw", height: "80vh", transform: "none", maxWidth: "94vw", maxHeight: "80vh" });
        }
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
        x = Math.max(0, Math.min(x, vw - 40));
        y = Math.max(0, Math.min(y, vh - 40));
        
        // CORNER FIX: If stuck near 0,0 (legacy fullscreen artifact), Force Center
        if (x < 50 && y < 50) {
             const w = inv.outerWidth() || Math.min(1150, vw * 0.92);
             const h = inv.outerHeight() || Math.min(950, vh * 0.92);
             x = (vw - w) / 2;
             y = (vh - h) / 2;
             x = Math.max(0, Math.min(x, vw - 40));
             y = Math.max(0, Math.min(y, vh - 40));
        }

        inv.css({ top: y, left: x, transform: "none" });
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
        $("#uie-launcher").css({ top: ly, left: lx });
    } catch (_) {
        $("#uie-launcher").css({ top: s.launcherY, left: s.launcherX });
    }
    // Restore default if empty
    const icon = s.launcher?.src || s.launcherIcon || "https://user.uploads.dev/file/b3fc92e1b70f0c8f0c200b544f7a4cce.png";
    const launcherEl = document.getElementById("uie-launcher");
    if (launcherEl && !launcherEl.querySelector(".uie-launcher-fallback")) {
        launcherEl.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none;stroke:#cba35c;stroke-width:2;display:block;opacity:0.92;" class="uie-launcher-fallback"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`);
    }
    try {
        const fb = launcherEl ? launcherEl.querySelector(".uie-launcher-fallback") : null;
        if (fb) fb.style.display = icon ? "none" : "block";
    } catch (_) {}
    $("#uie-launcher").css({
        backgroundImage: icon ? `url("${icon}")` : "",
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

    // MAIN MENU: Mobile clamp (do not wipe position)
    if (isMobile) {
        const menuEl = document.getElementById("uie-main-menu");
        const launcherEl = document.getElementById("uie-launcher");
        if (menuEl && getComputedStyle(menuEl).display !== "none") {
            const vw = window.innerWidth || document.documentElement.clientWidth || 0;
            const vh = window.innerHeight || document.documentElement.clientHeight || 0;
            const pad = 8;

            const mrect = menuEl.getBoundingClientRect();
            let left = Number.parseFloat(menuEl.style.left || "");
            let top = Number.parseFloat(menuEl.style.top || "");

            if (!Number.isFinite(left) || !Number.isFinite(top)) {
                if (launcherEl) {
                    const l = launcherEl.getBoundingClientRect();
                    left = l.left;
                    top = l.bottom + 10;
                } else {
                    left = pad;
                    top = pad;
                }
            }

            const w = mrect.width || 320;
            const h = mrect.height || 420;
            left = Math.max(pad, Math.min(left, vw - w - pad));
            top = Math.max(pad, Math.min(top, vh - h - pad));

            $("#uie-main-menu").css({ left, top, transform: "none" });
        }
    } else if (s.menuX !== null && s.menuY !== null) {
        const menu = document.getElementById("uie-main-menu");
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const topPad = 60;
        const pad = 8;
        const w = menu?.getBoundingClientRect?.().width || 320;
        const h = menu?.getBoundingClientRect?.().height || 420;
        const maxLeft = Math.max(pad, vw - w - pad);
        const maxTop = Math.max(topPad, vh - h - pad);
        const clampedLeft = Math.min(maxLeft, Math.max(pad, Number(s.menuX) || pad));
        const clampedTop = Math.min(maxTop, Math.max(topPad, Number(s.menuY) || topPad));
        $("#uie-main-menu").css({ left: clampedLeft, top: clampedTop, transform: "none" });
    }
    {
        const needsTranslate = (v) => typeof v === "string" && v.includes("%");
        $(".uie-window, #uie-main-menu, #uie-launcher").each(function () {
            const $el = $(this);
            const id = String($el.attr("id") || "");
            if (id === "uie-inventory-window") {
                const $panel = $el.find(".uie-inv-panel");
                $panel.css("transform", scale === 1 ? "" : `scale(${scale})`);
                $panel.css("transform-origin", "top left");
                $el.css("transform", "none");
                return;
            }
            if (isMobile && $el.hasClass("uie-window")) {
                $el.css("transform", "none");
                $el.css("transform-origin", "");
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
    $("#uie-launcher").show();
    if (s.enabled === false) $("#uie-launcher").css({ opacity: 0.6, filter: "grayscale(1)" });
    else $("#uie-launcher").css({ opacity: "", filter: "" });

    $("#uie-gen-prompt-wrap").toggle(s.generation?.promptUI !== false);

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
        map: "#uie-map-window"
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
