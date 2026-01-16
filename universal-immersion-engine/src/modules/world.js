import { getSettings, saveSettings } from "./core.js";
import { scanEverything } from "./stateTracker.js";

export function initWorld() {
    const s = getSettings();
    $("#uie-world-id").text(s.worldSimId || "WAITING...");

    $(document).off("click.world");

    const render = () => {
        const s2 = getSettings();
        const ws = s2?.worldState || {};
        const loc = String(ws.location || "Unknown");
        const time = String(ws.time || "Day");
        const weather = String(ws.weather || "Clear");
        const threat = String(ws.threat || "None");
        const status = String(ws.status || "Normal");
        $("#uie-world-content").html(`
            <div style="display:flex; flex-direction:column; gap:10px;">
                <div style="font-weight:900; color:#cba35c;">World State</div>
                <div style="display:grid; grid-template-columns: 140px 1fr; gap:8px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size:12px;">
                    <div style="opacity:0.75;">Location</div><div style="font-weight:900;">${loc}</div>
                    <div style="opacity:0.75;">Time</div><div style="font-weight:900;">${time}</div>
                    <div style="opacity:0.75;">Weather</div><div style="font-weight:900;">${weather}</div>
                    <div style="opacity:0.75;">Threat</div><div style="font-weight:900;">${threat}</div>
                    <div style="opacity:0.75;">Status</div><div style="font-weight:900;">${status}</div>
                </div>
                <div style="opacity:0.75; font-size:12px;">
                    Updates automatically from chat when AI automation is on. Use refresh to scan immediately.
                </div>
            </div>
        `);
    };

    render();

    $(document).on("click.world", "#uie-world-gen", async () => {
        const input = $("#uie-world-input").val();
        if(!input) return;
        
        const s = getSettings();
        s.worldSimId = input.toUpperCase().substring(0, 15);
        $("#uie-world-id").text(s.worldSimId);
        saveSettings();
        render();
    });

    $(document).on("click.world", "#uie-world-update", async () => {
        const btn = $("#uie-world-update");
        btn.addClass("fa-spin");
        try {
            await scanEverything();
            render();
        } catch(e) {}
        finally { btn.removeClass("fa-spin"); }
    });
}
