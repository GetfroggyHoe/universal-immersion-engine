
import { getSettings, saveSettings, updateLayout } from "./core.js";
import { loadFeatureTemplate } from "./featureLoader.js";
import { getContext } from "../../../../../extensions.js";
import { generateContent, cleanOutput } from "./apiClient.js";
import { notify, notifyLowHpIfNeeded } from "./notifications.js";
import { normalizeStatusList, statusName, statusKey, formatRemaining, summarizeMods, computeStatusTotals, applyStatusTickToVitals, parseDurationToMs } from "./statusFx.js";
import { generateImageAPI } from "./imageGen.js";
import { SCAN_TEMPLATES } from "./scanTemplates.js";
import { scanEverything } from "./stateTracker.js";
import { getChatTranscriptText } from "./chatLog.js";

export const MEDALLIONS = {
    "medallion_water": {
        id: "medallion_water",
        name: "Medallion of the Coiled Tide",
        type: "medallion",
        desc: "Best for: Speed, Evasion, Mana/Stamina regen.\n[Rank: Rebirth Artifact]\n[Status Effect: Flow State]\n- Infinite Stamina: Never tire.\n- Fluid Motion: Move like liquid, evasion up.\n- Environmental Buff: Speed doubles near water.",
        img: "https://user.uploads.dev/file/644e59a3cff1ce40adec12bf35844d0e.png",
        statusEffects: ["Flow State"]
    },
    "medallion_earth": {
        id: "medallion_earth",
        name: "Sigil of the Bedrock",
        type: "medallion",
        desc: "Best for: Tanking, Invulnerability, Brute Force.\n[Rank: Rebirth Artifact]\n[Status Effect: Mountain's Heart]\n- Natural Armor: Diamond density skin.\n- Immovable: Cannot be knocked back.\n- Threat Aura: Crushing weight presence.",
        img: "https://user.uploads.dev/file/f2fb37a01abb09790e7936951d2acdbf.png",
        statusEffects: ["Mountain's Heart"]
    },
    "medallion_air": {
        id: "medallion_air",
        name: "Crest of the Gale",
        type: "medallion",
        desc: "Best for: Critical Hits, Speed, Vertical Movement.\n[Rank: Rebirth Artifact]\n[Status Effect: Sky Walker]\n- Weightless: No fall damage, run up walls.\n- Precision Strikes: Auto-crit weak points.\n- Acceleration: Speed increases over time.",
        img: "https://user.uploads.dev/file/2fbfff08474c64ae7fd2c83b44be381c.png",
        statusEffects: ["Sky Walker"]
    },
    "medallion_fire": {
        id: "medallion_fire",
        name: "The Warlord’s Brand",
        type: "medallion",
        desc: "Best for: High Damage, Intimidation, High Risk.\n[Rank: Rebirth Artifact]\n[Status Effect: Burning Soul]\n- Cauterize: Wounds burn, no bleed.\n- Glass Cannon: Massive damage, reckless defense.\n- Heat Haze: Passive ignition aura.",
        img: "https://user.uploads.dev/file/87ab6c663ec4bd5bffed62d8790bd6f0.png",
        statusEffects: ["Burning Soul"]
    },
    "medallion_rebel": {
        id: "medallion_rebel",
        name: "Mark of the Usurper",
        type: "medallion",
        desc: "Best for: Chaos, Minions, Unrestricted Gear.\n[Rank: Rebirth Artifact]\n[Status Effect: Rule Breaker]\n- Master of All: Wield any weapon/magic.\n- Charismatic Chaos: Minions defect to you.\n- Boss Slayer: Bonus dmg vs Authority.",
        img: "https://user.uploads.dev/file/77fa500b1551e8d07a2b1f3bc8cb4471.png",
        statusEffects: ["Rule Breaker"]
    }
};

let editorItemIndex = null;
let pendingImageTarget = null;
let lastLootMesId = null;

function ensureModel(s) {
  if (!s) return;
  if (!s.character) s.character = {};
  if (!s.inventory) s.inventory = {};
  if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
}

let fxManagerHandlersBound = false;

