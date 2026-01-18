import { getSettings, saveSettings } from "./core.js";

let idx = 0;
let stickerInit = false;
let stickerPacks = [];
let activePackId = "";
let importPendingName = "";

const STICKERS_BASE = "./assets/stickers/";
const STICKER_DB = { name: "uie_stickers", store: "packs", version: 1 };

function esc(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function emotionFromFilename(name) {
    const base = String(name || "").split("/").pop() || "";
    const m = base.match(/^([a-zA-Z]{2,16})_/);
    return m ? m[1].toLowerCase() : "";
}

function ensureDiaryModel(s) {
    if (!s.diary || !Array.isArray(s.diary)) s.diary = [{ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] }];
    if (s.diary.length === 0) s.diary.push({ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] });
    s.diary.forEach(e => {
        if (!e || typeof e !== "object") return;
        if (typeof e.title !== "string") e.title = String(e.title || "");
        if (!Array.isArray(e.stickers)) e.stickers = [];
    });
}

function openStickerDb() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) return resolve(null);
        const req = indexedDB.open(STICKER_DB.name, STICKER_DB.version);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STICKER_DB.store)) db.createObjectStore(STICKER_DB.store, { keyPath: "name" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
    });
}

async function dbGetAllPacks() {
    const db = await openStickerDb();
    if (!db) return [];
    return new Promise((resolve) => {
        const tx = db.transaction(STICKER_DB.store, "readonly");
        const store = tx.objectStore(STICKER_DB.store);
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => resolve([]);
    });
}

async function dbPutPack(pack) {
    const db = await openStickerDb();
    if (!db) return false;
    return new Promise((resolve) => {
        const tx = db.transaction(STICKER_DB.store, "readwrite");
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.objectStore(STICKER_DB.store).put(pack);
    });
}

function parseDirectoryListing(html) {
    try {
        const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
        const links = Array.from(doc.querySelectorAll("a[href]")).map(a => String(a.getAttribute("href") || ""));
        return links;
    } catch (_) {
        return [];
    }
}

async function fetchJson(url) {
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
    } catch (_) {
        return null;
    }
}

async function fetchText(url) {
    try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return "";
        return await r.text();
    } catch (_) {
        return "";
    }
}

function isImageFile(name) {
    const n = String(name || "").toLowerCase();
    return n.endsWith(".png") || n.endsWith(".gif") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".svg");
}

function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl || "");
    const m = raw.match(/^data:([^;]+);base64,(.*)$/);
    if (!m) return null;
    const mime = m[1] || "application/octet-stream";
    const b64 = m[2] || "";
    try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    } catch (_) {
        return null;
    }
}

async function applyDiaryImageFromFile(file) {
    const f = file;
    if (!f) return false;
    if (!String(f.type || "").startsWith("image/")) return false;
    const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => resolve("");
        r.readAsDataURL(f);
    });
    if (!dataUrl) return false;
    const s = getSettings();
    ensureDiaryModel(s);
    if (!s.diary[idx]) s.diary[idx] = { title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] };
    s.diary[idx].img = dataUrl;
    saveSettings();
    renderDiary();
    return true;
}

