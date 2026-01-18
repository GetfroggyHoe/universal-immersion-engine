import { getSettings, saveSettings } from "./core.js";

let bound = false;
let activeSet = "";
let category = "default";

const DEFAULT_KEYS = [
    "admiration","amusement","anger","annoyance","approval",
    "caring","confusion","curiosity","desire","disappointment",
    "disapproval","disgust","embarrassment","excitement","fear",
    "gratitude","grief","joy","love","nervousness","neutral",
    "optimism","pride","realization","relief","remorse","sadness","surprise"
];

const LIFE_SIM_KEYS = [
    "awake","sleepy","tired","hungry","eating","working","studying","walking","running","relaxing",
    "happy","bored","stressed","sick","injured","shy","flirty","blushing","laughing","crying",
    "phone","texting","shopping","cooking","cleaning","driving"
];

const FANTASY_RPG_KEYS = [
    "battle","victory","defeat","casting","healing","stealth","danger","hurt","critical","levelup",
    "loot","merchant","quest","boss","taunt","guard","attack","parry","dodge","magic"
];

const normalizeKey = (k) => String(k || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_-]+/g, "").slice(0, 64);

function ensureSpriteStore(s) {
    if (!s.realityEngine || typeof s.realityEngine !== "object") s.realityEngine = {};
    if (!s.realityEngine.sprites || typeof s.realityEngine.sprites !== "object") s.realityEngine.sprites = {};
    const sp = s.realityEngine.sprites;
    if (!sp.sets || typeof sp.sets !== "object") sp.sets = {};
    if (!sp.speakerMap || typeof sp.speakerMap !== "object") sp.speakerMap = {};
}

function getSets() {
    const s = getSettings();
    ensureSpriteStore(s);
    return s.realityEngine.sprites.sets;
}

function getSetNames() {
    const sets = getSets();
    return Object.keys(sets).sort((a, b) => String(a).localeCompare(String(b)));
}

function renderSetSelect() {
    const sel = document.getElementById("uie-sprites-set");
    if (!sel) return;
    const names = getSetNames();
    sel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "(None)";
    sel.appendChild(opt0);
    for (const n of names) {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
    }
    if (!activeSet && names.length) activeSet = names[0];
    sel.value = activeSet || "";
}

function getKeysForCategory(cat) {
    if (cat === "life_sim") return LIFE_SIM_KEYS.slice();
    if (cat === "fantasy_rpg") return FANTASY_RPG_KEYS.slice();
    if (cat === "custom") return [];
    return DEFAULT_KEYS.slice();
}

function getActiveSetObj() {
    const sets = getSets();
    if (!activeSet) return null;
    const obj = sets[activeSet];
    if (!obj || typeof obj !== "object") return null;
    if (!obj.expressions || typeof obj.expressions !== "object") obj.expressions = {};
    return obj;
}

function renderList() {
    const list = document.getElementById("uie-sprites-list");
    if (!list) return;
    const setObj = getActiveSetObj();
    if (!setObj) {
        list.innerHTML = `<div style="opacity:0.8; font-weight:900;">Create/select a sprite set first.</div>`;
        return;
    }
    const expr = setObj.expressions || {};
    const base = getKeysForCategory(category);
    const customKeys = Object.keys(expr || {}).sort((a, b) => String(a).localeCompare(String(b)));
    const keys = Array.from(new Set([...base, ...customKeys])).filter(Boolean);

    const row = (key) => {
        const k = String(key || "").trim();
        const nk = normalizeKey(k);
        const v = expr?.[nk] || null;
        const has = !!(v && typeof v === "object" && typeof v.dataUrl === "string" && v.dataUrl.startsWith("data:"));
        const thumb = has ? `<div style="width:44px;height:44px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background-image:url('${v.dataUrl}');background-size:cover;background-position:center;"></div>` : `<div style="width:44px;height:44px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);background:rgba(0,0,0,0.25);display:grid;place-items:center;opacity:0.8;">—</div>`;
        return `
          <div class="uie-spr-row" data-key="${nk}" style="display:flex; gap:10px; align-items:center; padding:10px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18);">
            ${thumb}
            <div style="flex:1; min-width:0;">
              <div style="font-weight:900; color:#fff;">${k}</div>
              <div style="opacity:0.7; font-size:12px;">${has ? "Image set" : "No image"}</div>
            </div>
            <input type="file" class="uie-spr-file" accept="image/*" style="display:none;">
            <button class="uie-spr-pick" style="height:40px; padding:0 12px; border-radius:12px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">Pick</button>
            <button class="uie-spr-clear" style="height:40px; width:44px; border-radius:12px; border:1px solid rgba(255,255,255,0.14); background:rgba(0,0,0,0.25); color:#fff; font-weight:900; cursor:pointer;">×</button>
          </div>
        `;
    };

    list.innerHTML = keys.map(row).join("");
}