function ensureStatusManager() {
  if (document.getElementById("uie-fx-modal")) return;
  const el = document.createElement("div");
  el.id = "uie-fx-modal";
  el.style.cssText = "display:none;position:fixed;inset:0;z-index:2147483656;background:rgba(0,0,0,0.65);align-items:center;justify-content:center;padding:12px;box-sizing:border-box;";
  el.innerHTML = `
    <div style="width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;padding:12px;box-sizing:border-box;">
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
        <div style="font-weight:900;color:#f1c40f;">Status Effects</div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
          <button id="uie-fx-new" style="height:34px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-weight:900;cursor:pointer;">New</button>
          <button id="uie-fx-close" style="height:34px;padding:0 12px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-weight:900;cursor:pointer;">Close</button>
        </div>
      </div>
      <div id="uie-fx-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;"></div>
      <div style="border-top:1px solid rgba(255,255,255,0.10);padding-top:12px;">
        <div style="font-weight:900;margin-bottom:8px;">Edit / Add</div>
        <input id="uie-fx-id" type="hidden" value="">
        <div style="display:grid;grid-template-columns:1fr 160px;gap:10px;">
          <input id="uie-fx-name" type="text" placeholder="Name (e.g., Poisoned)" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
          <input id="uie-fx-duration" type="text" placeholder="Duration (e.g., 30m, 2h)" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
        </div>
        <textarea id="uie-fx-desc" placeholder="Description / rules (optional)" style="margin-top:10px;width:100%;min-height:84px;border-radius:16px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:10px 12px;outline:none;resize:vertical;"></textarea>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;">
          <input id="uie-fx-maxhp" type="number" placeholder="Max HP Δ" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
          <input id="uie-fx-maxmp" type="number" placeholder="Max MP Δ" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
          <input id="uie-fx-maxap" type="number" placeholder="Max AP Δ" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
          <input id="uie-fx-hpmin" type="number" placeholder="HP/min" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
          <input id="uie-fx-mpmin" type="number" placeholder="MP/min" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
          <input id="uie-fx-apmin" type="number" placeholder="AP/min" style="height:38px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
        </div>
        <input id="uie-fx-stats" type="text" placeholder="Stat mods (e.g., str:+2,dex:-1,end:-1)" style="margin-top:10px;height:38px;width:100%;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.28);color:#fff;padding:0 12px;outline:none;">
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button id="uie-fx-save" style="flex:1;height:38px;border-radius:14px;border:1px solid rgba(241,196,15,0.55);background:rgba(241,196,15,0.18);color:#f1c40f;font-weight:900;cursor:pointer;">Save</button>
          <button id="uie-fx-delete" style="flex:0 0 auto;width:120px;height:38px;border-radius:14px;border:1px solid rgba(243,139,168,0.35);background:rgba(0,0,0,0.25);color:#f38ba8;font-weight:900;cursor:pointer;">Delete</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    if (!e || e.target !== el) return;
    try { closeStatusManager(); } catch (_) {}
  });
}

function readFxForm() {
  const name = String($("#uie-fx-name").val() || "").trim();
  const durationRaw = String($("#uie-fx-duration").val() || "").trim();
  const desc = String($("#uie-fx-desc").val() || "").trim();
  const num = (sel) => {
    const v = Number($(sel).val());
    return Number.isFinite(v) ? v : 0;
  };
  const mods = {
    maxHp: num("#uie-fx-maxhp"),
    maxMp: num("#uie-fx-maxmp"),
    maxAp: num("#uie-fx-maxap"),
    maxXp: 0,
    hpPerMin: num("#uie-fx-hpmin"),
    mpPerMin: num("#uie-fx-mpmin"),
    apPerMin: num("#uie-fx-apmin"),
    stats: {},
  };
  const statsRaw = String($("#uie-fx-stats").val() || "").trim();
  if (statsRaw) {
    const parts = statsRaw.split(/[,;]+/g).map(x => x.trim()).filter(Boolean);
    for (const p of parts) {
      const m = p.match(/^([a-z]{2,4})\s*[:=]?\s*([+-]?\d+(?:\.\d+)?)$/i) || p.match(/^([a-z]{2,4})\s*([+-]\d+(?:\.\d+)?)$/i);
      if (!m) continue;
      const k = String(m[1] || "").trim().toLowerCase();
      const v = Number(m[2]);
      if (!k || !Number.isFinite(v)) continue;
      mods.stats[k] = v;
    }
  }
  const durationMs = parseDurationToMs(durationRaw);
  return { name, desc, durationMs, mods };
}

function setFxForm(fx) {
  const obj = fx && typeof fx === "object" ? fx : null;
  $("#uie-fx-id").val(obj ? String(obj.id || "") : "");
  $("#uie-fx-name").val(obj ? String(obj.name || "") : "");
  $("#uie-fx-desc").val(obj ? String(obj.desc || "") : "");
  $("#uie-fx-duration").val(obj && obj.expiresAt ? formatRemaining(obj.expiresAt) : "");
  $("#uie-fx-maxhp").val(obj ? Number(obj?.mods?.maxHp || 0) : 0);
  $("#uie-fx-maxmp").val(obj ? Number(obj?.mods?.maxMp || 0) : 0);
  $("#uie-fx-maxap").val(obj ? Number(obj?.mods?.maxAp || 0) : 0);
  $("#uie-fx-hpmin").val(obj ? Number(obj?.mods?.hpPerMin || 0) : 0);
  $("#uie-fx-mpmin").val(obj ? Number(obj?.mods?.mpPerMin || 0) : 0);
  $("#uie-fx-apmin").val(obj ? Number(obj?.mods?.apPerMin || 0) : 0);
  const stats = obj?.mods?.stats && typeof obj.mods.stats === "object" ? obj.mods.stats : {};
  const statsTxt = Object.entries(stats).filter(([_, v]) => Number(v) !== 0).map(([k, v]) => `${String(k).toLowerCase()}:${Number(v) > 0 ? `+${Number(v)}` : `${Number(v)}`}`).join(", ");
  $("#uie-fx-stats").val(statsTxt);
}

function renderStatusList() {
  const s2 = getSettings();
  ensureModel(s2);
  const now = Date.now();
  const fx = normalizeStatusList(s2.character.statusEffects, now).filter(f => !(f?.expiresAt && Number(f.expiresAt) <= now));
  s2.character.statusEffects = fx;
  saveSettings();
  const list = $("#uie-fx-list");
  list.empty();
  if (!fx.length) {
    list.append(`<div style="opacity:0.72;font-weight:900;">No active effects.</div>`);
    return;
  }
  for (const it of fx.slice(0, 40)) {
    const rem = formatRemaining(it.expiresAt, now);
    const chips = summarizeMods(it.mods).slice(0, 4).map(x => `<span style="padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.10);background:rgba(0,0,0,0.22);font-size:11px;font-weight:900;opacity:0.9;">${String(x).replace(/</g, "&lt;")}</span>`).join("");
    list.append(`
      <div style="display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,0.10);background:rgba(0,0,0,0.22);">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${String(it.name || "").replace(/</g, "&lt;")}</div>
          <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">${chips}${rem ? `<span style="padding:4px 8px;border-radius:999px;border:1px solid rgba(241,196,15,0.22);background:rgba(241,196,15,0.10);font-size:11px;font-weight:900;color:#f1c40f;">${rem}</span>` : ""}</div>
        </div>
        <button class="uie-fx-edit" data-id="${String(it.id)}" style="height:32px;padding:0 10px;border-radius:12px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25);color:#fff;font-weight:900;cursor:pointer;">Edit</button>
        <button class="uie-fx-del" data-id="${String(it.id)}" style="height:32px;padding:0 10px;border-radius:12px;border:1px solid rgba(243,139,168,0.35);background:rgba(0,0,0,0.25);color:#f38ba8;font-weight:900;cursor:pointer;">✖</button>
      </div>
    `);
  }
}

function closeStatusManager() {
  $("#uie-fx-modal").hide();
}

function deleteStatusById(id) {
  const key = String(id || "").trim();
  if (!key) return;
  const s2 = getSettings();
  ensureModel(s2);
  const fx = normalizeStatusList(s2.character.statusEffects, Date.now());
  const next = fx.filter(x => String(x.id || "") !== key);
  s2.character.statusEffects = next;
  saveSettings();
  updateVitals();
  if ($("#uie-fx-modal").is(":visible")) {
    renderStatusList();
    if (String($("#uie-fx-id").val() || "") === key) setFxForm(null);
  }
}

function openStatusManager(focusId = "") {
  ensureStatusManager();
  $("#uie-fx-modal").css("display", "flex");
  renderStatusList();
  const s2 = getSettings();
  const fx = normalizeStatusList(s2.character.statusEffects, Date.now());
  const hit = focusId ? fx.find(x => String(x.id || "") === String(focusId)) : null;
  setFxForm(hit);
}

function bindStatusManagerHandlers() {
  if (fxManagerHandlersBound) return;
  fxManagerHandlersBound = true;
  $(document)
    .off("click.uieFxModal", "#uie-fx-close, #uie-fx-new, #uie-fx-save, #uie-fx-delete")
    .on("click.uieFxModal", "#uie-fx-close, #uie-fx-new, #uie-fx-save, #uie-fx-delete", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const id = String(this.id || "");
      if (id === "uie-fx-close") { closeStatusManager(); return; }
      if (id === "uie-fx-new") { setFxForm(null); return; }
      if (id === "uie-fx-delete") {
        const fxId = String($("#uie-fx-id").val() || "").trim();
        if (!fxId) return;
        deleteStatusById(fxId);
        return;
      }
      if (id === "uie-fx-save") {
        const s2 = getSettings();
        ensureModel(s2);
        const now = Date.now();
        const fx = normalizeStatusList(s2.character.statusEffects, now);
        const existingId = String($("#uie-fx-id").val() || "").trim();
        const data = readFxForm();
        if (!data.name) return;
        const k = data.name.toLowerCase();
        const curByName = fx.find(x => statusKey(x) === k && String(x.id || "") !== existingId);
        if (curByName) return;
        const next = fx.slice();
        const obj = {
          id: existingId || `fx_${now.toString(16)}_${Math.floor(Math.random() * 1e9).toString(16)}`,
          name: data.name.slice(0, 80),
          desc: data.desc.slice(0, 500),
          startedAt: now,
          expiresAt: data.durationMs ? (now + data.durationMs) : null,
          mods: data.mods,
        };
        const idx = next.findIndex(x => String(x.id || "") === obj.id);
        if (idx >= 0) {
          obj.startedAt = Number(next[idx]?.startedAt) || obj.startedAt;
          next[idx] = obj;
        } else {
          next.unshift(obj);
        }
        s2.character.statusEffects = next;
        saveSettings();
        updateVitals();
        renderStatusList();
        setFxForm(obj);
      }
    });

  $(document)
    .off("click.uieFxRow", ".uie-fx-edit, .uie-fx-del")
    .on("click.uieFxRow", ".uie-fx-edit, .uie-fx-del", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const fxId = String($(this).data("id") || "").trim();
      if (!fxId) return;
      if ($(this).hasClass("uie-fx-del")) { deleteStatusById(fxId); return; }
      const s2 = getSettings();
      const fx = normalizeStatusList(s2.character.statusEffects, Date.now());
      const hit = fx.find(x => String(x.id || "") === fxId);
      setFxForm(hit);
    });
}

const renderRebirthModal = () => {
    const el = document.createElement("div");
    el.id = "uie-rebirth-modal";
    el.style.cssText = "position:fixed;inset:0;z-index:2147483660;background:rgba(0,0,0,0.85);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px;";
    
    let grid = "";
    for(const [key, m] of Object.entries(MEDALLIONS)) {
        grid += `
          <div class="uie-medal-card" data-id="${key}" style="border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);border-radius:12px;padding:10px;cursor:pointer;transition:0.2s;">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <img src="${m.img}" style="width:40px;height:40px;border-radius:50%;border:2px solid #f1c40f;">
                  <div style="font-weight:900;color:#f1c40f;font-size:1.1em;">${m.name}</div>
              </div>
              <div style="font-size:0.85em;opacity:0.8;white-space:pre-wrap;line-height:1.4;">${m.desc}</div>
          </div>
        `;
    }

    el.innerHTML = `
      <div style="width:min(800px, 95vw);max-height:90vh;overflow:auto;background:radial-gradient(circle at center, #1a1a1a, #000);border:2px solid #f1c40f;border-radius:20px;padding:20px;color:#fff;box-shadow:0 0 50px rgba(241,196,15,0.2);">
          <h1 style="text-align:center;color:#f1c40f;text-transform:uppercase;letter-spacing:2px;margin-bottom:10px;">Ascension Available</h1>
          <p style="text-align:center;opacity:0.8;margin-bottom:20px;">You have reached the pinnacle of mortal power. Choose a path to be reborn as a legend.<br>Your Level will reset to 1, but you will gain a permanent God Medallion.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:15px;margin-bottom:20px;">
              ${grid}
          </div>
          <div style="display:flex;justify-content:center;gap:20px;">
              <button id="uie-rebirth-cancel" style="padding:10px 20px;border-radius:10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:#fff;cursor:pointer;">Cancel</button>
          </div>
      </div>
    `;
    document.body.appendChild(el);
    
    $(el).on("click", ".uie-medal-card", function() {
        const id = $(this).data("id");
        if(confirm("Are you sure you want to choose this path? This cannot be undone.")) {
            performRebirth(id);
            el.remove();
        }
    });
    
    $(el).on("click", "#uie-rebirth-cancel", function() {
        el.remove();
    });
};

const performRebirth = (medalId) => {
    const s = getSettings();
    ensureModel(s);
    
    // Reset Level
    s.character.level = 1;
    s.xp = 0;
    s.maxXp = 1000;
    s.character.reborn = true;
    s.character.activeMedallion = medalId;
    
    // Add Medallion Item
    const def = MEDALLIONS[medalId];
    if (def) {
        s.inventory.items.push({
            kind: "item",
            name: def.name,
            type: "Key Item",
            description: def.desc,
            qty: 1,
            rarity: "legendary",
            img: def.img,
            statusEffects: def.statusEffects || [],
            mods: {}
        });
    }
    
    saveSettings();
    updateVitals();
    applyInventoryUi(); // Update Rebirth button visibility
    notify("success", "REBIRTH COMPLETE! You are now a Legend.", "System", "levelUp");
};

// --- AUTOMATED LOOT & STATUS SCANNER ---
export async function scanLootAndStatus(force = false) {
    const s = getSettings();
    // If automated (not forced), check if disabled
    if (!force && s?.ai?.loot === false) return;

    const chatEl = document.querySelector("#chat");
    if (!chatEl) return;

    // Automated: Check last message ID and User vs Story
    if (!force) {
        const last = chatEl.querySelector(".mes:last-child") || chatEl.lastElementChild;
        if (!last) return;

        // Only scan Story messages automatically
        const isUser =
            last.classList?.contains("is_user") ||
            last.getAttribute("is_user") === "true" ||
            last.getAttribute("data-is-user") === "true";
        if (isUser) return;

        const id = last.getAttribute("mesid") || last.getAttribute("data-id") || last.textContent.substring(0, 20);
        if (id === lastLootMesId) return;
        lastLootMesId = id;
    }

    if (force) notify("info", "Scanning chat log...", "Inventory", "api");
    try {
        await scanEverything({ force: !!force });
    } catch (e) {
        try { console.warn("Scan Error", e); } catch (_) {}
        if (force) notify("error", "Scan failed to process.", "Inventory", "error");
    }
}

function clamp01(n) {
  n = Number(n);
  if (Number.isNaN(n) || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function pct(cur, max) {
  cur = Number(cur || 0);
  max = Number(max || 0);
  if (max <= 0) return 0;
  return Math.round(clamp01(cur / max) * 100);
}

function getRoot() {
  return document.getElementById("uie-inventory-window");
}

function isEditMode() {
  const root = getRoot();
  return !!root && root.dataset.editMode === "1";
}

function setEditMode(on) {
  const root = getRoot();
  if (!root) return;
  root.dataset.editMode = on ? "1" : "0";
  const pencil = document.getElementById("uie-inv-pencil");
  if (pencil) pencil.classList.toggle("active", on);
}

function isMobileLayout() {
  try {
    return window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  } catch (_) {
    return false;
  }
}

function setFullscreen(on) {
  const root = getRoot();
  if (!root) return;
  root.dataset.fullscreen = on ? "true" : "false";
  root.setAttribute("data-fullscreen", on ? "true" : "false");
  const btn = document.getElementById("uie-inv-fullscreen-toggle");
  const icon = btn ? btn.querySelector("i") : null;
  if (icon) icon.className = on ? "fa-solid fa-compress" : "fa-solid fa-expand";
  updateLayout();
}

function ensureInventoryUi(s) {
  if (!s) return;
  if (!s.inventory) s.inventory = {};
  if (!s.inventory.ui || typeof s.inventory.ui !== "object") s.inventory.ui = {};
  const ui = s.inventory.ui;
  if (!ui.tabs || typeof ui.tabs !== "object") ui.tabs = {};
  const defTabs = { items: true, skills: true, assets: true, equipment: true, life: true, create: true };
  for (const k of Object.keys(defTabs)) if (ui.tabs[k] === undefined) ui.tabs[k] = defTabs[k];
  if (ui.editPencil === undefined) ui.editPencil = true;
  if (ui.fabricateWand === undefined) ui.fabricateWand = true;
  if (ui.slotTypesEnabled === undefined) ui.slotTypesEnabled = true;
  if (ui.tabsBg === undefined) ui.tabsBg = "";
  if (ui.levelingEnabled === undefined) ui.levelingEnabled = true;
  if (ui.showBars === undefined) ui.showBars = true;
  if (!ui.tabBackgrounds || typeof ui.tabBackgrounds !== "object") ui.tabBackgrounds = {};
  const d = ui.tabBackgrounds;
  if (d.itemsMobile === undefined) d.itemsMobile = "https://files.catbox.moe/zddmvp.jpg";
  if (d.itemsDesktop === undefined) d.itemsDesktop = "https://files.catbox.moe/nyj8t0.jpg";
  if (typeof d.items === "string" && d.items.trim() && (!String(d.itemsDesktop || "").trim())) d.itemsDesktop = String(d.items).trim();
  if (d.skills === undefined) d.skills = "";
  if (d.life === undefined) d.life = "";
  if (d.create === undefined) d.create = "";
  if (d.assets === undefined) d.assets = "";
}

function applyLevelingProgress(s) {
  try {
    ensureModel(s);
    ensureInventoryUi(s);
    if (s.inventory?.ui?.levelingEnabled === false) return false;
    if (!s.character) s.character = {};
    if (!s.character.stats || typeof s.character.stats !== "object") s.character.stats = {};
    if (!Number.isFinite(Number(s.character.level))) s.character.level = 1;
    if (!Number.isFinite(Number(s.xp))) s.xp = 0;
    if (!Number.isFinite(Number(s.maxXp)) || Number(s.maxXp) <= 0) s.maxXp = 1000;

    let leveled = false;
    let guard = 0;
    while (Number(s.xp) >= Number(s.maxXp) && guard++ < 20) {
      s.xp = Number(s.xp) - Number(s.maxXp);
      s.character.level = Number(s.character.level) + 1;
      s.maxXp = Math.round(Number(s.maxXp) * 1.25 + 150);
      s.maxHp = Math.round((Number(s.maxHp) || 100) + 12);
      s.maxMp = Math.round((Number(s.maxMp) || 50) + 6);
      s.maxAp = Math.round((Number(s.maxAp) || 10) + 1);

      const keys = ["str","dex","con","int","wis","cha","per","luk","agi","vit","end","spi"];
      // const pick = keys[Math.floor(Math.random() * keys.length)];
      // s.character.stats[pick] = Math.max(0, Number(s.character.stats[pick] || 10) + 1);
      const ptsGain = 5 + Math.floor(Number(s.character.level) / 5);
      s.character.statPoints = (Number(s.character.statPoints) || 0) + ptsGain;
      leveled = true;
      notify("success", `Level Up → Lv ${s.character.level} (+${ptsGain} Stat Points)`, "Progress", "levelUp");
    }
    if (leveled) {
      s.hp = Math.min(Number(s.hp || s.maxHp), Number(s.maxHp));
      s.mp = Math.min(Number(s.mp || s.maxMp), Number(s.maxMp));
      s.ap = Math.min(Number(s.ap || s.maxAp), Number(s.maxAp));
    }
    return leveled;
  } catch (_) {
    return false;
  }
}

function applyInventoryUi() {
  const s = getSettings();
  if (!s) return;
  ensureInventoryUi(s);
  const ui = s.inventory.ui;
  const root = getRoot();
  if (!root) return;

  const tabsEl = root.querySelector("#tabs");
  if (tabsEl) {
    const bg = String(ui.tabsBg || "").trim();
    if (bg) {
      tabsEl.style.backgroundImage = `url("${bg}")`;
      tabsEl.style.backgroundSize = "cover";
      tabsEl.style.backgroundPosition = "center";
    } else {
      tabsEl.style.backgroundImage = "";
    }
  }

  const d = ui.tabBackgrounds || {};
  const itemsBg = String((isMobileLayout() ? (d.itemsMobile || "") : (d.itemsDesktop || "")) || d.items || "").trim();
  const skillsBg = String(d.skills || "").trim() || itemsBg;

  if (itemsBg) {
    root.style.backgroundImage = `url("${itemsBg}")`;
    root.style.backgroundSize = "cover";
    root.style.backgroundPosition = "center";
  } else {
    root.style.backgroundImage = "";
  }

  const applyPaneBg = (paneId, url, fallbackUrl) => {
    const el = root.querySelector(paneId);
    if (!el) return;
    const u = String(url || "").trim() || String(fallbackUrl || "").trim();
    if (!u) {
      el.style.backgroundImage = "";
      return;
    }
    el.style.backgroundImage = `url("${u}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
  };
  applyPaneBg("#uie-view-items", skillsBg, skillsBg);
  applyPaneBg("#uie-view-skills", skillsBg, skillsBg);
  applyPaneBg("#uie-view-life", skillsBg, skillsBg);
  applyPaneBg("#uie-view-create", skillsBg, skillsBg);
  applyPaneBg("#uie-view-assets", d.assets, itemsBg);
  applyPaneBg("#uie-view-equip", skillsBg, skillsBg);

  const tabMap = [
    ["items", "inv-tab-items"],
    ["skills", "inv-tab-skills"],
    ["assets", "inv-tab-assets"],
    ["equipment", "inv-tab-equipment"],
    ["life", "inv-tab-life"],
    ["create", "inv-tab-create"],
  ];
  for (const [tab, cbId] of tabMap) {
    const enabled = ui.tabs?.[tab] !== false;
    const el = root.querySelector(`#tabs [data-tab="${tab}"]`);
    if (el) el.style.display = enabled ? "" : "none";
    const cb = document.getElementById(cbId);
    if (cb) cb.checked = enabled;
  }

  const pencil = document.getElementById("uie-inv-pencil");
  const wand = document.getElementById("uie-inv-sparkle");
  if (pencil) pencil.style.display = ui.editPencil === false ? "none" : "";
  if (wand) wand.style.display = ui.fabricateWand === false ? "none" : "";
  const cbEdit = document.getElementById("inv-fn-edit");
  const cbFab = document.getElementById("inv-fn-fabricate");
  const cbSlot = document.getElementById("inv-fn-slottypes");
  const cbLvl = document.getElementById("inv-fn-leveling");
  const cbBars = document.getElementById("inv-ui-bars");
  if (cbEdit) cbEdit.checked = ui.editPencil !== false;
  if (cbFab) cbFab.checked = ui.fabricateWand !== false;
  if (cbSlot) cbSlot.checked = ui.slotTypesEnabled !== false;
  if (cbLvl) cbLvl.checked = ui.levelingEnabled !== false;
  if (cbBars) cbBars.checked = ui.showBars !== false;
  
  // Rebirth Option Visibility
  const s2 = getSettings();
  const canRebirth = (s2?.character?.level >= 150 && !s2?.character?.reborn);
  const rbBtn = document.getElementById("uie-inv-rebirth-opt");
  if (rbBtn) rbBtn.style.display = canRebirth ? "block" : "none";

  const showBars = ui.showBars !== false;
  const bottom = root.querySelector("#bottom-stats");
  if (bottom) bottom.style.display = showBars ? "" : "none";
  const meta = root.querySelector(".uie-inv-title .meta");
  if (meta) meta.style.display = showBars ? "" : "none";
  const mobileMeta = document.getElementById("uie-inv-meta-mobile");
  if (mobileMeta) mobileMeta.style.display = showBars ? "" : "none";

  const active = root.querySelector("#tabs [data-tab].active");
  const activeTab = String(active?.getAttribute("data-tab") || "");
  if (activeTab && ui.tabs?.[activeTab] === false) {
    const first = Array.from(root.querySelectorAll("#tabs [data-tab]")).find((n) => n && getComputedStyle(n).display !== "none");
    if (first) first.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("FileReader failed"));
    r.readAsDataURL(file);
  });
}

