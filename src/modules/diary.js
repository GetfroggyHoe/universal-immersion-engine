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
    const grid = document.getElementById("uie-sticker-grid");
    const empty = document.getElementById("uie-sticker-empty");
    if (!grid || !empty) return;

    grid.innerHTML = "";

    if (!pack) {
        empty.textContent = "No packs found.";
        empty.style.display = "block";
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
        empty.innerHTML = `No stickers in <b>${esc(pack.name)}</b>.`;
        empty.style.display = "block";
        return;
    }

    empty.style.display = "none";

    const tmpl = document.getElementById("uie-template-diary-sticker-tile");
    if (!tmpl) return;

    const frag = document.createDocumentFragment();
    imgs.slice(0, 800).forEach(im => {
        const clone = tmpl.content.cloneNode(true);
        const tile = clone.querySelector(".uie-sticker-tile");
        const img = clone.querySelector("img");

        tile.dataset.pack = esc(pack.id);
        tile.dataset.name = esc(im.name);
        tile.dataset.src = esc(im.src);
        tile.dataset.emotion = esc(im.emotion);
        tile.title = esc(im.name);

        img.src = esc(im.src);
        img.alt = esc(im.name);

        frag.appendChild(clone);
    });
    grid.appendChild(frag);
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
        const $win = $("#uie-diary-window");

        $win.off("click.uieDiaryStickers click.uieDiaryClose input.uieDiaryInput change.uieDiaryPhoto");
        $(document).off("click.uieDiaryStickers click.uieDiaryClose");

        $win.on("click.uieDiaryClose", "#uie-diary-close", function (e) {
            e.preventDefault();
            e.stopPropagation();
            try { $("#uie-diary-sticker-drawer").hide(); } catch (_) {}
            $win.hide();
        });

        // Navigation
        $win.on("click.uieDiaryNav", "#uie-diary-prev", function(e) {
            e.preventDefault();
            if (idx > 0) { idx--; renderDiary(); }
        });
        $win.on("click.uieDiaryNav", "#uie-diary-next", function(e) {
            e.preventDefault();
            const s = getSettings();
            if (idx < (s.diary?.length || 1) - 1) { idx++; renderDiary(); }
        });

        // Actions
        $win.on("click.uieDiaryAdd", "#uie-diary-add", function(e) {
            e.preventDefault();
            const s = getSettings();
            ensureDiaryModel(s);
            s.diary.push({ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] });
            idx = s.diary.length - 1;
            saveSettings();
            renderDiary();
        });

        $win.on("click.uieDiaryDel", "#uie-diary-delete", function(e) {
            e.preventDefault();
            if (!confirm("Delete this entry?")) return;
            const s = getSettings();
            ensureDiaryModel(s);
            if (s.diary.length <= 1) {
                s.diary = [{ title: "", text: "", date: new Date().toLocaleString(), img: "", stickers: [] }];
                idx = 0;
            } else {
                s.diary.splice(idx, 1);
                if (idx >= s.diary.length) idx = s.diary.length - 1;
            }
            saveSettings();
            renderDiary();
        });

        // Inputs
        $win.on("input.uieDiaryInput", "#uie-diary-title", function() {
            const s = getSettings();
            ensureDiaryModel(s);
            s.diary[idx].title = $(this).val();
            saveSettings();
        });
        $win.on("input.uieDiaryInput", "#uie-diary-text", function() {
            const s = getSettings();
            ensureDiaryModel(s);
            s.diary[idx].text = $(this).val();
            saveSettings();
        });

        // Photo
        $win.on("click.uieDiaryPhoto", "#uie-diary-photo", function(e) {
             e.preventDefault();
             $("#uie-diary-photo-input").click();
        });
        $win.on("change.uieDiaryPhoto", "#uie-diary-photo-input", function(e) {
             if (this.files && this.files[0]) applyDiaryImageFromFile(this.files[0]);
             try { this.value = ""; } catch(_) {}
        });

        // Stickers
        $win.on("click.uieDiaryStickerToggle", "#uie-diary-sticker-toggle", function(e) {
             e.preventDefault();
             const d = $("#uie-diary-sticker-drawer");
             if (d.is(":visible")) d.hide();
             else {
                 d.show();
                 refreshStickerPacks();
             }
        });

        $("body").off("click.uieDiaryTab").on("click.uieDiaryTab", ".uie-sticker-tab", function(e) {
             e.preventDefault();
             e.stopPropagation();
             activePackId = $(this).data("pack");
             renderStickerTabs();
             renderActivePack();
        });

        $("body").off("click.uieDiaryAddSticker").on("click.uieDiaryAddSticker", ".uie-sticker-tile", function(e) {
             e.preventDefault();
             e.stopPropagation();
             const src = $(this).data("src");
             if (!src) return;
             const s = getSettings();
             ensureDiaryModel(s);
             if (!Array.isArray(s.diary[idx].stickers)) s.diary[idx].stickers = [];
             s.diary[idx].stickers.push({
                 src,
                 x: 100 + (Math.random() * 50),
                 y: 100 + (Math.random() * 50),
                 rotation: (Math.random() * 40) - 20,
                 scale: 1
             });
             saveSettings();
             renderDiary();
        });

        $win.on("click.uieDiaryStickerRem", ".uie-diary-sticker-x", function(e) {
             e.preventDefault();
             e.stopPropagation();
             const i = Number($(this).data("i"));
             const s = getSettings();
             if (s.diary?.[idx]?.stickers?.[i]) {
                 s.diary[idx].stickers.splice(i, 1);
                 saveSettings();
                 renderDiary();
             }
        });

        // Force Hide on Init
        $("#uie-diary-window").hide();
    }

    renderDiary();
}
