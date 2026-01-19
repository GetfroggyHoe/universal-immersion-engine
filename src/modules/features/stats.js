import { getSettings, saveSettings, updateLayout } from "../core.js";
import { notify } from "../notifications.js";

// Rebirth Medallions (Moved from Inventory)
export const MEDALLIONS = {
    "medallion_water": { id: "medallion_water", name: "Medallion of the Coiled Tide", desc: "Best for: Speed, Evasion, Mana/Stamina regen.\n[Rank: Rebirth Artifact]", img: "https://user.uploads.dev/file/644e59a3cff1ce40adec12bf35844d0e.png" },
    "medallion_earth": { id: "medallion_earth", name: "Sigil of the Bedrock", desc: "Best for: Tanking, Invulnerability, Brute Force.\n[Rank: Rebirth Artifact]", img: "https://user.uploads.dev/file/f2fb37a01abb09790e7936951d2acdbf.png" },
    "medallion_air": { id: "medallion_air", name: "Crest of the Gale", desc: "Best for: Critical Hits, Speed, Vertical Movement.\n[Rank: Rebirth Artifact]", img: "https://user.uploads.dev/file/2fbfff08474c64ae7fd2c83b44be381c.png" },
    "medallion_fire": { id: "medallion_fire", name: "The Warlord’s Brand", desc: "Best for: High Damage, Intimidation, High Risk.\n[Rank: Rebirth Artifact]", img: "https://user.uploads.dev/file/87ab6c663ec4bd5bffed62d8790bd6f0.png" },
    "medallion_rebel": { id: "medallion_rebel", name: "Mark of the Usurper", desc: "Best for: Chaos, Minions, Unrestricted Gear.\n[Rank: Rebirth Artifact]", img: "https://user.uploads.dev/file/77fa500b1551e8d07a2b1f3bc8cb4471.png" }
};

function render() {
    const s = getSettings();
    if (!s) return;
    
    // Ensure structure
    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};
    if (!s.character.name) s.character.name = "Unknown";
    
    // Background
    const bgUrl = s.ui?.backgrounds?.stats || "";
    const win = $("#uie-stats-window");
    if (bgUrl) {
        win.css({
            "background-image": `url("${bgUrl}")`,
            "background-size": "cover",
            "background-position": "center"
        });
    } else {
        win.css("background-image", "");
    }

    // Name & Class & Level
    $("#uie-stats-name").text(s.character.name);
    $("#uie-stats-class").text(`${s.character.className || "Classless"} (Lv. ${s.character.level || 1})`);

    // Attributes (12 standard)
    const stats = s.character.stats;
    const $list = $("#uie-stats-list");
    $list.empty();

    const labels = {
        str: "Strength", dex: "Dexterity", con: "Constitution", 
        int: "Intelligence", wis: "Wisdom", cha: "Charisma",
        per: "Perception", luk: "Luck", agi: "Agility", 
        vit: "Vitality", end: "Endurance", spi: "Spirit"
    };
    
    // Ensure all 12 exist in display even if missing in data
    const keys = Object.keys(labels);
    
    let gridHtml = `<div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">`;
    
    for (const key of keys) {
        const label = labels[key];
        const val = stats[key] || 0;
        gridHtml += `
            <div style="background:rgba(0,0,0,0.4); padding:8px; border-radius:6px; display:flex; justify-content:space-between; align-items:center; border:1px solid rgba(255,255,255,0.05);">
                <span style="opacity:0.8; font-size:0.85em; font-weight:bold;">${label}</span>
                <span style="font-weight:bold; color:#e2c08d;">${val}</span>
            </div>
        `;
    }
    gridHtml += `</div>`;
    $list.html(gridHtml);

    // Vitals Bars
    const $vitals = $("#uie-stats-vitals");
    $vitals.empty();
    
    const vitals = [
        { l: "HP", c: s.hp, m: s.maxHp, col: "#e74c3c" },
        { l: "MP", c: s.mp, m: s.maxMp, col: "#3498db" },
        { l: "AP", c: s.ap, m: s.maxAp, col: "#2ecc71" },
        { l: "XP", c: s.xp, m: s.maxXp, col: "#f1c40f" }
    ];

    for (const v of vitals) {
        const cur = Number(v.c)||0;
        const max = Number(v.m)||1;
        const pct = Math.max(0, Math.min(100, (cur / max) * 100));
        
        $vitals.append(`
            <div style="margin-bottom:8px;">
                <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom:2px; font-weight:bold; text-shadow:0 1px 2px black;">
                    <span>${v.l}</span>
                    <span>${Math.floor(cur)} / ${Math.floor(max)}</span>
                </div>
                <div style="height:10px; background:rgba(0,0,0,0.5); border-radius:5px; overflow:hidden; border:1px solid rgba(255,255,255,0.1);">
                    <div style="width:${pct}%; height:100%; background:${v.col}; box-shadow: 0 0 10px ${v.col}; transition: width 0.3s ease;"></div>
                </div>
            </div>
        `);
    }
    
    // Rebirth Button (Level 150+)
    const canRebirth = (Number(s.character.level) >= 150 && !s.character.reborn);
    let rebirthBtn = document.getElementById("uie-stats-rebirth-btn");
    
    if (canRebirth) {
        if (!rebirthBtn) {
            $("#uie-stats-content").append(`
                <button id="uie-stats-rebirth-btn" style="width:100%; margin-top:15px; padding:12px; background:linear-gradient(45deg, #f1c40f, #e67e22); color:black; font-weight:900; border:none; border-radius:8px; cursor:pointer; box-shadow:0 0 15px rgba(241,196,15,0.4);">
                    <i class="fa-solid fa-crown"></i> ASCEND (REBIRTH)
                </button>
            `);
        }
    } else {
        if (rebirthBtn) rebirthBtn.remove();
    }
    
    // Controls (Bg Picker)
    if (!document.getElementById("uie-stats-bg-picker")) {
        $("#uie-stats-header").append(`
            <button id="uie-stats-bg-picker" title="Set Background" style="background:transparent; border:none; color:rgba(255,255,255,0.5); cursor:pointer; margin-left:auto;">
                <i class="fa-solid fa-image"></i>
            </button>
        `);
    }
}