async function loadFolderPacks() {
    const packs = [];
    const manifest = await fetchJson(`${STICKERS_BASE}manifest.json`);
    const fromManifest = Array.isArray(manifest?.packs) ? manifest.packs : [];
    fromManifest.forEach(p => {
        const name = String(p?.name || "").trim();
        const folder = String(p?.folder || name).trim();
        if (!name || !folder) return;
        packs.push({ id: `folder:${folder}`, name, source: "folder", folder, files: Array.isArray(p?.files) ? p.files.slice(0, 500) : null });
    });

    const listing = await fetchText(STICKERS_BASE);
    const links = parseDirectoryListing(listing);
    links.forEach(href => {
        const clean = href.replace(/^\.\//, "");
        if (!clean || clean === "../" || clean.startsWith("?") || clean.startsWith("#")) return;
        if (!clean.endsWith("/")) return;
        const folder = decodeURIComponent(clean.replace(/\/$/, ""));
        if (!folder) return;
        if (folder.toLowerCase() === "default") return;
        if (folder.toLowerCase() === "assets" || folder.toLowerCase() === "stickers") return;
        if (packs.some(x => x.folder === folder)) return;
        packs.push({ id: `folder:${folder}`, name: folder, source: "folder", folder, files: null });
    });

    return packs;
}

async function loadImportedPacks() {
    const all = await dbGetAllPacks();
    return all
        .map(p => ({
            id: `import:${String(p?.name || "")}`,
            name: String(p?.name || ""),
            source: "import",
            images: Array.isArray(p?.images) ? p.images : []
        }))
        .filter(p => p.name);
}

async function refreshStickerPacks() {
    const imported = await loadImportedPacks();
    stickerPacks = [...imported];

    if (!activePackId || !stickerPacks.some(p => p.id === activePackId)) activePackId = stickerPacks[0]?.id || "";
    renderStickerTabs();
    await renderActivePack();
}

function renderStickerTabs() {
    const $tabs = $("#uie-diary-sticker-tabs");
    if (!$tabs.length) return;
    $tabs.empty();
    stickerPacks.forEach(p => {
        const cls = p.id === activePackId ? "uie-sticker-tab active" : "uie-sticker-tab";
        $tabs.append(`<button class="${cls}" data-pack="${esc(p.id)}">${esc(p.name)}</button>`);
    });
}

async function listFolderFiles(folder) {
    const html = await fetchText(`${STICKERS_BASE}${encodeURIComponent(folder)}/`);
    const links = parseDirectoryListing(html);
    const files = [];
    links.forEach(href => {
        const clean = href.replace(/^\.\//, "");
        if (!clean || clean === "../") return;
        if (clean.endsWith("/")) return;
        const f = decodeURIComponent(clean.split("?")[0].split("#")[0]);
        if (!isImageFile(f)) return;
        files.push(f);
    });
    return files.slice(0, 800);
}

async function renderActivePack() {
    const pack = stickerPacks.find(p => p.id === activePackId);
    const $grid = $("#uie-sticker-grid");
    const $empty = $("#uie-sticker-empty");
    if (!$grid.length || !$empty.length) return;
    $grid.empty();

    if (!pack) {
        $empty.text("No packs found.").show();
        return;
    }

    let imgs = [];
    if (pack.source === "import") {
        imgs = (pack.images || []).map(im => ({
            name: String(im?.name || ""),
            src: String(im?.dataUrl || ""),
            emotion: String(im?.emotion || emotionFromFilename(im?.name || ""))
        })).filter(x => x.name && x.src);
    } else {
        let files = Array.isArray(pack.files) ? pack.files : null;
        if (!files) files = await listFolderFiles(pack.folder);
        pack.files = files;
        imgs = (files || []).filter(isImageFile).map(f => ({
            name: f,
            src: `${STICKERS_BASE}${pack.folder}/${f}`,
            emotion: emotionFromFilename(f)
        }));
    }

    if (!imgs.length) {
        $empty.html(`No stickers in <b>${esc(pack.name)}</b>.`).show();
        return;
    }

    $empty.hide();
    imgs.slice(0, 800).forEach(im => {
        $grid.append(`
            <div class="uie-sticker-tile" data-pack="${esc(pack.id)}" data-name="${esc(im.name)}" data-src="${esc(im.src)}" data-emotion="${esc(im.emotion)}" title="${esc(im.name)}">
                <img src="${esc(im.src)}" alt="${esc(im.name)}">
            </div>
        `);
    });
}

let dragTarget = null;
let dragStart = { x: 0, y: 0 };
let dragOrig = { x: 0, y: 0 };

function renderStickerStrip() {
    const s = getSettings();
    ensureDiaryModel(s);
    const entry = s.diary[idx] || {};
    const list = Array.isArray(entry.stickers) ? entry.stickers : [];
    const $layer = $("#uie-diary-sticker-layer");
    if (!$layer.length) return;
    $layer.empty();
    if (!list.length) return;
    
    list.forEach((st, i) => {
        const src = String(st?.src || "");
        if (!src) return;
        // Default positions if missing
        const x = Number(st.x) || 50 + (i * 20);
        const y = Number(st.y) || 50 + (i * 10);
        const rot = Number(st.rotation) || 0;
        const scale = Number(st.scale) || 1;
        
        $layer.append(`
            <div class="uie-diary-sticker" data-i="${i}" style="left:${x}px; top:${y}px; transform: rotate(${rot}deg) scale(${scale});">
                <img src="${esc(src)}" draggable="false" alt="">
                <div class="uie-diary-sticker-x" data-i="${i}">×</div>
            </div>
        `);
    });
}

export function renderDiary() {
    const s = getSettings();
    ensureDiaryModel(s);

    // Bounds Safety
    if (idx >= s.diary.length) idx = s.diary.length - 1;
    if (idx < 0) idx = 0;

    $("#uie-diary-num").text(idx + 1);
    $("#uie-diary-title").val(String(s.diary[idx].title || ""));
    $("#uie-diary-text").val(s.diary[idx].text || "");
    $("#uie-diary-date").text(s.diary[idx].date || "Unknown Date");

    const img = String(s.diary[idx].img || "");
    const $photo = $("#uie-diary-photo");
    if ($photo.length) {
        if (img) {
            $photo.css({ backgroundImage: `url("${img}")`, backgroundSize: "cover", backgroundPosition: "center" }).html("");
        } else {
            $photo.css({ backgroundImage: "", backgroundSize: "", backgroundPosition: "" }).html(`<i class="fa-solid fa-image" style="font-size:14px; opacity:0.75;"></i>`);
        }
    }

    renderStickerStrip();
}

export function initDiary() {
    if (!stickerInit) {
        stickerInit = true;
        $(document).off("click.uieDiaryStickers");
        $(document).off("click.uieDiaryClose", "#uie-diary-close");
        $(document).on("click.uieDiaryClose", "#uie-diary-close", function (e) {
            e.preventDefault();
            e.stopPropagation();
            try { $("#uie-diary-sticker-drawer").hide(); } catch (_) {}
            $("#uie-diary-window").hide();
        });
        $(document).on("click.uieDiaryStickers", "#uie-diary-stickers", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-diary-sticker-drawer").css("display", "flex");
            await refreshStickerPacks();
        });
        $(document).on("click.uieDiaryStickers", "#uie-sticker-close", function(e) {
            e.preventDefault();
            e.stopPropagation();
            $("#uie-diary-sticker-drawer").hide();
        });
        $(document).on("click.uieDiaryStickers", "#uie-diary-sticker-drawer", function(e) {
            if (e.target && e.target.id === "uie-diary-sticker-drawer") $("#uie-diary-sticker-drawer").hide();
        });
        $(document).on("click.uieDiaryStickers", ".uie-sticker-tab", async function(e) {
            e.preventDefault();
            e.stopPropagation();
            activePackId = String($(this).data("pack") || "");
            renderStickerTabs();
            await renderActivePack();
        });
        $(document).on("click.uieDiaryStickers", ".uie-sticker-tile", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const src = String($(this).data("src") || "");
            const name = String($(this).data("name") || "");
            const emotion = String($(this).data("emotion") || "");
            const packId = String($(this).data("pack") || "");
            const pack = stickerPacks.find(p => p.id === packId);
            if (!src || !name || !pack) return;
            const s = getSettings();
            ensureDiaryModel(s);
            if (!s.diary[idx]) s.diary[idx] = { date: new Date().toLocaleString(), text: "", img: "", stickers: [] };
            if (!Array.isArray(s.diary[idx].stickers)) s.diary[idx].stickers = [];
            
            // Randomized center placement for new stickers
            const layer = document.getElementById("uie-diary-sticker-layer");
            const rect = layer ? layer.getBoundingClientRect() : { width: 300, height: 300 };
            const x = (rect.width / 2) - 40 + (Math.random() * 40 - 20);
            const y = (rect.height / 2) - 40 + (Math.random() * 40 - 20);
            
            s.diary[idx].stickers.push({
                pack: pack.name,
                name,
                src,
                source: pack.source,
                emotion: emotion || emotionFromFilename(name),
                x, y, rotation: (Math.random() * 30 - 15), scale: 1
            });
            saveSettings();
            renderDiary();
            $("#uie-diary-sticker-drawer").hide();
        });
        $(document).on("click.uieDiaryStickers", ".uie-diary-sticker-x", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const i = Number($(this).data("i"));
            const s = getSettings();
            ensureDiaryModel(s);
            const entry = s.diary[idx];
            if (!entry || !Array.isArray(entry.stickers)) return;
            if (!Number.isFinite(i) || i < 0 || i >= entry.stickers.length) return;
            entry.stickers.splice(i, 1);
            saveSettings();
            renderDiary();
        });
        
        // DRAG LOGIC (Touch + Mouse)
        const onDragStart = (e) => {
            const t = $(e.target).closest(".uie-diary-sticker");
            // Ignore if clicking the delete X
            if (!t.length || $(e.target).closest(".uie-diary-sticker-x").length) return;
            
            e.preventDefault();
            dragTarget = t;
            t.addClass("active");
            
            // Bring to front visual
            t.appendTo(t.parent());
            
            const p = e.touches ? e.touches[0] : e;
            dragStart = { x: p.clientX, y: p.clientY };
            dragOrig = { x: parseFloat(t.css("left")) || 0, y: parseFloat(t.css("top")) || 0 };
        };
        
        const onDragMove = (e) => {
            if (!dragTarget) return;
            e.preventDefault(); // Prevent scrolling while dragging
            const p = e.touches ? e.touches[0] : e;
            const dx = p.clientX - dragStart.x;
            const dy = p.clientY - dragStart.y;
            dragTarget.css({ left: dragOrig.x + dx, top: dragOrig.y + dy });
        };
        
        const onDragEnd = (e) => {
            if (!dragTarget) return;
            const i = Number(dragTarget.data("i"));
            const s = getSettings();
            ensureDiaryModel(s);
            // Re-find the index because DOM order might have changed? 
            // Actually data-i is static, but splice invalidates it.
            // If we just move, it's fine.
            // Wait, if I appendTo to bring to front, the DOM order changes but data-i stays.
            // But when I renderDiary(), I rebuild from array. 
            // So I need to update the array at index `i`.
            // BUT if I brought to front, I should technically move it to end of array to persist Z-order?
            // For now, let's just update X/Y.
            
            if (s.diary[idx] && s.diary[idx].stickers && s.diary[idx].stickers[i]) {
                s.diary[idx].stickers[i].x = parseFloat(dragTarget.css("left")) || 0;
                s.diary[idx].stickers[i].y = parseFloat(dragTarget.css("top")) || 0;
                saveSettings();
            }
            dragTarget.removeClass("active");
            dragTarget = null;
        };

        // Attach listeners to layer (delegation for start) and window (for move/end)
        // We use native listeners for better passive control
        const layer = document.getElementById("uie-diary-sticker-layer");
        // We need to attach to something that exists. 
        // Since layer is rebuilt, we should attach to document or use a stable container.
        // #uie-diary-window is stable? No, it's in a template.
        // Let's attach to document with delegation check.
        
        document.addEventListener("mousedown", (e) => {
            if ($(e.target).closest("#uie-diary-sticker-layer").length) onDragStart(e);
        });
        document.addEventListener("touchstart", (e) => {
             if ($(e.target).closest("#uie-diary-sticker-layer").length) onDragStart(e);
        }, { passive: false });
        
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("touchmove", onDragMove, { passive: false });
        window.addEventListener("mouseup", onDragEnd);
        window.addEventListener("touchend", onDragEnd);


        $(document).on("click.uieDiaryStickers", "#uie-sticker-import", function(e) {
            e.preventDefault();
            e.stopPropagation();
            const name = (prompt("Pack name:", "MyPack") || "").trim();
            if (!name) return;
            importPendingName = name.slice(0, 50);
            $("#uie-sticker-import-files").trigger("click");
        });
        $(document).on("change.uieDiaryStickers", "#uie-sticker-import-files", async function() {
            const files = Array.from(this.files || []);
            $(this).val("");
            const name = String(importPendingName || "").trim();
            importPendingName = "";
            if (!name || !files.length) return;
            const imgs = [];
            for (const f of files.slice(0, 120)) {
                const fname = String(f?.name || "");
                if (!isImageFile(fname)) continue;
                const dataUrl = await new Promise((resolve) => {
                    const r = new FileReader();
                    r.onload = (ev) => resolve(String(ev?.target?.result || ""));
                    r.onerror = () => resolve("");
                    r.readAsDataURL(f);
                });
                if (!dataUrl) continue;
                imgs.push({ name: fname, dataUrl, emotion: emotionFromFilename(fname) });
            }
            await dbPutPack({ name, createdAt: Date.now(), images: imgs });
            await refreshStickerPacks();
            activePackId = `import:${name}`;
            renderStickerTabs();
            await renderActivePack();
        });
    }

    // Auto-save input
    $(document).on("input", "#uie-diary-title", function() {
        const s = getSettings();
        ensureDiaryModel(s);
        if(!s.diary[idx]) s.diary[idx] = { title: "", date: new Date().toLocaleString(), text: "", img: "", stickers: [] };
        s.diary[idx].title = String($(this).val() || "").slice(0, 80);
        saveSettings();
    });
    $(document).on("input", "#uie-diary-text", function() {
        const s = getSettings();
        ensureDiaryModel(s);
        if(!s.diary[idx]) s.diary[idx] = { title: "", date: new Date().toLocaleString(), text: "", img: "", stickers: [] };
        s.diary[idx].text = $(this).val();
        saveSettings();
    });

    $(document).on("click", "#uie-diary-photo", function(e) {
        e.preventDefault();
        e.stopPropagation();
        $("#uie-diary-photo-file").trigger("click");
    });

    $(document).on("change", "#uie-diary-photo-file", function() {
        const file = this.files && this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            const s = getSettings();
            if(!s.diary[idx]) s.diary[idx] = { date: new Date().toLocaleString() };
            s.diary[idx].img = String(ev.target.result || "");
            saveSettings();
            renderDiary();
        };
        reader.readAsDataURL(file);
        $(this).val("");
    });

    $(document).on("click", "#uie-diary-photo-clear", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        if(!s.diary[idx]) s.diary[idx] = { date: new Date().toLocaleString() };
        s.diary[idx].img = "";
        saveSettings();
        renderDiary();
    });

    $(document).on("click", "#uie-diary-photo-copy", async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const s = getSettings();
        ensureDiaryModel(s);
        const img = String(s.diary?.[idx]?.img || "");
        if (!img) { try { if (window.toastr) window.toastr.info("No image to copy."); } catch (_) {} return; }
        const blob = dataUrlToBlob(img);
        if (!blob) { try { if (window.toastr) window.toastr.error("Copy failed."); } catch (_) {} return; }
        try {
            if (!navigator.clipboard?.write) throw new Error("no clipboard.write");
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            try { if (window.toastr) window.toastr.success("Image copied."); } catch (_) {}
        } catch (_) {
            try { if (window.toastr) window.toastr.info("Copy not available on this device."); } catch (_) {}
        }
    });

    $(document).on("paste", "#uie-diary-window, #uie-diary-text, #uie-diary-title", async function(e) {
        try {
            const items = e?.originalEvent?.clipboardData?.items || e?.clipboardData?.items || [];
            if (!items || !items.length) return;
            for (const it of items) {
                const type = String(it?.type || "");
                if (!type.startsWith("image/")) continue;
                const f = it.getAsFile?.();
                if (!f) continue;
                e.preventDefault();
                e.stopPropagation();
                await applyDiaryImageFromFile(f);
                try { if (window.toastr) window.toastr.success("Pasted image."); } catch (_) {}
                return;
            }
        } catch (_) {}
    });

    // DELETE PAGE
    $(document).on("click", "#uie-diary-delete", () => {
        if (!confirm("Delete this page? This cannot be undone.")) return;
        const s = getSettings();
        ensureDiaryModel(s);
        if (s.diary.length <= 1) {
            s.diary = [{ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] }];
            idx = 0;
            saveSettings();
            renderDiary();
            if(window.toastr) toastr.info("Cleared diary (cannot delete last page).");
            return;
        }
        s.diary.splice(idx, 1);
        if (idx >= s.diary.length) idx = s.diary.length - 1;
        saveSettings();
        renderDiary();
        if(window.toastr) toastr.success("Page Deleted");
    });

    // NEW PAGE
    $(document).on("click", "#uie-diary-new", () => {
        const s = getSettings();
        // Registers date and time no matter what it is
        ensureDiaryModel(s);
        s.diary.push({title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: []});
        idx = s.diary.length - 1; // Jump to end
        saveSettings();
        renderDiary();
        // Visual feedback
        $("#uie-diary-title").focus();
        if(window.toastr) toastr.success("New Page Created");
    });

    $(document).on("click", "#uie-diary-prev", () => {
        if (idx > 0) { idx--; renderDiary(); }
    });

    $(document).on("click", "#uie-diary-next", () => {
        const s = getSettings();
        if (idx < s.diary.length - 1) { idx++; renderDiary(); }
        else {
            if(window.toastr) toastr.info("End of Diary. Click 'New Page' to add more.");
        }
    });

    renderDiary();
}
