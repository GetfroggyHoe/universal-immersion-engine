
import { getSettings, saveSettings } from "../core.js";
import { notify } from "../notifications.js";

let isEditing = false;

export function initStats() {
    // Bind global events or window specific events
    // Scope to main menu
    $("#uie-main-menu").off("click.uieStats").on("click.uieStats", "#uie-btn-stats", () => {
        isEditing = false; // Reset on open
        renderStats();
    });

    // Bind "+" buttons
    // Scope to stats window
    $("#uie-stats-window").off("click.uieStatUp").on("click.uieStatUp", ".uie-stat-up-btn", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const stat = $(this).data("stat");
        upgradeStat(stat);
    });

    // Bind Edit Toggle
    $("#uie-stats-window").off("click.uieStatEdit").on("click.uieStatEdit", "#uie-stats-edit-toggle", function(e) {
        e.preventDefault();
        e.stopPropagation();
        isEditing = !isEditing;
        $(this).css("color", isEditing ? "#cba35c" : "");
        renderStats();
    });

    // Bind Input Changes
    $("#uie-stats-window").off("change.uieStatInput").on("change.uieStatInput", ".uie-stat-input", function(e) {
        const key = $(this).data("key");
        const type = $(this).data("type"); // 'root', 'char', 'stat'
        let val = $(this).val();

        const s = getSettings();
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};

        // Parse number if needed
        if ($(this).attr("type") === "number") val = Number(val);

        if (type === "root") {
            s[key] = val;
            // Keep legacy inventory.vitals in sync (some installs still rely on it)
            if (!s.inventory) s.inventory = {};
            if (!s.inventory.vitals) s.inventory.vitals = {};
            if (key === "hp") s.inventory.vitals.hp = Number(val) || 0;
            if (key === "maxHp") s.inventory.vitals.maxHp = Number(val) || 0;
            if (key === "mp") s.inventory.vitals.mp = Number(val) || 0;
            if (key === "maxMp") s.inventory.vitals.maxMp = Number(val) || 0;
            // Inventory uses AP naming internally; older settings use SP
            if (key === "ap") s.inventory.vitals.sp = Number(val) || 0;
            if (key === "maxAp") s.inventory.vitals.maxSp = Number(val) || 0;
            if (key === "xp") s.inventory.vitals.xp = Number(val) || 0;
        } else if (type === "char") {
            s.character[key] = val;
        } else if (type === "stat") {
            s.character.stats[key] = val;
        } else if (type === "label") {
            if (!s.statLabels) s.statLabels = {};
            s.statLabels[key] = String(val || "");
        } else if (type === "vitalLabel") {
            if (!s.vitalLabels) s.vitalLabels = {};
            s.vitalLabels[key] = String(val || "");
        }

        saveSettings();
        // If vitals changed, refresh inventory bars immediately
        if (type === "root" && ["hp", "maxHp", "mp", "maxMp", "ap", "maxAp", "xp", "maxXp"].includes(String(key))) {
            import("../inventory.js").then(mod => {
                if (mod && mod.updateVitals) mod.updateVitals();
            });
        }
        // Don't re-render immediately to avoid losing focus, unless needed?
        // Actually, re-rendering might be safer to sync UI states, but input focus is tricky.
        // Let's just update the setting silently.
    });

    // Bind refresh/render on window show
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const target = mutation.target;
          if (target.style.display !== 'none') {
            renderStats();
          }
        }
      });
    });

    const win = document.getElementById("uie-stats-window");
    if (win) observer.observe(win, { attributes: true });
}