async function pickLocalImage() {
  const input = document.getElementById("uie-inv-file");
  if (!input) return null;
  input.value = "";
  return await new Promise((resolve) => {
    const onChange = async () => {
      input.removeEventListener("change", onChange);
      const f = input.files && input.files[0];
      if (!f) return resolve(null);
      try {
        const dataUrl = await readFileAsDataUrl(f);
        resolve(dataUrl);
      } catch (_) {
        resolve(null);
      }
    };
    input.addEventListener("change", onChange, { once: true });
    input.click();
  });
}

function openEditor(itemIndex) {
  const s = getSettings();
  ensureModel(s);
  const item = s.inventory.items[itemIndex];
  if (!item) return;

  editorItemIndex = itemIndex;

  $("#uie-inv-edit-name").val(item.name || "");
  $("#uie-inv-edit-type").val(item.type || "");
  $("#uie-inv-edit-desc").val(item.description || item.desc || "");

  const mods = item.mods && typeof item.mods === "object" ? item.mods : {};
  $("#uie-inv-edit-str").val(Number.isFinite(Number(mods.str)) ? Number(mods.str) : 0);
  $("#uie-inv-edit-dex").val(Number.isFinite(Number(mods.dex)) ? Number(mods.dex) : 0);
  $("#uie-inv-edit-int").val(Number.isFinite(Number(mods.int)) ? Number(mods.int) : 0);
  $("#uie-inv-edit-vit").val(Number.isFinite(Number(mods.vit)) ? Number(mods.vit) : 0);
  $("#uie-inv-edit-luk").val(Number.isFinite(Number(mods.luk)) ? Number(mods.luk) : 0);
  $("#uie-inv-edit-cha").val(Number.isFinite(Number(mods.cha)) ? Number(mods.cha) : 0);

  const statuses = Array.isArray(item.statusEffects) ? item.statusEffects : [];
  $("#uie-inv-edit-status").val(statuses.join(", "));

  $("#uie-inv-editor").css("display", "flex");
}

function closeEditor() {
  editorItemIndex = null;
  pendingImageTarget = null;
  $("#uie-inv-editor").hide();
}

async function handlePickFor(target) {
  pendingImageTarget = target;
  const dataUrl = await pickLocalImage();
  if (!dataUrl) return;

  const s = getSettings();
  ensureModel(s);

  if (pendingImageTarget === "avatar") {
    s.character.avatar = dataUrl;
  } else if (pendingImageTarget === "portrait") {
    s.character.portrait = dataUrl;
  } else if (pendingImageTarget === "item") {
    const idx = Number(editorItemIndex);
    const item = s.inventory.items[idx];
    if (item) item.img = dataUrl;
  }

  saveSettings();
  updateVitals();

  try {
    const active = document.querySelector("#uie-inventory-window #tabs .tab-pill.active");
    if (active && active.dataset.tab === "items") {
      import("./features/items.js").then((mod) => {
        if (mod && typeof mod.render === "function") mod.render();
      });
    }
  } catch (_) {}
}

