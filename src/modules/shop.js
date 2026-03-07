import { getSettings, commitStateUpdate } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "/scripts/extensions.js";
import { injectRpEvent } from "./features/rp_log.js";
import { getChatTranscriptText } from "./chatLog.js";
import { safeJsonParseArray } from "./jsonUtil.js";

function ensureShop(s) {
    if (!s.shop) s.shop = {};
    if (!Array.isArray(s.shop.catalog)) s.shop.catalog = [];
    if (typeof s.shop.keywords !== "string") s.shop.keywords = "";
}

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

async function chatSnippet() {
    try {
        const t = await getChatTranscriptText({ maxMessages: 30, maxChars: 2400 });
        if (t) return t;
    } catch (_) {}
    let raw = "";
    $(".chat-msg-txt").slice(-24).each(function () { raw += $(this).text() + "\n"; });
    return raw.trim().slice(0, 2400);
}

function loreKeys() {
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
        return Array.from(new Set(keys)).slice(0, 60);
    } catch (_) {
        return [];
    }
}

function renderShop() {
    const s = getSettings();
    ensureShop(s);
    const sym = String(s.currencySymbol || "G");
    $("#uie-shop-balance").text(`${Number(s.currency || 0)} ${sym}`);
    $("#uie-shop-keywords").val(String(s.shop.keywords || ""));

    const $list = $("#uie-shop-items");
    if (!$list.length) return;
    $list.empty();
    
    if (!s.shop.catalog.length) {
        const emptyTmpl = document.getElementById("uie-shop-empty-template");
        if (emptyTmpl) {
            $list.append(emptyTmpl.content.cloneNode(true));
        } else {
            $list.html(`<div style="opacity:0.75; padding:14px; border:1px dashed rgba(255,255,255,0.18); border-radius:14px; text-align:center; color:#888;">Generate a catalog to begin.</div>`);
        }
        return;
    }

    const itemTmpl = document.getElementById("uie-shop-item-template");
    if (!itemTmpl) return;

    s.shop.catalog.forEach((it, idx) => {
        const price = Number(it.price || 0);
        const canBuy = Number(s.currency || 0) >= price;
        const sym = String(s.currencySymbol || "G");
        
        const clone = itemTmpl.content.cloneNode(true);
        const itemEl = clone.querySelector(".uie-shop-item"); // although not strictly needed if we query sub-elements directly from clone
        
        clone.querySelector(".uie-shop-icon").textContent = esc(it.icon || "🛒");
        clone.querySelector(".uie-shop-name").textContent = esc(it.name || "Item");
        clone.querySelector(".uie-shop-desc").textContent = esc(it.desc || "");
        clone.querySelector(".uie-shop-price").textContent = `${price} ${sym}`;
        
        const btn = clone.querySelector(".uie-shop-buy");
        btn.setAttribute("data-idx", idx);
        if (!canBuy) {
            btn.setAttribute("disabled", "disabled");
            btn.style.background = "#333";
            btn.style.color = "#777";
        } else {
            btn.style.background = "#2ecc71";
            btn.style.color = "#000";
        }
        
        $list.append(clone);
    });
}

export function renderShopView() {
    renderShop();
}

async function generateCatalog() {
    const s = getSettings();
    ensureShop(s);
    if (s.ai && s.ai.shop === false) return;
    const sym = String(s.currencySymbol || "G");
    const keys = String($("#uie-shop-keywords").val() || "").trim();
    s.shop.keywords = keys;
    commitStateUpdate({ save: true, layout: false, emit: true });

    const chat = await chatSnippet();
    const lore = loreKeys().join(", ");
    const prompt = `
You are generating a shop catalog for a roleplay UI.
Return JSON only (no markdown): [{"name":"","desc":"","type":"","price":0,"icon":"🧪"}]
Rules:
- 6 items max
- Prices must be integers in ${sym}
- Items should match keywords and the current scene
Keywords: ${keys}
Lore keys: ${lore}
Recent chat: ${chat}
`;
    const res = await generateContent(prompt.slice(0, 6000), "System Check");
    if (!res) return;
    const arr = safeJsonParseArray(res);
    if (!arr) return;
    s.shop.catalog = arr.slice(0, 6).map(o => ({
        name: String(o.name || "Item").slice(0, 60),
        desc: String(o.desc || o.description || "").slice(0, 160),
        type: String(o.type || "misc").slice(0, 40),
        price: Math.max(0, Number(o.price || 0)),
        icon: String(o.icon || "🛒").slice(0, 4)
    }));
    commitStateUpdate({ save: true, layout: false, emit: true });
    renderShop();
}

export function initShop() {
    const s = getSettings();
    ensureShop(s);

    const $win = $("#uie-shop-window");
    $win.off("click.uieShop pointerup.uieShop");
    $(document).off("click.uieShop pointerup.uieShop");

    $win.on("click.uieShop pointerup.uieShop", "#uie-shop-generate", async (e) => {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault(); e.stopPropagation();
        const btn = $("#uie-shop-generate");
        btn.prop("disabled", true);
        try { await generateCatalog(); } finally { btn.prop("disabled", false); }
    });
    $win.on("click.uieShop pointerup.uieShop", "#uie-shop-refresh", async (e) => {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault(); e.stopPropagation();
        const btn = $("#uie-shop-refresh");
        btn.prop("disabled", true);
        try { await generateCatalog(); } finally { btn.prop("disabled", false); }
    });
    $win.on("click.uieShop pointerup.uieShop", ".uie-shop-buy", function(e) {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault(); e.stopPropagation();
        const idx = Number($(this).data("idx"));
        const s2 = getSettings();
        ensureShop(s2);
        const it = s2.shop.catalog[idx];
        if (!it) return;
        const price = Number(it.price || 0);
        if (Number(s2.currency || 0) < price) return;
        s2.currency = Number(s2.currency || 0) - price;
        const sym = String(s2.currencySymbol || "G");
        const curItem = Array.isArray(s2.inventory?.items) ? s2.inventory.items.find(x => String(x?.type || "").toLowerCase() === "currency" && String(x?.symbol || "") === sym) : null;
        if (curItem) curItem.qty = Math.max(0, Number(s2.currency || 0));
        if (!s2.inventory) s2.inventory = {};
        if (!Array.isArray(s2.inventory.items)) s2.inventory.items = [];
        s2.inventory.items.push({ kind: "item", name: it.name, type: it.type || "misc", description: it.desc || "", rarity: "common", qty: 1, mods: {}, statusEffects: [] });
        commitStateUpdate({ save: true, layout: false, emit: true });
        try { injectRpEvent(`[System: User purchased ${String(it.name || "Item")} for ${price} ${sym}.]`); } catch (_) {}
        try { if (window.toastr) toastr.success(`Purchased: ${it.name}`); } catch (_) {}
        import("./inventory.js").then(mod => { if (mod?.updateVitals) mod.updateVitals(); });
        renderShop();
    });

    renderShop();
}
