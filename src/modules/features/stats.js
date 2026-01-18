import { getSettings } from "../core.js";

function render() {
    const s = getSettings();
    if (!s) return;
    
    // Name & Class
    $("#uie-stats-name").text(s.character?.name || "Unknown");
    $("#uie-stats-class").text(s.character?.className || "Classless");

    // Attributes
    const stats = s.character?.stats || {};
    const $list = $("#uie-stats-list");
    $list.empty();

    const labels = {
        str: "Strength", dex: "Dexterity", con: "Constitution", 
        int: "Intelligence", wis: "Wisdom", cha: "Charisma",
        per: "Perception", luk: "Luck", agi: "Agility", 
        vit: "Vitality", end: "Endurance", spi: "Spirit"
    };

    for (const [key, val] of Object.entries(stats)) {
        const label = labels[key] || key.toUpperCase();
        $list.append(`
            <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                <span style="opacity:0.8; font-size:0.9em;">${label}</span>
                <span style="font-weight:bold; color:#e2c08d;">${val}</span>
            </div>
        `);
    }

    // Vitals
    const $vitals = $("#uie-stats-vitals");
    $vitals.empty();
    
    const vitals = [
        { l: "HP", c: s.hp, m: s.maxHp, col: "#e74c3c" },
        { l: "MP", c: s.mp, m: s.maxMp, col: "#3498db" },
        { l: "XP", c: s.xp, m: s.maxXp, col: "#f1c40f" },
        { l: "AP", c: s.ap, m: s.maxAp, col: "#2ecc71" }
    ];

    for (const v of vitals) {
        const pct = Math.max(0, Math.min(100, (Number(v.c)||0) / (Number(v.m)||1) * 100));
        $vitals.append(`
            <div>
                <div style="display:flex; justify-content:space-between; font-size:0.85em; margin-bottom:2px;">
                    <span>${v.l}</span>
                    <span>${v.c} / ${v.m}</span>
                </div>
                <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                    <div style="width:${pct}%; height:100%; background:${v.col};"></div>
                </div>
            </div>
        `);
    }
}

export function initStats() {
    render();
    // Hook into global update event if it exists, or rely on manual re-renders/polling
    $(document).on("uie:stateUpdated", render); 
    
    $(document).on("click", "#uie-btn-stats", (e) => {
        e.preventDefault();
        $("#uie-stats-window").show();
        render();
    });
    
    // Also re-render periodically in case of external changes?
    setInterval(render, 2000);
}