async function ensureRouteLoaded(route) {
  const root = getRoot();
  if (!root) return;

  const view = document.querySelector(route.view);
  if (!view) return;

  if (!view.dataset.uieLoaded) {
    try {
        const html = await loadFeatureTemplate(route.template);
        if (html) {
            view.innerHTML = html;
            view.dataset.uieLoaded = "1";
        } else {
            view.innerHTML = "<div style='padding:20px;'>Template empty.</div>";
        }
    } catch (e) {
        console.error("Error loading route template", e);
        view.innerHTML = "<div style='padding:20px;color:red;'>Template Error</div>";
    }
  }

  try {
      const mod = await import(route.module);
      if (route.init && typeof mod[route.init] === "function") {
        await mod[route.init](route.initArg);
      }
      if (typeof mod.render === "function") {
        mod.render();
      }
  } catch (e) {
      console.error(`[UIE] Failed to load module ${route.module}`, e);
  }
}

function showView(viewSel) {
  const root = getRoot();
  if (!root) return;
  const panes = root.querySelectorAll(".uie-view-pane");
  panes.forEach((p) => {
    p.style.display = p.matches(viewSel) ? "block" : "none";
  });
}

function renderFallbackItemsGrid() {
  const root = getRoot();
  if (!root) return;
  const pane = root.querySelector("#uie-view-items");
  if (!pane) return;
  const s = getSettings();
  ensureModel(s);

  const items = Array.isArray(s.inventory?.items) ? s.inventory.items : [];
  const html = items
    .filter((it) => it && typeof it === "object")
    .map((it, idx) => {
      const name = String(it.name || it.type || "Item");
      const qty = Math.max(0, Number(it.qty || 0));
      const img = String(it.img || "");
      const safeName = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const safeImg = img.replace(/"/g, "&quot;");
      return `
        <div class="uie-item" data-idx="${idx}">
          <div class="uie-thumb">
            ${img ? `<img src="${safeImg}" alt="">` : ``}
            ${qty > 1 ? `<div class="qty">x${qty}</div>` : ``}
          </div>
          <div class="uie-item-name">${safeName}</div>
        </div>
      `;
    })
    .join("");

  pane.innerHTML = `<div class="uie-inv-grid">${html}</div>`;
}

function portalInventoryOverlaysToBody() {
  const ids = ["#uie-inv-editor"];
  for (const sel of ids) {
    const el = document.querySelector(sel);
    if (!el) continue;
    if (el.dataset.uiePortaled === "1") continue;
    document.body.appendChild(el);
    el.dataset.uiePortaled = "1";
  }
}

export function initInventory() {
  const root = getRoot();
  if (!root) return;

  const s = getSettings();
  ensureModel(s);
  ensureInventoryUi(s);
  portalInventoryOverlaysToBody();

  setFullscreen(true);

  const routes = {
    items: { view: "#uie-view-items", template: "items", module: "./features/items.js", init: "init", initArg: "#uie-view-items" },
    skills: { view: "#uie-view-skills", template: "skills", module: "./features/skills.js", init: "init" },
    assets: { view: "#uie-view-assets", template: "assets", module: "./features/assets.js", init: "init" },
    equipment: { view: "#uie-view-equip", template: "equipment", module: "./features/equipment_rpg.js", init: "init" },
    life: { view: "#uie-view-life", template: "life", module: "./features/life.js", init: "init" },
    create: { view: "#uie-view-create", template: "create", module: "./features/create.js", init: "init" },
  };

  window.UIE_openItemEditor = (idx) => openEditor(Number(idx));
  window.UIE_isInventoryEditMode = () => isEditMode();

  $(document)
    .off("click.uieInvTab", "#uie-inventory-window #tabs [data-tab]")
    .on("click.uieInvTab", "#uie-inventory-window #tabs [data-tab]", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const tab = String($(this).data("tab") || "");
      const s2 = getSettings();
      ensureInventoryUi(s2);
      if (tab && s2?.inventory?.ui?.tabs?.[tab] === false) return;
      if (!tab || !routes[tab]) return;

      $("#uie-inventory-window #tabs [data-tab]").removeClass("active");
      $(this).addClass("active");

      getRoot().setAttribute("data-active-tab", tab);

      showView(routes[tab].view);

      await ensureRouteLoaded(routes[tab]);
    });

  const toggleFloatingMenu = (menuId, anchorId) => {
    const menu = document.getElementById(menuId);
    const anchor = document.getElementById(anchorId);
    if (!menu || !anchor) return;
    if (menu.dataset.uiePortaled !== "1") {
      document.body.appendChild(menu);
      menu.dataset.uiePortaled = "1";
    }
    const nextOpen = menu.style.display !== "block";
    const otherMenus = ["uie-inv-sparkle-menu", "uie-inv-gear-menu"].filter(x => x !== menuId);
    for (const oid of otherMenus) {
      const o = document.getElementById(oid);
      if (o) o.style.display = "none";
    }
    if (!nextOpen) { menu.style.display = "none"; return; }
    menu.style.position = "fixed";
    menu.style.zIndex = "2147483646";
    menu.style.display = "block";
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const pad = 8;
      const w = rect.width || 260;
      const h = rect.height || 220;
      const badAnchor = (!Number.isFinite(r.left) || !Number.isFinite(r.top) || (r.left === 0 && r.top === 0 && r.width === 0 && r.height === 0));

      let top = badAnchor ? Math.round((vh - h) / 2) : Math.round(r.bottom + 8);
      if (!badAnchor && top + h > vh - pad) top = Math.round(r.top - h - 8);
      top = Math.max(pad, Math.min(top, vh - h - pad));

      let left = badAnchor ? Math.round((vw - w) / 2) : Math.round(r.left);
      if (!badAnchor && left + w > vw - pad) left = Math.round(r.right - w);
      left = Math.max(pad, Math.min(left, vw - w - pad));

      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.right = "auto";
    };
    try { requestAnimationFrame(place); } catch (_) { setTimeout(place, 0); }
  };

  const createStation = { open: false, parent: null, next: null };

  const ensureCreateStationOverlay = () => {
    if (document.getElementById("uie-create-station-overlay")) return;
    const el = document.createElement("div");
    el.id = "uie-create-station-overlay";
    el.style.cssText = "position:fixed;inset:0;z-index:2147483646;display:none;background:rgba(0,0,0,0.58);backdrop-filter:blur(10px);";
    el.innerHTML = `<div id="uie-create-station-shell" style="position:absolute; inset:0; background:rgba(0,0,0,0.35);"></div>`;
    document.body.appendChild(el);
  };

  const openCreateStation = () => {
    const menu = document.getElementById("uie-inv-sparkle-menu");
    if (!menu) return;
    ensureCreateStationOverlay();
    const ov = document.getElementById("uie-create-station-overlay");
    const shell = document.getElementById("uie-create-station-shell");
    if (!ov || !shell) return;
    if (!createStation.open) {
      createStation.parent = menu.parentElement;
      createStation.next = menu.nextSibling;
    }
    createStation.open = true;
    shell.appendChild(menu);
    menu.dataset.uiePortaled = "1";
    menu.style.display = "block";
    menu.style.position = "absolute";
    menu.style.inset = "0";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.bottom = "";
    menu.style.width = "100%";
    menu.style.height = "100%";
    menu.style.maxHeight = "100%";
    menu.style.borderRadius = "0";
    menu.style.overflow = "auto";
    menu.style.zIndex = "2147483647";
    ov.style.display = "block";
  };

  const closeCreateStation = () => {
    const menu = document.getElementById("uie-inv-sparkle-menu");
    const ov = document.getElementById("uie-create-station-overlay");
    if (ov) ov.style.display = "none";
    if (!menu) { createStation.open = false; return; }
    menu.style.display = "none";
    menu.style.inset = "";
    menu.style.width = "";
    menu.style.height = "";
    menu.style.maxHeight = "";
    menu.style.borderRadius = "";
    menu.style.overflow = "";
    menu.style.zIndex = "";
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.right = "";
    menu.style.bottom = "";
    const parent = createStation.parent;
    const next = createStation.next;
    if (parent && parent.isConnected) {
      if (next && next.parentNode === parent) parent.insertBefore(menu, next);
      else parent.appendChild(menu);
    }
    createStation.open = false;
  };

  $(document)
    .off("click.uieLootScan", "#uie-create-scan-loot")
    .on("click.uieLootScan", "#uie-create-scan-loot", async function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCreateStation();
      await scanLootAndStatus(true);
    });

  $(document)
    .off("click.uieWarRoomScan", "#uie-create-scan-warroom")
    .on("click.uieWarRoomScan", "#uie-create-scan-warroom", async function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCreateStation();
      try {
        const baseUrl = (() => {
          try {
            const u = String(window.UIE_BASEURL || "");
            if (u) return u.endsWith("/") ? u : `${u}/`;
          } catch (_) {}
          return "/scripts/extensions/third-party/universal-immersion-engine/";
        })();
        const root = (() => {
          try {
            let r = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine");
            r = r.replace(/^\/+|\/+$/g, "");
            return r;
          } catch (_) {
            return "scripts/extensions/third-party/universal-immersion-engine";
          }
        })();
        if (document.getElementById("uie-battle-window") === null) {
          const { fetchTemplateHtml } = await import("./templateFetch.js");
          const urls = [
            `${baseUrl}src/templates/battle.html`,
            `/${root}/src/templates/battle.html`,
            `/scripts/extensions/third-party/universal-immersion-engine/src/templates/battle.html`,
          ];
          let html = "";
          for (const url of urls) {
            try { html = await fetchTemplateHtml(url); if (html) break; } catch (_) {}
          }
          if (html) document.body.insertAdjacentHTML("beforeend", html);
        }
      } catch (_) {}
      try {
        if (typeof window.UIE_forceOpenWindow === "function") {
          window.UIE_forceOpenWindow("#uie-battle-window", "./battle.js", "initBattle");
        } else {
          $("#uie-battle-window").show().css("display", "flex");
        }
      } catch (_) {}
      try {
        const mod = await import("./battle.js");
        if (typeof mod?.scanBattleNow === "function") await mod.scanBattleNow();
      } catch (_) {}
    });

  $(document)
    .off("click.uieInvPencil", "#uie-inv-pencil")
    .on("click.uieInvPencil", "#uie-inv-pencil", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setEditMode(!isEditMode());
      notify("success", isEditMode() ? "Edit mode on" : "Edit mode off", "Inventory", "inventory");
    });

  const editName = () => {
    const s2 = getSettings();
    ensureModel(s2);
    const cur = String(s2.character?.name || "");
    const next = prompt("Name:", cur);
    if (next === null) return;
    s2.character.name = String(next).slice(0, 60);
    s2.character.syncPersona = false;
    saveSettings();
    updateVitals();
  };

  const editClassAndLevel = () => {
    const s2 = getSettings();
    ensureModel(s2);
    const curClass = String(s2.character?.className || s2.character?.class || "");
    const nextClass = prompt("Class:", curClass);
    if (nextClass === null) return;
    s2.character.className = String(nextClass).slice(0, 60);
    const curLvl = String(s2.character?.level ?? "");
    const nextLvl = prompt("Level:", curLvl);
    if (nextLvl !== null) s2.character.level = Math.max(1, Number(nextLvl) || 1);
    saveSettings();
    updateVitals();
  };

  const editStatBlock = () => {
    const s2 = getSettings();
    ensureModel(s2);
    if (!s2.character.stats || typeof s2.character.stats !== "object") s2.character.stats = {};
    const keys = ["str","dex","con","int","wis","cha","per","luk","agi","vit","end","spi"];
    for (const k of keys) {
      const cur = String(s2.character.stats[k] ?? 10);
      const next = prompt(`${k.toUpperCase()}:`, cur);
      if (next === null) continue;
      s2.character.stats[k] = Math.max(0, Number(next) || 0);
    }
    saveSettings();
    updateVitals();
  };

  const editStatusEffects = () => {
    openStatusManager();
  };
  bindStatusManagerHandlers();

  const editBar = (stat) => {
    const s2 = getSettings();
    ensureModel(s2);
    const k = String(stat || "");
    const curKey = k === "hp" ? "hp" : k === "mp" ? "mp" : k === "ap" ? "ap" : "xp";
    const maxKey = k === "hp" ? "maxHp" : k === "mp" ? "maxMp" : k === "ap" ? "maxAp" : "maxXp";
    const curVal = Number(s2[curKey] || 0);
    const maxVal = Number(s2[maxKey] || 0);
    const next = prompt(`${k.toUpperCase()} (format: cur/max):`, `${curVal}/${maxVal}`);
    if (next === null) return;
    const parts = String(next).split("/").map(x => x.trim());
    const c = Math.max(0, Number(parts[0] || 0) || 0);
    const m = Math.max(0, Number(parts[1] || 0) || 0);
    s2[curKey] = c;
    s2[maxKey] = m || m === 0 ? m : s2[maxKey];
    saveSettings();
    updateVitals();
  };

  $(document)
    .off("click.uieInvEditName", "#uie-inventory-window .uie-inv-title .name, #uie-inv-mobile-name")
    .on("click.uieInvEditName", "#uie-inventory-window .uie-inv-title .name, #uie-inv-mobile-name", function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      editName();
    });

  $(document)
    .off("click.uieInvEditClass", "#uie-inventory-window .uie-inv-title .meta, #uie-inv-classline, #uie-inv-mobile-meta")
    .on("click.uieInvEditClass", "#uie-inventory-window .uie-inv-title .meta, #uie-inv-classline, #uie-inv-mobile-meta", function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      editClassAndLevel();
    });

  $(document)
    .off("click.uieInvEditStats", "#uie-inventory-window #bottom-stats .stat")
    .on("click.uieInvEditStats", "#uie-inventory-window #bottom-stats .stat", function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const stat = String($(this).data("stat") || "");
      if (stat === "hp" || stat === "mp" || stat === "ap" || stat === "xp") {
        editBar(stat);
        return;
      }
      editStatBlock();
    });

  $(document)
    .off("click.uieInvEditFx", "#uie-inv-status-strip")
    .on("click.uieInvEditFx", "#uie-inv-status-strip", function (e) {
      if (!isEditMode()) return;
      if ($(e.target).closest(".inv-fx").length) return;
      e.preventDefault();
      e.stopPropagation();
      editStatusEffects();
    });

  $(document)
    .off("click.uieInvEditAvatar", "#uie-inventory-window .uie-inv-avatar")
    .on("click.uieInvEditAvatar", "#uie-inventory-window .uie-inv-avatar", async function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const img = await pickLocalImage();
      if (!img) return;
      const s2 = getSettings();
      ensureModel(s2);
      s2.character.avatar = img;
      saveSettings();
      updateVitals();
    });

  $(document)
    .off("click.uieInvEditPortrait", "#uie-inv-portrait")
    .on("click.uieInvEditPortrait", "#uie-inv-portrait", async function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const img = await pickLocalImage();
      if (!img) return;
      const s2 = getSettings();
      ensureModel(s2);
      s2.character.portrait = img;
      saveSettings();
      updateVitals();
    });

  $(document)
    .off("click.uieInvEditTabsBg", "#uie-inventory-window #tabs")
    .on("click.uieInvEditTabsBg", "#uie-inventory-window #tabs", function (e) {
      if (!isEditMode()) return;
      if ($(e.target).closest("#uie-inventory-window #tabs [data-tab]").length) return;
      e.preventDefault();
      e.stopPropagation();
      const s2 = getSettings();
      ensureModel(s2);
      ensureInventoryUi(s2);
      const cur = String(s2.inventory.ui.tabsBg || "");
      const next = prompt("Inventory tabs background URL (empty clears):", cur);
      if (next === null) return;
      s2.inventory.ui.tabsBg = String(next || "");
      saveSettings();
      applyInventoryUi();
    });

  $(document)
    .off("click.uieInvCloseMenus")
    .on("click.uieInvCloseMenus", function (e) {
      if ($(e.target).closest("#uie-create-station-overlay, #uie-inv-sparkle-menu").length) return;
      if ($(e.target).closest("#uie-inv-pencil, #uie-inv-sparkle, #uie-inv-sparkle-menu, #uie-inv-gear, #uie-inv-gear-menu").length) return;
      const sm = document.getElementById("uie-inv-sparkle-menu");
      if (sm) sm.style.display = "none";
      const gm = document.getElementById("uie-inv-gear-menu");
      if (gm) gm.style.display = "none";
    });

  $(document)
    .off("click.uieInvGear", "#uie-inv-gear")
    .on("click.uieInvGear", "#uie-inv-gear", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleFloatingMenu("uie-inv-gear-menu", "uie-inv-gear");
      applyInventoryUi();
    });

  $(document)
    .off("click.uieInvRebirth", "#uie-inv-trigger-rebirth")
    .on("click.uieInvRebirth", "#uie-inv-trigger-rebirth", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const s2 = getSettings();
      ensureModel(s2);
      if (!(Number(s2?.character?.level || 0) >= 150 && !s2?.character?.reborn)) return;
      const gm = document.getElementById("uie-inv-gear-menu");
      if (gm) gm.style.display = "none";
      renderRebirthModal();
    });

  $(document)
    .off("change.uieInvGearMenu", "#uie-inv-gear-menu input[type='checkbox']")
    .on("change.uieInvGearMenu", "#uie-inv-gear-menu input[type='checkbox']", async function (e) {
      e.preventDefault();
      e.stopPropagation();
      const s2 = getSettings();
      ensureModel(s2);
      ensureInventoryUi(s2);
      const ui = s2.inventory.ui;

      ui.tabs.items = $("#inv-tab-items").is(":checked");
      ui.tabs.skills = $("#inv-tab-skills").is(":checked");
      ui.tabs.assets = $("#inv-tab-assets").is(":checked");
      ui.tabs.equipment = $("#inv-tab-equipment").is(":checked");
      ui.tabs.life = $("#inv-tab-life").is(":checked");
      ui.tabs.create = $("#inv-tab-create").is(":checked");

      ui.editPencil = $("#inv-fn-edit").is(":checked");
      ui.fabricateWand = $("#inv-fn-fabricate").is(":checked");
      ui.slotTypesEnabled = $("#inv-fn-slottypes").is(":checked");
      ui.levelingEnabled = $("#inv-fn-leveling").is(":checked");
      ui.showBars = $("#inv-ui-bars").is(":checked");

      saveSettings();
      applyInventoryUi();
      try { (await import("./features/items.js")).render?.(); } catch (_) {}
    });

  $(document)
    .off("click.uieInvSparkle", "#uie-inv-sparkle")
    .on("click.uieInvSparkle", "#uie-inv-sparkle", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openCreateStation();
      const st = document.getElementById("uie-create-status");
      if (st) st.textContent = "";
    });

  $(document)
    .off("click.uieInvSparkleClose", "#uie-create-close")
    .on("click.uieInvSparkleClose", "#uie-create-close", function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeCreateStation();
    });

  $(document)
    .off("click.uieCreateStationOverlay", "#uie-create-station-overlay")
    .on("click.uieCreateStationOverlay", "#uie-create-station-overlay", function (e) {
      if ($(e.target).closest("#uie-inv-sparkle-menu").length) return;
      e.preventDefault();
      e.stopPropagation();
      closeCreateStation();
    });

  $(document)
    .off("click.uieCreationStation", "#uie-create-run")
    .on("click.uieCreationStation", "#uie-create-run", async function (e) {
      e.preventDefault();
      e.stopPropagation();

      const s2 = getSettings();
      ensureModel(s2);
      ensureInventoryUi(s2);

      const kind = String($("#uie-create-kind").val() || "item");
      const desc = String($("#uie-create-desc").val() || "").trim().slice(0, 600);
      const qty = Math.max(1, Math.min(5, Number($("#uie-create-qty").val() || 1)));
      const genImg = $("#uie-create-gen-img").is(":checked");
      
      const st = document.getElementById("uie-create-status");
      if (kind === "currency" || kind === "xp") {
        if (st) st.textContent = "Use +Money / +XP below";
        return;
      }
      if (st) st.textContent = "Creating…";

      const chat = await getChatTranscriptText({ maxMessages: 30, maxChars: 2600 });

      const persona = (() => { try { const ctx = getContext?.(); return String(ctx?.name1 || "You").trim() || "You"; } catch (_) { return "You"; } })();
      const base = desc ? `User request: ${desc}\n\n` : "";
      
      // Determine if we use Staging Area
      const useStaging = ["item", "skill", "asset"].includes(kind);
      const isArrayReq = useStaging && qty > 1;

      let prompt = "";
      if (kind === "class") {
          prompt = `${base}Return ONLY JSON: {"className":"","level":1,"stats":{"str":10,"dex":10,"con":10,"int":10,"wis":10,"cha":10,"per":10,"luk":10,"agi":10,"vit":10,"end":10,"spi":10},"skills":[{"name":"","description":""}],"assets":[{"name":"","description":""}],"items":[{"name":"","description":"","type":"","rarity":"common|uncommon|rare|epic|legendary","qty":1,"statusEffects":[""],"img":""}],"equipment":[{"slotId":"","name":"","type":"","rarity":"","statusEffects":[""],"img":""}],"statusEffects":[""]}\nRules:\n- If user requested a specific level, set it.\n- If not requested, use Current level.\n- Keep arrays short (<= 10 each)\nCurrent level: ${Number(s2.character?.level || 1)}\nPersona:${persona}\nContext:\n${chat}`;
      } else if (kind === "status") {
          prompt = `${base}Return ONLY JSON: {"statusEffects":[""]}\nRules:\n- 0-6 short strings\nPersona:${persona}\nContext:\n${chat}`;
      } else {
          // Item / Skill / Asset
          const schema = kind === "skill" 
            ? `{"name":"","description":"","skillType":"active|passive","statusEffects":[""],"mods":{"str":0,"dex":0,"int":0}}`
            : kind === "asset"
              ? `{"name":"","description":"","category":"","location":"","statusEffects":[""]}`
              : `{"name":"","description":"","type":"","rarity":"common|uncommon|rare|epic|legendary","qty":1,"statusEffects":[""],"img":""}`;
          
          if (isArrayReq) {
              prompt = `${base}Return ONLY JSON Array of ${qty} items: [${schema}, ...]\nPersona:${persona}\nContext:\n${chat}`;
          } else {
              prompt = `${base}Return ONLY JSON: ${schema}\nPersona:${persona}\nContext:\n${chat}`;
          }
      }

      try {
        const res = await generateContent(prompt.slice(0, 6000), "System Check");
        if (!res) return;
        let obj = null;
        try { obj = JSON.parse(String(res).replace(/```json|```/g, "").trim()); } catch (_) { obj = null; }
        if (!obj || typeof obj !== "object") return;

        if (kind === "class" || kind === "status") {
             if (kind === "class") {
                  if (!s2.character) s2.character = {};
                  if (!s2.character.stats || typeof s2.character.stats !== "object") s2.character.stats = {};
                  if (!Array.isArray(s2.character.statusEffects)) s2.character.statusEffects = [];
                  if (!Array.isArray(s2.inventory.skills)) s2.inventory.skills = [];
                  if (!Array.isArray(s2.inventory.assets)) s2.inventory.assets = [];
                  if (!Array.isArray(s2.inventory.items)) s2.inventory.items = [];
                  if (!Array.isArray(s2.inventory.equipped)) s2.inventory.equipped = [];

                  const cn = String(obj?.className || obj?.class || obj?.name || "").trim();
                  if (cn) s2.character.className = cn.slice(0, 60);
                  const lvl = Number(obj?.level);
                  if (Number.isFinite(lvl) && lvl >= 1) s2.character.level = Math.max(1, Math.floor(lvl));

                  const st = obj?.stats && typeof obj.stats === "object" ? obj.stats : null;
                  if (st) {
                    for (const k of Object.keys(st)) {
                      const v = Number(st[k]);
                      if (Number.isFinite(v)) s2.character.stats[k] = v;
                    }
                  }

                  const fxArr = Array.isArray(obj?.statusEffects) ? obj.statusEffects : [];
                  const mergedFx = [...s2.character.statusEffects];
                  for (const it of fxArr) {
                    const v = String(it || "").trim();
                    if (!v) continue;
                    if (!mergedFx.includes(v)) mergedFx.push(v);
                  }
                  s2.character.statusEffects = mergedFx.slice(0, 25);
                  
                  // Helper
                  const dedupeByName = (arr) => {
                    const seen = new Set();
                    const out = [];
                    for (const it of arr) {
                      const nm = String(it?.name || it?.title || it || "").trim();
                      const k = nm.toLowerCase();
                      if (!nm || seen.has(k)) continue;
                      seen.add(k);
                      out.push(it);
                    }
                    return out;
                  };

                  const newSkills = Array.isArray(obj?.skills) ? obj.skills : [];
                  s2.inventory.skills = dedupeByName([...s2.inventory.skills, ...newSkills.map(x => (typeof x === "string" ? { kind: "skill", name: x, description: "" } : { kind: "skill", ...x }))]).slice(0, 120);

                  const newAssets = Array.isArray(obj?.assets) ? obj.assets : [];
                  s2.inventory.assets = dedupeByName([...s2.inventory.assets, ...newAssets.map(x => (typeof x === "string" ? { kind: "asset", name: x, description: "" } : { kind: "asset", ...x }))]).slice(0, 160);

                  const newItems = Array.isArray(obj?.items) ? obj.items : [];
                  s2.inventory.items = dedupeByName([...s2.inventory.items, ...newItems.map(x => (typeof x === "string" ? { kind: "item", name: x, description: "" } : { kind: "item", ...x }))]).slice(0, 400);

                  const eq = Array.isArray(obj?.equipment) ? obj.equipment : [];
                  for (const x of eq) {
                    const slotId = String(x?.slotId || "").trim();
                    if (!slotId) continue;
                    const item = {
                      slotId,
                      name: String(x?.name || "").trim().slice(0, 80) || slotId.toUpperCase(),
                      type: String(x?.type || "equip").trim().slice(0, 40),
                      rarity: String(x?.rarity || "common").trim().slice(0, 24),
                      statusEffects: Array.isArray(x?.statusEffects) ? x.statusEffects.map(v => String(v || "").trim()).filter(Boolean).slice(0, 10) : [],
                      img: String(x?.img || "").trim()
                    };
                    const idx = s2.inventory.equipped.findIndex(e => String(e?.slotId || "") === slotId);
                    if (idx >= 0) s2.inventory.equipped[idx] = { ...s2.inventory.equipped[idx], ...item };
                    else s2.inventory.equipped.push(item);
                  }

                  saveSettings();
                  updateVitals();
                  try { const mod = await import("./features/equipment_rpg.js"); if (mod?.render) mod.render(); } catch (_) {}
                  try { (await import("./features/items.js")).render?.(); } catch (_) {}
                  try { (await import("./features/skills.js")).init?.(); } catch (_) {}
                  try { (await import("./features/assets.js")).init?.(); } catch (_) {}
             } else {
                  // Status
                  const newFx = Array.isArray(obj?.statusEffects) ? obj.statusEffects : [];
                  if (!s2.character) s2.character = {};
                  if (!Array.isArray(s2.character.statusEffects)) s2.character.statusEffects = [];
                  const merged = [...s2.character.statusEffects];
                  for (const it of newFx) {
                    const v = String(it || "").trim();
                    if (!v) continue;
                    if (!merged.includes(v)) merged.push(v);
                  }
                  s2.character.statusEffects = merged.slice(0, 20);
                  saveSettings();
                  try { const mod = await import("./features/equipment_rpg.js"); if (mod?.render) mod.render(); } catch (_) {}
             }
             if (st) st.textContent = "Done!";
             return;
        }

        // --- STAGING AREA (Item / Skill / Asset) ---
        if (useStaging) {
            const results = Array.isArray(obj) ? obj : [obj];
            const $stage = $("#uie-create-staging");
            $stage.show().empty();
            
            for (let i = 0; i < results.length; i++) {
                const item = results[i];
                item.kind = kind;
                const uid = Date.now() + Math.random().toString(36).substr(2, 9);
                
                // Render Card
                const card = $(`
                    <div class="uie-stage-card" id="stage-${uid}" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:10px; padding:10px; display:flex; gap:10px;">
                        <div style="width:80px; display:flex; flex-direction:column; gap:6px; align-items:center;">
                            <div class="uie-stage-img-box" style="width:80px; height:80px; background:#000; border:1px solid #444; border-radius:8px; overflow:hidden; position:relative; display:flex; align-items:center; justify-content:center;">
                                ${item.img ? `<img src="${item.img}" style="width:100%;height:100%;object-fit:cover;">` : `<i class="fa-solid fa-image" style="color:#333;font-size:24px;"></i>`}
                            </div>
                            ${genImg ? `<button class="uie-stage-regen" data-uid="${uid}" style="font-size:10px; padding:4px; width:100%; background:#222; border:1px solid #444; color:#ccc; border-radius:4px; cursor:pointer;">Regen Img</button>` : ""}
                        </div>
                        <div style="flex:1; display:flex; flex-direction:column; gap:6px;">
                            <input class="uie-stage-name" value="${item.name || ""}" placeholder="Name" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#fff; padding:6px; border-radius:6px; font-weight:bold;">
                            <textarea class="uie-stage-desc" placeholder="Description" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); color:#aaa; padding:6px; border-radius:6px; height:50px; resize:vertical;">${item.description || ""}</textarea>
                            <div style="display:flex; gap:6px;">
                                <button class="uie-stage-save" data-uid="${uid}" style="flex:1; background:rgba(46, 204, 113, 0.2); border:1px solid rgba(46, 204, 113, 0.4); color:#2ecc71; border-radius:6px; cursor:pointer; font-weight:bold; padding:6px;">Save & Add</button>
                                <button class="uie-stage-discard" data-uid="${uid}" style="width:30px; background:rgba(231, 76, 60, 0.2); border:1px solid rgba(231, 76, 60, 0.4); color:#e74c3c; border-radius:6px; cursor:pointer;">×</button>
                            </div>
                        </div>
                    </div>
                `);
                
                // Store data on element
                card.data("item", item);
                $stage.append(card);
                
                // Trigger Image Gen if requested
                if (genImg) {
                    const imgBox = card.find(".uie-stage-img-box");
                    imgBox.html('<i class="fa-solid fa-spinner fa-spin" style="color:#f1c40f;"></i>');
                    generateImageAPI(`[UIE_LOCKED] Fantasy RPG icon/illustration for ${kind}: ${item.name}. ${item.description}`).then(url => {
                        if (url) {
                            item.img = url;
                            imgBox.html(`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`);
                        } else {
                            imgBox.html('<i class="fa-solid fa-triangle-exclamation" style="color:#e74c3c;" title="Gen Failed"></i>');
                        }
                    });
                }
            }
            if (st) st.textContent = `Drafted ${results.length} item(s). Review below.`;
        }

      } finally {
        if (st && st.textContent === "Creating…") st.textContent = "";
      }
    });

  // --- STAGING HANDLERS ---
  $(document).off("click.stageSave", ".uie-stage-save").on("click.stageSave", ".uie-stage-save", function(e) {
      e.preventDefault();
      const uid = $(this).data("uid");
      const card = $(`#stage-${uid}`);
      const item = card.data("item");
      if (!item) return;
      
      // Update from inputs
      item.name = card.find(".uie-stage-name").val();
      item.description = card.find(".uie-stage-desc").val();
      
      const s = getSettings();
      ensureModel(s);
      
      if (item.kind === "skill") {
          if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
          s.inventory.skills.push(item);
      } else if (item.kind === "asset") {
          if (!Array.isArray(s.inventory.assets)) s.inventory.assets = [];
          s.inventory.assets.push(item);
      } else {
          if (!Array.isArray(s.inventory.items)) s.inventory.items = [];
          s.inventory.items.push(item);
      }
      
      saveSettings();
      notify("success", `Added: ${item.name}`, "Creation");
      
      card.fadeOut(200, function() { 
          $(this).remove(); 
          if ($("#uie-create-staging").children().length === 0) $("#uie-create-staging").hide();
      });
      
      try { (async () => {
         if (item.kind === "item") (await import("./features/items.js")).render?.();
         if (item.kind === "skill") (await import("./features/skills.js")).init?.();
         if (item.kind === "asset") (await import("./features/assets.js")).init?.();
      })(); } catch(_) {}
  });

  $(document).off("click.stageDiscard", ".uie-stage-discard").on("click.stageDiscard", ".uie-stage-discard", function(e) {
      e.preventDefault();
      const uid = $(this).data("uid");
      $(`#stage-${uid}`).fadeOut(200, function() { 
          $(this).remove();
          if ($("#uie-create-staging").children().length === 0) $("#uie-create-staging").hide();
      });
  });

  $(document).off("click.stageRegen", ".uie-stage-regen").on("click.stageRegen", ".uie-stage-regen", function(e) {
      e.preventDefault();
      const uid = $(this).data("uid");
      const card = $(`#stage-${uid}`);
      const item = card.data("item");
      const imgBox = card.find(".uie-stage-img-box");
      
      item.name = card.find(".uie-stage-name").val();
      item.description = card.find(".uie-stage-desc").val();
      
      imgBox.html('<i class="fa-solid fa-spinner fa-spin" style="color:#f1c40f;"></i>');
      generateImageAPI(`[UIE_LOCKED] Fantasy RPG icon/illustration for ${item.kind}: ${item.name}. ${item.description}`).then(url => {
            if (url) {
                item.img = url;
                imgBox.html(`<img src="${url}" style="width:100%;height:100%;object-fit:cover;">`);
            } else {
                imgBox.html('<i class="fa-solid fa-triangle-exclamation" style="color:#e74c3c;" title="Gen Failed"></i>');
            }
      });
  });

  $(document)
    .off("click.uieCreateQuickAdd", "#uie-create-add-currency, #uie-create-add-xp")
    .on("click.uieCreateQuickAdd", "#uie-create-add-currency, #uie-create-add-xp", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const s2 = getSettings();
      ensureModel(s2);
      ensureInventoryUi(s2);

      const sym = String(s2.currencySymbol || "G");
      const isCur = this && this.id === "uie-create-add-currency";
      const inputId = isCur ? "#uie-create-money" : "#uie-create-xp";
      const raw = String($(inputId).val() || "").trim();
      const amt = Math.max(0, Math.round(Number(raw || 0)));
      if (!amt) return;

      if (isCur) {
        s2.currency = Math.max(0, Number(s2.currency || 0) + amt);
        let curItem = s2.inventory.items.find(it => String(it?.type || "").toLowerCase() === "currency" && String(it?.symbol || "") === sym);
        if (!curItem) {
          curItem = { kind: "item", name: `${sym} Currency`, type: "currency", symbol: sym, description: `Currency item for ${sym}.`, rarity: "common", qty: Number(s2.currency || 0), mods: {}, statusEffects: [] };
          s2.inventory.items.push(curItem);
        } else {
          curItem.qty = Number(s2.currency || 0);
        }
        notify("success", `+ ${amt} ${sym}`, "Currency", "currency");
        $(inputId).val("");
      } else {
        s2.xp = Number(s2.xp || 0) + amt;
        applyLevelingProgress(s2);
        notify("success", `+ ${amt} XP`, "XP", "xp");
        $(inputId).val("");
      }
      saveSettings();
      updateVitals();
      try { import("./features/items.js").then(mod => { if (mod?.render) mod.render(); }); } catch (_) {}
    });

  $(document)
    .off("click.uieInvFullscreen", "#uie-inv-fullscreen-toggle")
    .on("click.uieInvFullscreen", "#uie-inv-fullscreen-toggle", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const next = !(root.dataset.fullscreen === "true");
      s.inventoryDesktopFullscreen = next;
      saveSettings();
      setFullscreen(next);
    });

  $(document)
    .off("click.uieInvGear", "#uie-inv-gear")
    .on("click.uieInvGear", "#uie-inv-gear", function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleFloatingMenu("uie-inv-gear-menu", "uie-inv-gear");
      applyInventoryUi();
    });

  $(document)
    .off("click.uieInvAvatarPick", "#uie-inventory-window .uie-inv-avatar")
    .on("click.uieInvAvatarPick", "#uie-inventory-window .uie-inv-avatar", async function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      await handlePickFor("avatar");
    });

  $(document)
    .off("click.uieInvPortraitPick", "#uie-inv-portrait")
    .on("click.uieInvPortraitPick", "#uie-inv-portrait", async function (e) {
      if (!isEditMode()) return;
      e.preventDefault();
      e.stopPropagation();
      await handlePickFor("portrait");
    });

  $(document)
    .off("click.uieInvEditorClose", "#uie-inv-editor-close")
    .on("click.uieInvEditorClose", "#uie-inv-editor-close", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeEditor();
    });

  $(document)
    .off("click.uieInvEditorPick", "#uie-inv-edit-pickimg")
    .on("click.uieInvEditorPick", "#uie-inv-edit-pickimg", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await handlePickFor("item");
    });

  $(document)
    .off("click.uieInvEditorSave", "#uie-inv-edit-save")
    .on("click.uieInvEditorSave", "#uie-inv-edit-save", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const s2 = getSettings();
      ensureModel(s2);
      const idx = Number(editorItemIndex);
      const item = s2.inventory.items[idx];
      if (!item) return;

      item.name = String($("#uie-inv-edit-name").val() || "");
      item.type = String($("#uie-inv-edit-type").val() || "");
      item.description = String($("#uie-inv-edit-desc").val() || "");

      item.mods = {
        str: Number($("#uie-inv-edit-str").val() || 0),
        dex: Number($("#uie-inv-edit-dex").val() || 0),
        int: Number($("#uie-inv-edit-int").val() || 0),
        vit: Number($("#uie-inv-edit-vit").val() || 0),
        luk: Number($("#uie-inv-edit-luk").val() || 0),
        cha: Number($("#uie-inv-edit-cha").val() || 0),
      };

      const statusStr = String($("#uie-inv-edit-status").val() || "");
      item.statusEffects = statusStr
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

      saveSettings();
      closeEditor();

      import("./features/items.js").then((mod) => {
        if (mod && typeof mod.render === "function") mod.render();
      });
    });

  setEditMode(false);
  updateVitals();

  const initial = root.querySelector("#tabs [data-tab].active");
  const initialTab = initial ? String(initial.dataset.tab || "items") : "items";
  root.setAttribute("data-active-tab", initialTab);
  showView(routes[initialTab]?.view || "#uie-view-items");
  ensureRouteLoaded(routes[initialTab] || routes.items);
  applyInventoryUi();
  setTimeout(() => {
    const pane = document.querySelector("#uie-view-items");
    if (pane && pane.children.length === 0) renderFallbackItemsGrid();
  }, 250);

  // Auto-Scan Observer
  const chat = document.querySelector("#chat");
  if (chat && !window.UIE_lootObserver) {
      window.UIE_lootObserver = new MutationObserver(() => {
          if (window.UIE_scanDebounce) clearTimeout(window.UIE_scanDebounce);
          window.UIE_scanDebounce = setTimeout(() => scanLootAndStatus(), 2500);
      });
      window.UIE_lootObserver.observe(chat, { childList: true, subtree: true });
  }
}

