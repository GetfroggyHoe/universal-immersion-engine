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
    
    const tmpl = document.getElementById("uie-template-lib-book");
    if (!tmpl) return;

    const frag = document.createDocumentFragment();

    s.library.forEach(b => {
        let icon = "fa-book";
        if(b.type === "comic" || b.type === "manga") icon = "fa-book-open";
        
        const clone = tmpl.content.cloneNode(true);
        const item = clone.querySelector(".lib-book-item");
        if (item) item.setAttribute("data-id", b.id);
        
        const iEl = clone.querySelector("i");
        if (iEl) iEl.classList.add(icon);
        
        const titleEl = clone.querySelector(".lib-book-title");
        if (titleEl) titleEl.textContent = b.title;
        
        frag.appendChild(clone);
    });
    shelf.append(frag);
}
