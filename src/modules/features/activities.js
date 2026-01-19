
import { getSettings, saveSettings } from "../core.js";
import { loadFeatureTemplate } from "../featureLoader.js";
import { UnifiedSpine } from "./rp_log.js";
import * as Life from "./life.js";
import * as Skills from "./skills.js";

let interval = null;
let activeTab = "general";

function ensureActivities(s) {
    if (!s.activities) s.activities = { active: [], loops: [] };
}

export async function init() {
    // We assume the HTML structure is already loaded into the window or container
    // But since this is a feature, it might be loaded dynamically.
    // If we are in the inventory context, this init might be called after loading the template.
    
    bindEvents();
    render();
    
    // Start loop
    if (interval) clearInterval(interval);
    interval = setInterval(tick, 1000);
}

export const initActivities = init;

function bindEvents() {
    $(document).off("click.uieActTab").on("click.uieActTab", ".uie-act-tab", async function(e) {
        e.preventDefault();
        const tab = $(this).data("tab");
        switchTab(tab);
    });

    $(document).off("click.uieActStart").on("click.uieActStart", ".uie-act-start-btn", function(e) {
        e.preventDefault();
        const idx = $(this).data("idx");
        const type = $(this).data("type"); // default or custom
        startActivity(idx, type);
    });
    
    $(document).off("click.uieActStop").on("click.uieActStop", "#uie-activity-stop", function(e) {
        e.preventDefault();
        stopActivity();
    });

    $(document).off("click.uieActCreate").on("click.uieActCreate", "#uie-activity-create", function(e) {
        e.preventDefault();
        createCustomActivity();
    });
}

async function switchTab(tab) {
    activeTab = tab;
    $(".uie-act-tab").removeClass("active");
    $(`.uie-act-tab[data-tab="${tab}"]`).addClass("active");
    
    $(".uie-act-pane").hide();
    $(`#uie-act-view-${tab}`).show();
    
    if (tab === "life") {
        const el = document.getElementById("uie-act-view-life");
        if (el && !el.dataset.loaded) {
            const html = await loadFeatureTemplate("life");
            if (html) {
                el.innerHTML = html;
                el.dataset.loaded = "true";
                try { Life.init(); } catch(e) { console.error("Life init failed", e); }
            }
        }
        try { Life.render(); } catch(e) { console.error("Life render failed", e); }
    } else if (tab === "skills") {
        const el = document.getElementById("uie-act-view-skills");
        if (el && !el.dataset.loaded) {
            const html = await loadFeatureTemplate("skills");
            if (html) {
                el.innerHTML = html;
                el.dataset.loaded = "true";
                try { if(Skills.init) Skills.init(); } catch(e) { console.error("Skills init failed", e); }
            }
        }
        try { Skills.render(); } catch(e) { console.error("Skills render failed", e); }
    } else {
        renderGeneral();
    }
}

function render() {
    try {
        if (activeTab === "general") renderGeneral();
        else if (activeTab === "life") Life.render();
        else if (activeTab === "skills") Skills.render();
    } catch(e) { console.error("Render failed", e); }
}

function renderGeneral() {
    const s = getSettings();
    if (!s) return;
    ensureActivities(s);
    
    const $list = $("#uie-activities-list");
    $list.empty();
    
    const defaults = [
        { name: "Training", desc: "Gain XP", duration: 60 },
        { name: "Meditation", desc: "Regenerate MP", duration: 60 },
        { name: "Resting", desc: "Regenerate HP", duration: 120 },
        { name: "Working", desc: "Earn Gold", duration: 300 }
    ];
    
    defaults.forEach((act, idx) => {
        $list.append(renderActivityCard(act, idx, "default"));
    });
    
    const customs = s.activities.loops || [];
    customs.forEach((act, idx) => {
        $list.append(renderActivityCard(act, idx, "custom"));
    });
    
    updateCurrentStatus(s);
}

function renderActivityCard(act, idx, type) {
    return `
        <div class="uie-activity-card" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
            <div>
                <div style="font-weight:bold;">${act.name}</div>
                <div style="font-size:0.8em; opacity:0.7;">${act.desc || ""} (${act.duration}s)</div>
            </div>
            <button class="uie-act-start-btn" data-idx="${idx}" data-type="${type}" style="background:rgba(255,255,255,0.1); border:none; padding:4px 8px; border-radius:4px; color:white; cursor:pointer;">Start</button>
        </div>
    `;
}