function fxIconClass(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t) return "fa-circle-dot";
  if (/(tired|fatigue|exhaust|sleepy|drowsy)/.test(t)) return "fa-bed";
  if (/(hungry|starving|famished)/.test(t)) return "fa-utensils";
  if (/(thirst|dehydrat)/.test(t)) return "fa-droplet";
  if (/(poison|toxic|venom)/.test(t)) return "fa-skull-crossbones";
  if (/(bleed|hemorr)/.test(t)) return "fa-kit-medical";
  if (/(injur|wound|hurt|fractur)/.test(t)) return "fa-bandage";
  if (/(sick|ill|fever|nausea|dizzy|flu)/.test(t)) return "fa-viruses";
  if (/(infect|zombie|plague)/.test(t)) return "fa-biohazard";
  if (/(smell|smelly|stink|odor|stinky|reek)/.test(t)) return "fa-wind";
  if (/(drunk|intoxic|hungover)/.test(t)) return "fa-wine-bottle";
  if (/(burn|burning|on fire)/.test(t)) return "fa-fire";
  if (/(cold|frozen|hypotherm|chill)/.test(t)) return "fa-snowflake";
  if (/(wet|drench|soaked)/.test(t)) return "fa-water";
  if (/(stress|anxious|panic)/.test(t)) return "fa-brain";
  if (/(curs|hex)/.test(t)) return "fa-skull";
  if (/(shield|guard|ward)/.test(t)) return "fa-shield";
  if (/(invis|hidden|stealth)/.test(t)) return "fa-eye-slash";
  if (/(grade|gpa|exam|failing|school)/.test(t)) return "fa-graduation-cap";
  if (/(crumbl|collapse|broken|ruin)/.test(t)) return "fa-house-crack";
  return "fa-circle-dot";
}

