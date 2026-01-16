import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";
import { getContext } from "../../../../../extensions.js";
import { injectRpEvent } from "./features/rp_log.js";

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

function chatSnippet() {
    let raw = "";
    $(".chat-msg-txt").slice(-18).each(function () { raw += $(this).text() + "\n"; });
    return raw.trim().slice(0, 2000);
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
        $list.html(`<div style="opacity:0.75; padding:14px; border:1px dashed rgba(255,255,255,0.18); border-radius:14px; text-align:center; color:#888;">Generate a catalog to begin.</div>`);
        return;
    }

    s.shop.catalog.forEach((it, idx) => {
        const price = Number(it.price || 0);
        const canBuy = Number(s.currency || 0) >= price;
        $list.append(`
            <div style="display:flex; gap:10px; align-items:center; padding:12px; border-radius:14px; border:1px solid rgba(255,255,255,0.12); background:rgba(0,0,0,0.25);">
                <div style="width:42px; height:42px; border-radius:14px; border:1px solid rgba(225,193,122,0.25); background:rgba(0,0,0,0.35); display:flex; align-items:center; justify-content:center; color:#cba35c; font-size:18px;">${esc(it.icon || "🛒")}</div>
                <div style="flex:1; min-width:0;">
                    <div style="font-weight:900; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(it.name || "Item")}</div>
                    <div style="opacity:0.75; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(it.desc || "")}</div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:900; color:#f1c40f;">${price} ${sym}</div>
                    <button class="uie-shop-buy" data-idx="${idx}" ${canBuy ? "" : "disabled"} style="margin-top:6px; height:34px; padding:0 12px; border-radius:12px; border:none; background:${canBuy ? "#2ecc71" : "#333"}; color:${canBuy ? "#000" : "#777"}; font-weight:900; cursor:pointer;">BUY</button>
                </div>
            </div>
        `);
    });
}

async function generateCatalog() {
    const s = getSettings();
    ensureShop(s);
    if (s.ai && s.ai.shop === false) return;
    const sym = String(s.currencySymbol || "G");
    const keys = String($("#uie-shop-keywords").val() || "").trim();
    s.shop.keywords = keys;
    saveSettings();

    const chat = chatSnippet();
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
    let arr = [];
    try { arr = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { arr = []; }
    if (!Array.isArray(arr)) return;
    s.shop.catalog = arr.slice(0, 6).map(o => ({
        name: String(o.name || "Item").slice(0, 60),
        desc: String(o.desc || o.description || "").slice(0, 160),
        type: String(o.type || "misc").slice(0, 40),
        price: Math.max(0, Number(o.price || 0)),
        icon: String(o.icon || "🛒").slice(0, 4)
    }));
    saveSettings();
    renderShop();
}

export function initShop() {
    const s = getSettings();
    ensureShop(s);

    $(document).off("click.uieShop pointerup.uieShop");
    $(document).on("click.uieShop pointerup.uieShop", "#uie-shop-generate", async (e) => {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault(); e.stopPropagation();
        const btn = $("#uie-shop-generate");
        btn.prop("disabled", true);
        try { await generateCatalog(); } finally { btn.prop("disabled", false); }
    });
    $(document).on("click.uieShop pointerup.uieShop", "#uie-shop-refresh", async (e) => {
        if (e.type === "pointerup" && e.pointerType !== "touch") return;
        e.preventDefault(); e.stopPropagation();
        const btn = $("#uie-shop-refresh");
        btn.prop("disabled", true);
        try { await generateCatalog(); } finally { btn.prop("disabled", false); }
    });
    $(document).on("click.uieShop pointerup.uieShop", ".uie-shop-buy", function(e) {
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
        saveSettings();
        try { injectRpEvent(`[System: User purchased ${String(it.name || "Item")} for ${price} ${sym}.]`); } catch (_) {}
        try { if (window.toastr) toastr.success(`Purchased: ${it.name}`); } catch (_) {}
        import("./inventory.js").then(mod => { if (mod?.updateVitals) mod.updateVitals(); });
        renderShop();
    });

    renderShop();
}