export function renderStats() {
    const s = getSettings();
    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};

    const vit = s.inventory?.vitals && typeof s.inventory.vitals === "object" ? s.inventory.vitals : {};
    const hp = Number.isFinite(Number(s.hp)) ? Number(s.hp) : Number(vit.hp || 0);
    const maxHp = Number.isFinite(Number(s.maxHp)) ? Number(s.maxHp) : Number(vit.maxHp || 0);
    const mp = Number.isFinite(Number(s.mp)) ? Number(s.mp) : Number(vit.mp || 0);
    const maxMp = Number.isFinite(Number(s.maxMp)) ? Number(s.maxMp) : Number(vit.maxMp || 0);
    const ap = Number.isFinite(Number(s.ap)) ? Number(s.ap) : Number(vit.sp || 0);
    const maxAp = Number.isFinite(Number(s.maxAp)) ? Number(s.maxAp) : Number(vit.maxSp || 0);
    const xp = Number.isFinite(Number(s.xp)) ? Number(s.xp) : Number(vit.xp || 0);
    const maxXp = Number.isFinite(Number(s.maxXp)) ? Number(s.maxXp) : Number(s.maxXp || 0);

    const vitLabels = s.vitalLabels && typeof s.vitalLabels === "object" ? s.vitalLabels : {};
    const labelHp = String(vitLabels.hp || "Health");
    const labelMp = String(vitLabels.mp || "Mana");
    const labelAp = String(vitLabels.ap || "Stamina");
    const labelXp = String(vitLabels.xp || "Experience");

    // Check if elements exist
    if ($("#uie-stats-list").length === 0) {
        console.warn("[UIE] Stats window elements missing. Template not loaded?");
        return;
    }

    // 1. Portrait & Basic Info
    const name = s.character.name || "Unknown";
    const cls = s.character.className || "Adventurer";
    const lvl = s.character.level || 1;
    const pts = s.character.statPoints || 0;
    const portrait = s.character.portrait || s.character.avatar || "";

    if (isEditing) {
        $("#uie-stats-name").html(`<input type="text" class="uie-stat-input" data-key="name" data-type="char" value="${name}" style="background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:center; width:100%;">`);
        $("#uie-stats-class").html(`
            <input type="text" class="uie-stat-input" data-key="className" data-type="char" value="${cls}" style="background:rgba(0,0,0,0.5); border:1px solid #555; color:#cba35c; text-align:center; width:120px;">
            Lv. <input type="number" class="uie-stat-input" data-key="level" data-type="char" value="${lvl}" style="background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:center; width:50px;">
        `);
    } else {
        $("#uie-stats-name").text(name);
        // Make Class clickable to toggle edit mode as a hint
        $("#uie-stats-class").html(`<span style="cursor:pointer; border-bottom:1px dashed #666;" title="Click 'Edit' icon (pencil) to change class">${cls} - Lv. ${lvl}</span>`);
        $("#uie-stats-class").off("click").on("click", () => {
             // Flash the edit button to show user where it is
             const btn = $("#uie-stats-edit-toggle");
             btn.css("transition", "color 0.2s").css("color", "#fff");
             setTimeout(() => btn.css("color", ""), 200);
             setTimeout(() => btn.css("color", "#fff"), 400);
             setTimeout(() => btn.css("color", ""), 600);
             if(window.toastr) toastr.info("Click the Pencil icon to edit stats & class.", "Tip");
        });
    }

    if (portrait) {
        $("#uie-stats-portrait").attr("src", portrait).show();
        $("#uie-stats-portrait-fallback").hide();
    } else {
        $("#uie-stats-portrait").hide();
        $("#uie-stats-portrait-fallback").show();
    }

    const ptsEl = $("#uie-stats-points");
    // Always show the container but change text
    if (isEditing) {
        ptsEl.addClass("uie-char-points").html(`Points: <input type="number" class="uie-stat-input" data-key="statPoints" data-type="char" value="${pts}" style="background:rgba(0,0,0,0.5); border:none; color:#2ecc71; width:40px;">`);
    } else if (pts > 0) {
        ptsEl.addClass("uie-char-points").text(`Points: ${pts}`);
    } else {
        ptsEl.removeClass("uie-char-points").text("");
    }

    // Reset Button
    $("#uie-stats-reset-btn").show().off("click").on("click", resetStats);

    // 2. Attributes
    const statsList = $("#uie-stats-list");
    statsList.empty();

    // Settings has: str, dex, con, int, wis, cha, per, luk, agi, vit, end, spi
    const keys = ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"];
    const STAT_DEFAULTS = {
        str: "Strength", dex: "Dexterity", con: "Constitution",
        int: "Intelligence", wis: "Wisdom", cha: "Charisma",
        per: "Perception", luk: "Luck", agi: "Agility",
        vit: "Vitality", end: "Endurance", spi: "Spirit"
    };
    const labels = s.statLabels || {};

    keys.forEach(key => {
        const val = s.character.stats[key] || 0;
        const defaultLabel = STAT_DEFAULTS[key] || key.toUpperCase();
        const label = labels[key] || defaultLabel;

        let btnHtml = "";
        let labelHtml = "";

        if (isEditing) {
            btnHtml = `<input type="number" class="uie-stat-input" data-key="${key}" data-type="stat" value="${val}" style="width:50px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:center;">`;
            labelHtml = `<input type="text" class="uie-stat-input" data-key="${key}" data-type="label" value="${label}" style="width:80px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#cba35c; font-size:0.8em;">`;
        } else {
            btnHtml = `<div class="uie-stat-val">${val}</div>`;
            if (pts > 0) {
                btnHtml += `<div class="uie-stat-up-btn" data-stat="${key}">+</div>`;
            }
            labelHtml = `<div class="uie-stat-label">${label}</div>`;
        }

        const html = `
            <div class="uie-stat-card">
                ${labelHtml}
                <div style="display:flex; align-items:center;">
                    ${btnHtml}
                </div>
            </div>
        `;
        statsList.append(html);
    });

    // 3. Vitals (Bars)
    const vitalsEl = $("#uie-stats-vitals");
    vitalsEl.empty();

    const renderBar = (label, cur, max, type, keyCur, keyMax, keyLabel) => {
        if (isEditing) {
            return `
                <div class="uie-bar-container" style="background:rgba(0,0,0,0.3); padding:5px; border-radius:6px;">
                    <div class="uie-bar-labels" style="align-items:center;">
                        <input type="text" class="uie-stat-input" data-key="${keyLabel}" data-type="vitalLabel" value="${String(label || "")}" style="width:120px; background:rgba(0,0,0,0.35); border:1px solid #555; color:#ddd; border-radius:6px; padding:2px 6px;">
                        <div style="display:flex; gap:5px; align-items:center;">
                            <input type="number" class="uie-stat-input" data-key="${keyCur}" data-type="root" value="${cur||0}" style="width:60px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:right;">
                            /
                            <input type="number" class="uie-stat-input" data-key="${keyMax}" data-type="root" value="${max||0}" style="width:60px; background:rgba(0,0,0,0.5); border:1px solid #555; color:#fff; text-align:right;">
                        </div>
                    </div>
                </div>
            `;
        } else {
            const c = Math.round(cur || 0);
            const m = Math.round(max || 0);
            const pct = m > 0 ? Math.max(0, Math.min(100, (c / m) * 100)) : 0;
            return `
                <div class="uie-bar-container">
                    <div class="uie-bar-labels">
                        <span>${label}</span>
                        <span>${c} / ${m}</span>
                    </div>
                    <div class="uie-bar-track">
                        <div class="uie-bar-fill uie-bar-${type}" style="width:${pct}%;"></div>
                    </div>
                </div>
            `;
        }
    };

    vitalsEl.append(renderBar(labelHp, hp, maxHp, "hp", "hp", "maxHp", "hp"));
    vitalsEl.append(renderBar(labelMp, mp, maxMp, "mp", "mp", "maxMp", "mp"));
    vitalsEl.append(renderBar(labelAp, ap, maxAp, "ap", "ap", "maxAp", "ap"));
    vitalsEl.append(renderBar(labelXp, xp, maxXp, "xp", "xp", "maxXp", "xp"));
}