function saveSetExpression(setName, key, dataUrl, fileName) {
    const s = getSettings();
    ensureSpriteStore(s);
    const sets = s.realityEngine.sprites.sets;
    if (!sets[setName] || typeof sets[setName] !== "object") sets[setName] = { expressions: {} };
    if (!sets[setName].expressions || typeof sets[setName].expressions !== "object") sets[setName].expressions = {};
    const nk = normalizeKey(key);
    if (!nk) return;
    if (!dataUrl) {
        delete sets[setName].expressions[nk];
    } else {
        sets[setName].expressions[nk] = { dataUrl: String(dataUrl), fileName: String(fileName || "").slice(0, 120) };
    }
    saveSettings();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
        if (!file) return resolve("");
        const r = new FileReader();
        r.onload = (e) => resolve(String(e?.target?.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(file);
    });
}

export function initSprites() {
    if (bound) return;
    bound = true;

    $(document).off(".uieSprites");

    $(document).on("pointerup.uieSprites", "#uie-sprites-close", (e) => {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-sprites-window").hide();
    });

    $(document).on("change.uieSprites", "#uie-sprites-set", function () {
        activeSet = String($(this).val() || "");
        renderList();
    });

    $(document).on("change.uieSprites", "#uie-sprites-cat", function () {
        category = String($(this).val() || "default");
        renderList();
    });

    $(document).on("pointerup.uieSprites", "#uie-sprites-create", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const name = String($("#uie-sprites-new").val() || "").trim().slice(0, 80);
        if (!name) return;
        const s = getSettings();
        ensureSpriteStore(s);
        if (!s.realityEngine.sprites.sets[name]) s.realityEngine.sprites.sets[name] = { expressions: {} };
        saveSettings();
        activeSet = name;
        $("#uie-sprites-new").val("");
        renderSetSelect();
        renderList();
    });

    $(document).on("pointerup.uieSprites", "#uie-sprites-add", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const key = String($("#uie-sprites-add-key").val() || "").trim();
        const nk = normalizeKey(key);
        if (!nk || !activeSet) return;
        const s = getSettings();
        ensureSpriteStore(s);
        const sets = s.realityEngine.sprites.sets;
        if (!sets[activeSet] || typeof sets[activeSet] !== "object") sets[activeSet] = { expressions: {} };
        if (!sets[activeSet].expressions || typeof sets[activeSet].expressions !== "object") sets[activeSet].expressions = {};
        if (!sets[activeSet].expressions[nk]) sets[activeSet].expressions[nk] = { dataUrl: "", fileName: "" };
        saveSettings();
        $("#uie-sprites-add-key").val("");
        renderList();
    });

    $(document).on("pointerup.uieSprites", ".uie-spr-pick", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const inp = row.find(".uie-spr-file").get(0);
        if (inp) inp.click();
    });

    $(document).on("change.uieSprites", ".uie-spr-file", async function (e) {
        const row = $(this).closest(".uie-spr-row");
        const key = String(row.attr("data-key") || "");
        const f = e.target && e.target.files ? e.target.files[0] : null;
        const dataUrl = await readFileAsDataUrl(f);
        if (!activeSet || !key) return;
        if (!dataUrl) return;
        saveSetExpression(activeSet, key, dataUrl, String(f?.name || ""));
        renderList();
    });

    $(document).on("pointerup.uieSprites", ".uie-spr-clear", function (e) {
        e.preventDefault();
        e.stopPropagation();
        const row = $(this).closest(".uie-spr-row");
        const key = String(row.attr("data-key") || "");
        if (!activeSet || !key) return;
        saveSetExpression(activeSet, key, "", "");
        renderList();
    });
}

export function openSprites() {
    renderSetSelect();
    try { $("#uie-sprites-cat").val(category || "default"); } catch (_) {}
    renderList();
}

