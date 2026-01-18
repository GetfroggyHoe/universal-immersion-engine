import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";

export function initDatabank() {
    render();
    $(document).off("click.db").on("click.db", "#uie-db-scan", async () => {
        let log = ""; $(".chat-msg-txt").slice(-50).each(function(){log+=$(this).text()+"\n";});
        const res = await generateContent(`Summarize into memory entry. JSON: {title, summary}. Log:\n${log.substring(0,3000)}`, "System Check");
        try {
            const data = JSON.parse(res.replace(/```json|```/g,""));
            const s = getSettings(); if(!s.databank) s.databank=[];
            s.databank.push({id:Date.now(), ...data});
            saveSettings(); render();
        } catch(e){}
    });
    $(document).on("click", ".uie-close-btn", function() { $(this).closest(".uie-window").hide(); });
}
function render() {
    const s = getSettings(); const l = $("#uie-db-list").empty();
    (s.databank||[]).forEach(m => l.append(`<div style="border:1px solid #00f0ff; padding:10px; margin-bottom:10px;"><b>${m.title}</b><p style="font-size:0.8em; color:#ccc;">${m.summary}</p></div>`));
}
