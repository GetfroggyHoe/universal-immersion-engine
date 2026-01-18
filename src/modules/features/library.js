import { getSettings, saveSettings } from "../core.js";
import { generateContent } from "../apiClient.js";

export function initLibrary() {
    renderShelf();
    $(document).off("click.lib").on("click.lib", ".lib-book-item", function() {
        const id = $(this).data("id");
        const b = (getSettings().library||[]).find(x=>x.id==id);
        if(b) $("#uie-lib-reader").html(b.content);
    });
    $(document).on("click.lib", "#uie-lib-gen-btn", async () => {
        const t = prompt("Book Title?"); if(!t) return;
        const res = await generateContent(`Write short book "${t}". HTML format.`, "Webpage");
        const s = getSettings(); if(!s.library) s.library=[];
        s.library.push({id:Date.now(), title:t, content:res.replace(/```html|```/g,"")});
        saveSettings(); renderShelf();
    });
}
function renderShelf() {
    const s = getSettings(); const shelf = $("#uie-lib-shelf").empty();
    (s.library||[]).forEach(b => shelf.append(`<div class="lib-book-item" data-id="${b.id}" style="padding:10px; cursor:pointer; border-bottom:1px solid #ccc;">${b.title}</div>`));
}
