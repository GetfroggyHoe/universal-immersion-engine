import { getSettings, saveSettings } from "./core.js";
import { generateContent } from "./apiClient.js";

const DEFAULT_GUIDE = {
    id: "guide",
    title: "User Guide",
    type: "text",
    content: "<h1>Universal Immersion Engine</h1><p>Welcome to V25 Sovereign. Use the Phone for apps, Inventory for gear, and Social for relationships.</p><h3>Apps</h3><p>Use the Sparkle button to generate new items using AI.</p>"
};

export function initLibrary() {
    renderShelf();
    const doc = $(document);

    doc.off("click", ".lib-book-item").on("click", ".lib-book-item", function() {
        $(".lib-book-item").css("background", "transparent");
        $(this).css("background", "rgba(0,0,0,0.05)");
        const id = $(this).data("id");
        const s = getSettings();
        const book = (s.library || []).find(b => b.id == id) || DEFAULT_GUIDE;
        $("#uie-lib-reader").html(book.content);
    });

    doc.off("click", "#uie-lib-gen-btn").on("click", "#uie-lib-gen-btn", async () => {
        const title = prompt("Book Title / Topic?");
        if(!title) return;
        const type = prompt("Type? (text / comic / manga)", "text");
        
        if(window.toastr) toastr.info("Writing book...");
        
        const promptText = `Generate a short ${type} about: "${title}". Output raw HTML. 
        If text: Use <h1>, <p>. 
        If comic/manga: Use <div style='border:1px solid black; padding:10px; margin:10px;'> for panels and descriptions of images.`;
        
        const res = await generateContent(promptText, "Webpage");
        
        const s = getSettings();
        if(!s.library) s.library = [DEFAULT_GUIDE];
        s.library.push({ id: Date.now(), title: title, type: type, content: res });
        saveSettings();
        renderShelf();
    });
}

function renderShelf() {
    const s = getSettings();
    if(!s.library) s.library = [DEFAULT_GUIDE];
    const shelf = $("#uie-lib-shelf").empty();
    
    s.library.forEach(b => {
        let icon = "fa-book";
        if(b.type === "comic" || b.type === "manga") icon = "fa-book-open";
        
        shelf.append(`
            <div class="lib-book-item" data-id="${b.id}" style="padding:10px; cursor:pointer; border-bottom:1px solid #d7ccc8; display:flex; align-items:center; gap:10px;">
                <i class="fa-solid ${icon}" style="color:#5d4037;"></i>
                <div style="font-weight:bold; font-size:0.9em; color:#3e2723;">${b.title}</div>
            </div>
        `);
    });
}