function fxFindRelatedTracker(s, raw) {
  const name = String(raw || "").trim().toLowerCase();
  const trackers = Array.isArray(s?.life?.trackers) ? s.life.trackers : [];
  if (!name || !trackers.length) return null;
  const synonyms = [
    { re: /(tired|fatigue|exhaust|sleepy)/, keys: ["fatigue", "energy", "stamina", "sleep"] },
    { re: /(smell|smelly|stink|odor|reek)/, keys: ["hygiene", "clean", "odor", "smell"] },
    { re: /(crumbl|collapse|broken|ruin)/, keys: ["integrity", "condition", "structure", "base", "durability"] },
    { re: /(grade|gpa|exam|failing|school)/, keys: ["grade", "gpa", "school", "study"] },
    { re: /(hunger|hungry|starving)/, keys: ["hunger", "food"] },
    { re: /(thirst|dehydrat)/, keys: ["thirst", "water"] },
  ];
  const hinted = synonyms.find(x => x.re.test(name));
  const tokens = hinted ? hinted.keys : name.split(/[^a-z0-9]+/g).filter(Boolean).slice(0, 6);
  if (!tokens.length) return null;

  let best = null;
  let bestScore = 0;
  for (const tr of trackers) {
    const tn = String(tr?.name || "").trim().toLowerCase();
    if (!tn) continue;
    let score = 0;
    for (const tok of tokens) {
      if (!tok) continue;
      if (tn === tok) score += 4;
      else if (tn.includes(tok)) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = tr; }
  }
  return bestScore ? best : null;
}