function updateCurrentStatus(s) {
    const current = s.activities.active?.[0];
    if (current) {
        $("#uie-activity-current-display").text(current.name);
        $("#uie-activity-stop").show();
        
        const elapsed = (Date.now() - current.startTime) / 1000;
        const duration = Number(current.duration) || 60;
        const pct = Math.min(100, (elapsed / duration) * 100);
        
        $("#uie-activity-progress").css("width", `${pct}%`);
        $("#uie-activity-timer").text(`${Math.floor(elapsed)}s / ${duration}s`);
    } else {
        $("#uie-activity-current-display").text("Idle");
        $("#uie-activity-stop").hide();
        $("#uie-activity-progress").css("width", "0%");
        $("#uie-activity-timer").text("--:--");
    }
}

function tick() {
    const s = getSettings();
    if (!s) return;
    
    const current = s.activities?.active?.[0];
    if (current) {
        const elapsed = (Date.now() - current.startTime) / 1000;
        const duration = Number(current.duration) || 60;
        
        if (elapsed >= duration) {
            completeActivity(current);
        } else if (activeTab === "general") {
            updateCurrentStatus(s);
        }
    }
}

function startActivity(idx, type) {
    const s = getSettings();
    ensureActivities(s);
    
    let act;
    if (type === "default") {
        const defaults = [
            { name: "Training", desc: "Gain XP", duration: 60 },
            { name: "Meditation", desc: "Regenerate MP", duration: 60 },
            { name: "Resting", desc: "Regenerate HP", duration: 120 },
            { name: "Working", desc: "Earn Gold", duration: 300 }
        ];
        act = defaults[idx];
    } else {
        act = s.activities.loops[idx];
    }
    
    if (act) {
        s.activities.active = [{ ...act, startTime: Date.now() }];
        saveSettings();
        renderGeneral();
    }
}

function stopActivity() {
    const s = getSettings();
    if (s && s.activities) {
        s.activities.active = [];
        saveSettings();
        renderGeneral();
    }
}

function createCustomActivity() {
    const name = $("#uie-activity-new-name").val();
    if (!name) return;
    
    const s = getSettings();
    ensureActivities(s);
    if (!s.activities.loops) s.activities.loops = [];
    
    s.activities.loops.push({ name, desc: "Custom Activity", duration: 60 });
    saveSettings();
    $("#uie-activity-new-name").val("");
    renderGeneral();
}

function completeActivity(act) {
    const s = getSettings();
    if (!s) return;
    
    let msg = `Completed: ${act.name}`;
    let eventType = "activity_complete";
    let eventData = { name: act.name, duration: act.duration };

    if (act.name === "Training") {
        s.xp = (s.xp || 0) + 10;
        msg += " (+10 XP)";
        eventData.gain = { xp: 10 };
        // Stats
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};
        const st = s.character.stats;
        st.str = (st.str || 10) + 1;
        st.dex = (st.dex || 10) + 1;
        st.con = (st.con || 10) + 1;
        msg += " (+STR/DEX/CON)";
    } else if (act.name === "Working") {
        s.currency = (s.currency || 0) + 50;
        msg += " (+50 G)";
        eventData.gain = { currency: 50 };
        // Stats
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};
        const st = s.character.stats;
        st.cha = (st.cha || 10) + 1;
        st.luk = (st.luk || 10) + 1;
        msg += " (+CHA/LUK)";
    } else if (act.name === "Resting") {
        s.hp = Math.min(s.maxHp || 100, (s.hp || 0) + 10);
        msg += " (+10 HP)";
        eventData.gain = { hp: 10 };
        // Stats
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};
        const st = s.character.stats;
        st.vit = (st.vit || 10) + 1;
        st.end = (st.end || 10) + 1;
        msg += " (+VIT/END)";
    } else if (act.name === "Meditation") {
        s.mp = Math.min(s.maxMp || 50, (s.mp || 0) + 5);
        msg += " (+5 MP)";
        eventData.gain = { mp: 5 };
        // Stats
        if (!s.character) s.character = {};
        if (!s.character.stats) s.character.stats = {};
        const st = s.character.stats;
        st.int = (st.int || 10) + 1;
        st.wis = (st.wis || 10) + 1;
        st.spi = (st.spi || 10) + 1;
        msg += " (+INT/WIS/SPI)";
    }
    
    // Loop
    s.activities.active[0].startTime = Date.now();
    saveSettings();
    
    if (window.toastr) window.toastr.success(msg);
    // Inject into spine
    UnifiedSpine.inject(`[System: ${msg}]`, { uie: { type: eventType, ...eventData } });
    renderGeneral();
}
