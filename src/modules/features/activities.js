import { getSettings, saveSettings } from "../core.js";

let interval = null;

function render() {
    const s = getSettings();
    if (!s) return;
    if (!s.activities) s.activities = { active: [], loops: [] };

    const $list = $("#uie-activities-list");
    $list.empty();

    // Default activities
    const defaults = [
        { name: "Training", desc: "Gain XP", duration: 60 },
        { name: "Meditation", desc: "Regenerate MP", duration: 60 },
        { name: "Resting", desc: "Regenerate HP", duration: 120 },
        { name: "Working", desc: "Earn Gold", duration: 300 }
    ];
    
    // Merge with user loops
    const all = [...defaults, ...(s.activities.loops || [])];

    // Current Activity
    const current = s.activities.active?.[0]; // Support single active loop for now
    
    if (current) {
        $("#uie-activity-current-display").text(current.name);
        $("#uie-activity-stop").show();
        
        // Update progress bar
        const elapsed = (Date.now() - current.startTime) / 1000;
        const duration = Number(current.duration) || 60;
        const pct = Math.min(100, (elapsed / duration) * 100);
        $("#uie-activity-progress").css("width", `${pct}%`);
        $("#uie-activity-timer").text(`${Math.floor(elapsed)}s / ${duration}s`);

        if (pct >= 100) {
             completeActivity(current);
        }
    } else {
        $("#uie-activity-current-display").text("Idle");
        $("#uie-activity-stop").hide();
        $("#uie-activity-progress").css("width", "0%");
        $("#uie-activity-timer").text("--:--");
    }

    // List
    for (const act of all) {
        const $el = $(`
            <div class="uie-activity-card" style="background:rgba(255,255,255,0.05); padding:10px; border-radius:6px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="font-weight:bold;">${act.name}</div>
                    <div style="font-size:0.8em; opacity:0.7;">${act.desc || ""} (${act.duration}s)</div>
                </div>
                <button class="uie-btn-sm" style="background:rgba(255,255,255,0.1); border:none; padding:4px 8px; border-radius:4px; color:white; cursor:pointer;">Start</button>
            </div>
        `);
        
        $el.find("button").on("click", () => startActivity(act));
        $list.append($el);
    }
}

function startActivity(act) {
    const s = getSettings();
    if (!s) return;
    if (!s.activities) s.activities = { active: [], loops: [] };
    
    s.activities.active = [{ ...act, startTime: Date.now() }];
    saveSettings();
    render();
}

function stopActivity() {
    const s = getSettings();
    if (!s) return;
    s.activities.active = [];
    saveSettings();
    render();
}

function completeActivity(act) {
    const s = getSettings();
    if (!s) return;
    
    // Simple reward logic
    let msg = `Completed loop: ${act.name}`;
    if (act.name === "Training") {
        s.xp = (s.xp || 0) + 10;
        msg += " (+10 XP)";
    } else if (act.name === "Working") {
        s.currency = (s.currency || 0) + 50;
        msg += " (+50 G)";
    } else if (act.name === "Resting") {
        s.hp = Math.min(s.maxHp || 100, (s.hp || 0) + 10);
        msg += " (+10 HP)";
    } else if (act.name === "Meditation") {
        s.mp = Math.min(s.maxMp || 50, (s.mp || 0) + 5);
        msg += " (+5 MP)";
    }
    
    // Loop it
    s.activities.active[0].startTime = Date.now(); 
    
    saveSettings();
    
    // Notify
    if (window.toastr) window.toastr.success(msg);
    
    render();
}

export function initActivities() {
    render();
    
    $(document).on("click", "#uie-btn-activities", (e) => {
        e.preventDefault();
        $("#uie-activities-window").show();
        render();
    });

    $("#uie-activity-stop").on("click", stopActivity);
    $("#uie-activity-create").on("click", () => {
        const name = $("#uie-activity-new-name").val();
        if (name) {
            const s = getSettings();
            if (!s.activities) s.activities = { active: [], loops: [] };
            if (!s.activities.loops) s.activities.loops = [];
            s.activities.loops.push({ name, desc: "Custom Activity", duration: 60 });
            saveSettings();
            render();
            $("#uie-activity-new-name").val("");
        }
    });

    if (interval) clearInterval(interval);
    interval = setInterval(render, 1000); // Update UI every second
}