function showRebirthModal() {
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
}

function performRebirth(medalId) {
    const s = getSettings();
    if (!s) return;
    
    // Reset Level
    s.character.level = 1;
    s.xp = 0;
    s.maxXp = 1000;
    s.character.reborn = true;
    s.character.activeMedallion = medalId;
    
    // Add Medallion Item
    const def = MEDALLIONS[medalId];
    if (def) {
        if (!s.inventory.items) s.inventory.items = [];
        s.inventory.items.push({
            kind: "item",
            name: def.name,
            type: "Key Item",
            description: def.desc,
            qty: 1,
            rarity: "legendary",
            img: def.img, // Correct property from def
            statusEffects: [], // Medallions usually have passive effects, handled elsewhere or via description
            mods: {}
        });
    }
    
    saveSettings();
    render();
    notify("success", "REBIRTH COMPLETE! You are now a Legend.", "System", "levelUp");
}

function pickBackground() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const data = ev.target.result;
            const s = getSettings();
            if (!s.ui) s.ui = {};
            if (!s.ui.backgrounds) s.ui.backgrounds = {};
            s.ui.backgrounds.stats = data;
            saveSettings();
            render();
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

export function initStats() {
    render();
    // Hook into global update event if it exists, or rely on manual re-renders/polling
    $(document).on("uie:stateUpdated", render); 
    $(document).on("uie:updateVitals", render); // Listen for leveling events from inventory.js
    
    $(document).off("click.uieStatsRebirth").on("click.uieStatsRebirth", "#uie-stats-rebirth-btn", (e) => {
        e.preventDefault();
        showRebirthModal();
    });
    
    $(document).off("click.uieStatsBg").on("click.uieStatsBg", "#uie-stats-bg-picker", (e) => {
        e.preventDefault();
        pickBackground();
    });

    $(document).on("click", "#uie-btn-stats", (e) => {
        e.preventDefault();
        $("#uie-stats-window").show();
        render();
    });
    
    // Also re-render periodically in case of external changes?
    setInterval(render, 2000);
}