function fxRenderPopover(anchorRect, fx, tracker, editable = false) {
  let box = document.getElementById("uie-inv-fx-pop");
  if (!box) {
    box = document.createElement("div");
    box.id = "uie-inv-fx-pop";
    box.style.cssText = "position:fixed;z-index:2147483656;max-width:min(360px,92vw);padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,10,8,0.96);color:#fff;font-weight:900;box-sizing:border-box;";
    document.body.appendChild(box);
    box.addEventListener("click", () => { try { box.remove(); } catch (_) {} });
  }
  box.innerHTML = "";
  const name = statusName(fx);
  const head = document.createElement("div");
  head.style.cssText = "display:flex;gap:10px;align-items:center;margin-bottom:10px;";
  const ico = document.createElement("i");
  ico.className = `fa-solid ${fxIconClass(name)}`;
  ico.style.cssText = "width:18px;text-align:center;opacity:0.95;";
  const ttl = document.createElement("div");
  ttl.textContent = String(name || "");
  ttl.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  head.appendChild(ico);
  head.appendChild(ttl);
  if (editable) {
    const del = document.createElement("button");
    del.textContent = "Remove";
    del.style.cssText = "flex:0 0 auto;height:30px;padding:0 10px;border-radius:10px;border:1px solid rgba(243,139,168,0.35);background:rgba(0,0,0,0.25);color:#f38ba8;font-weight:900;cursor:pointer;";
    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { deleteStatusById(String(fx?.id || "")); } catch (_) {}
      try { box.remove(); } catch (_) {}
    });
    head.appendChild(del);
  }
  box.appendChild(head);

  const rem = formatRemaining(fx?.expiresAt);
  if (rem) {
    const meta = document.createElement("div");
    meta.textContent = rem === "expired" ? "Expired" : `Time left: ${rem}`;
    meta.style.cssText = "opacity:0.75;font-size:12px;letter-spacing:0.2px;margin-bottom:8px;";
    box.appendChild(meta);
  }

  const desc = String(fx?.desc || "").trim();
  if (desc) {
    const d = document.createElement("div");
    d.textContent = desc;
    d.style.cssText = "opacity:0.88;font-size:12px;line-height:1.4;margin-bottom:10px;white-space:pre-wrap;font-weight:800;";
    box.appendChild(d);
  }

  const mods = summarizeMods(fx?.mods);
  if (mods.length) {
    const m = document.createElement("div");
    m.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;";
    for (const it of mods.slice(0, 12)) {
      const chip = document.createElement("div");
      chip.textContent = it;
      chip.style.cssText = "padding:5px 8px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.22);font-size:11px;font-weight:900;opacity:0.92;";
      m.appendChild(chip);
    }
    box.appendChild(m);
  }

  if (tracker && typeof tracker === "object") {
    const tname = String(tracker?.name || "Tracker");
    const cur = Number(tracker?.current ?? 0);
    const max = Math.max(1, Number(tracker?.max ?? 100));
    const color = String(tracker?.color || "#89b4fa");
    const pct = Math.max(0, Math.min(100, (cur / max) * 100));

    const meta = document.createElement("div");
    meta.textContent = `${tname}: ${cur}/${max}`;
    meta.style.cssText = "opacity:0.78;font-size:12px;letter-spacing:0.2px;margin-bottom:8px;";
    box.appendChild(meta);

    const bar = document.createElement("div");
    bar.style.cssText = "position:relative;height:14px;border-radius:7px;border:1px solid rgba(255,255,255,0.10);background:rgba(0,0,0,0.30);overflow:hidden;";
    const fill = document.createElement("div");
    fill.style.cssText = `height:100%;width:${pct}%;background:${color};`;
    const txt = document.createElement("div");
    txt.textContent = `${cur}/${max}`;
    txt.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;color:rgba(255,255,255,0.92);text-shadow:0 1px 2px rgba(0,0,0,0.7);";
    bar.appendChild(fill);
    bar.appendChild(txt);
    box.appendChild(bar);
  }

  box.style.left = "0px";
  box.style.top = "0px";
  box.style.transform = "none";
  const pad = 8;
  const br = box.getBoundingClientRect();
  let left = (anchorRect.left + anchorRect.right) / 2 - br.width / 2;
  left = Math.max(pad, Math.min(window.innerWidth - br.width - pad, left));
  let top = anchorRect.bottom + 8;
  if (top + br.height + pad > window.innerHeight) top = anchorRect.top - br.height - 8;
  top = Math.max(pad, Math.min(window.innerHeight - br.height - pad, top));
  box.style.left = `${Math.round(left)}px`;
  box.style.top = `${Math.round(top)}px`;
}