function resetStats() {
    if (!confirm("Reset all stats to 10 and refund points?")) return;
    const s = getSettings();
    const keys = ["str", "dex", "con", "int", "wis", "cha", "per", "luk", "agi", "vit", "end", "spi"];

    let refunded = 0;
    keys.forEach(k => {
        const val = s.character.stats[k] || 0;
        if (val > 10) {
            refunded += (val - 10);
            s.character.stats[k] = 10;
        }
    });

    s.character.statPoints = (s.character.statPoints || 0) + refunded;
    saveSettings();
    renderStats();
    import("../inventory.js").then(mod => {
        if (mod && mod.updateVitals) mod.updateVitals();
    });
    notify("success", `Reset complete. Refunded ${refunded} points.`, "Stats");
    injectRpEvent(`[System: Stats reset. Refunded ${refunded} points.]`);
}

function upgradeStat(key) {
    const s = getSettings();
    if (!s.character.statPoints || s.character.statPoints <= 0) return;

    if (!s.character.stats) s.character.stats = {};
    s.character.stats[key] = (s.character.stats[key] || 0) + 1;
    s.character.statPoints--;

    saveSettings();
    renderStats();
    import("../inventory.js").then(mod => {
        if (mod && mod.updateVitals) mod.updateVitals();
    });
    notify("success", `Upgraded ${key.toUpperCase()}`, "Stats");
}