export function updateVitals() {
  const s = getSettings();
  ensureModel(s);
  ensureInventoryUi(s);
  const leveled = applyLevelingProgress(s);
  if (leveled) saveSettings();

  const root = getRoot();
  if (!root) return;

  try {
    const ctx = getContext?.();
    const personaName = String(ctx?.name1 || "").trim();
    if (personaName && s.character.syncPersona !== false) {
      s.character.name = personaName;
    }
  } catch (_) {}

  if (!s.character) s.character = {};
  if (!s.character.name) s.character.name = "User";
  if (!s.character.className && s.character.class) s.character.className = s.character.class;
  if (!s.character.className) s.character.className = "Adventurer";
  if (!Number.isFinite(Number(s.character.level))) s.character.level = 1;

  const now = Date.now();
  const fxAll = normalizeStatusList(s.character.statusEffects, now);
  const fx = fxAll.filter(f => !(f?.expiresAt && Number(f.expiresAt) <= now));
  let fxChanged = false;
  if (fx.length !== fxAll.length) fxChanged = true;
  if (fxAll.length !== (Array.isArray(s.character.statusEffects) ? s.character.statusEffects.length : 0)) fxChanged = true;
  if (!fxChanged) {
    const curK = (Array.isArray(s.character.statusEffects) ? s.character.statusEffects : []).map(x => statusKey(x)).join("|");
    const nextK = fx.map(x => statusKey(x)).join("|");
    if (curK !== nextK) fxChanged = true;
  }
  const ticked = applyStatusTickToVitals(s, fx, now);
  const totals = computeStatusTotals(fx);

  const effMaxHp = Math.max(0, Number(s.maxHp || 0) + Number(totals.maxHp || 0));
  const effMaxMp = Math.max(0, Number(s.maxMp || 0) + Number(totals.maxMp || 0));
  const effMaxAp = Math.max(0, Number(s.maxAp || 0) + Number(totals.maxAp || 0));
  const effMaxXp = Math.max(0, Number(s.maxXp || 0) + Number(totals.maxXp || 0));

  const clampBar = (curKey, maxVal) => {
    const cur = Number(s[curKey] || 0);
    const next = Math.max(0, Math.min(maxVal || 0, cur));
    if (next !== cur) s[curKey] = next;
  };
  clampBar("hp", effMaxHp);
  clampBar("mp", effMaxMp);
  clampBar("ap", effMaxAp);
  clampBar("xp", effMaxXp);

  if (fxChanged) s.character.statusEffects = fx;
  if (fxChanged || ticked) saveSettings();

  const stats = [
    { key: "hp", cur: s.hp, max: effMaxHp },
    { key: "mp", cur: s.mp, max: effMaxMp },
    { key: "ap", cur: s.ap, max: effMaxAp },
    { key: "xp", cur: s.xp, max: effMaxXp },
  ];

  for (const st of stats) {
    const els = Array.from(root.querySelectorAll(`#bottom-stats .stat[data-stat="${st.key}"]`));
    if (!els.length) continue;
    els.forEach((el) => {
      const fill = el.querySelector(".fill");
      const v = el.querySelector(".v");
      if (fill) fill.style.width = `${pct(st.cur, st.max)}%`;
      if (v) v.textContent = `${Number(st.cur || 0)}/${Number(st.max || 0)}`;
    });
  }

  const currencyEl = root.querySelector(".uie-inv-currency");
  if (currencyEl) currencyEl.textContent = `${Number(s.currency || 0)} ${String(s.currencySymbol || "G")}`;

  const nameEl = root.querySelector(".uie-inv-title .name");
  if (nameEl) nameEl.textContent = String(s.character.name || "User");
  const metaEl = root.querySelector(".uie-inv-title .meta");
  if (metaEl) metaEl.textContent = `${String(s.character.className || "Adventurer")} · Lv ${Number(s.character.level || 1)}`;
  const classLine = root.querySelector("#uie-inv-classline");
  if (classLine) classLine.textContent = String(s.character.className || "Adventurer");

  const mobileName = root.querySelector("#uie-inv-mobile-name");
  if (mobileName) mobileName.textContent = String(s.character.name || "User");
  const mobileMeta = root.querySelector("#uie-inv-mobile-meta");
  if (mobileMeta) mobileMeta.textContent = `Lv ${Number(s.character.level || 1)}`;

  const avatar = root.querySelector(".uie-inv-avatar");
  if (avatar && s.character.avatar) {
    avatar.style.backgroundImage = `url("${s.character.avatar}")`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
  }

  const portraitImg = root.querySelector("#uie-inv-portrait-img");
  if (portraitImg) {
    if (s.character.portrait) {
      portraitImg.src = s.character.portrait;
      portraitImg.style.display = "block";
    } else {
      portraitImg.removeAttribute("src");
      portraitImg.style.display = "none";
    }
  }

  const strip = root.querySelector("#uie-inv-status-strip");
  if (strip) {
    strip.innerHTML = "";
    strip.style.display = fx.length ? "flex" : "none";
    if (fx.length) {
      fx.slice(0, 12).forEach((fxObj) => {
        const raw = String(statusName(fxObj) || "").trim().slice(0, 120);
        const el = document.createElement("div");
        el.className = "inv-fx";
        el.title = raw;
        const i = document.createElement("i");
        i.className = `fa-solid ${fxIconClass(raw)}`;
        el.appendChild(i);
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const rect = el.getBoundingClientRect();
          const tracker = fxFindRelatedTracker(s, raw);
          if (isEditMode()) {
            try { openStatusManager(String(fxObj?.id || "")); } catch (_) {}
            return;
          }
          fxRenderPopover(rect, fxObj, tracker, false);
        });
        strip.appendChild(el);
      });
    }
  }

  notifyLowHpIfNeeded();
}
