import { getSettings } from "./core.js";
import { getContext } from "/scripts/extensions.js";

const MAX_ENTRIES = 250;
const buffer = [];
let hooked = false;

function nowIso() { return new Date().toISOString(); }

function safeString(x) {
    try { return typeof x === "string" ? x : JSON.stringify(x); } catch (_) { return String(x); }
}

function pushEntry(entry) {
    buffer.push(entry);
    while (buffer.length > MAX_ENTRIES) buffer.shift();
    if ($("#uie-debug-window").is(":visible")) renderLog();
}

function logLine(msg, type = "info") {
    pushEntry({ ts: nowIso(), type, msg: String(msg || "").slice(0, 4000) });
}

function normalizeError(e) {
    const name = e?.name || "Error";
    const message = e?.message || safeString(e);
    const stack = e?.stack ? String(e.stack).slice(0, 9000) : "";
    return { name: String(name), message: String(message), stack };
}

function renderLog() {
    const el = $("#uie-debug-log");
    if (!el.length) return;
    el.empty();
    const frag = document.createDocumentFragment();
    buffer.slice(-MAX_ENTRIES).forEach((e) => {
        const cls = e.type === "fail" ? "log-fail" : e.type === "warn" ? "log-warn" : e.type === "pass" ? "log-pass" : "log-info";
        const line = `[${String(e.ts).replace("T", " ").replace("Z", "")}] ${e.msg}`;

        const div = document.createElement("div");
        div.className = cls;
        div.textContent = line;
        frag.appendChild(div);

        if (e.stack) {
            const stackDiv = document.createElement("div");
            stackDiv.className = cls;
            stackDiv.style.opacity = "0.85";
            stackDiv.style.marginLeft = "12px";
            stackDiv.style.whiteSpace = "pre-wrap";
            stackDiv.textContent = e.stack;
            frag.appendChild(stackDiv);
        }
    });
    el.append(frag);
    el.scrollTop(el[0].scrollHeight);
}

export function getDebugReport() {
    const s = getSettings() || {};
    const safeSettings = JSON.parse(JSON.stringify(s || {}));
    try {
        if (safeSettings?.turbo) safeSettings.turbo.key = safeSettings.turbo.key ? "[REDACTED]" : "";
    } catch (_) {}
    try {
        if (safeSettings?.image) safeSettings.image.key = safeSettings.image.key ? "[REDACTED]" : "";
    } catch (_) {}
    try {
        const profs = safeSettings?.connections?.profiles;
        if (Array.isArray(profs)) {
            profs.forEach((p) => {
                try { if (p?.turbo) p.turbo.key = p.turbo.key ? "[REDACTED]" : ""; } catch (_) {}
                try { if (p?.image) p.image.key = p.image.key ? "[REDACTED]" : ""; } catch (_) {}
            });
        }
    } catch (_) {}
    return {
        createdAt: nowIso(),
        location: String(window.location?.href || ""),
        userAgent: String(navigator.userAgent || ""),
        language: String(navigator.language || ""),
        platform: String(navigator.platform || ""),
        settings: safeSettings,
        dom: {
            launcher: !!document.querySelector("#uie-launcher"),
            menu: !!document.querySelector("#uie-main-menu"),
            inventory: !!document.querySelector("#uie-inventory-window"),
            phone: !!document.querySelector("#uie-phone-window"),
            calendar: !!document.querySelector("#uie-calendar-window"),
            social: !!document.querySelector("#uie-social-window")
        },
        entries: buffer.slice()
    };
}

async function copyReport() {
    const txt = JSON.stringify(getDebugReport(), null, 2);
    try {
        await navigator.clipboard.writeText(txt);
        if (window.toastr) toastr.success("Copied debug report to clipboard.");
        else alert("Copied debug report.");
    } catch (_) {
        try {
            const ta = document.createElement("textarea");
            ta.value = txt;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
            if (window.toastr) toastr.success("Copied debug report to clipboard.");
            else alert("Copied debug report.");
        } catch (e) {
            if (window.toastr) toastr.error("Copy failed.");
        }
    }
}

function downloadReport() {
    const txt = JSON.stringify(getDebugReport(), null, 2);
    const blob = new Blob([txt], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `uie_debug_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function runDomScan() {
    logLine("Scanning UIE DOM + environment…", "info");
    const checks = [
        ["Core settings", !!getSettings()],
        ["#uie-launcher", !!document.querySelector("#uie-launcher")],
        ["#uie-main-menu", !!document.querySelector("#uie-main-menu")],
        ["#uie-inventory-window", !!document.querySelector("#uie-inventory-window")],
        ["#uie-settings-window", !!document.querySelector("#uie-settings-window")],
        ["#uie-bg-file (bg picker)", !!document.querySelector("#uie-bg-file")],
        ["#uie-phone-window", !!document.querySelector("#uie-phone-window")],
        ["#uie-calendar-window", !!document.querySelector("#uie-calendar-window")],
        ["#uie-social-window", !!document.querySelector("#uie-social-window")],
        ["Social memories overlay", !!document.querySelector("#uie-social-mem-overlay")],
        ["Databank social tab", !!document.querySelector("#uie-db-view-social")],
    ];
    checks.forEach(([name, ok]) => logLine(`${name}: ${ok ? "OK" : "MISSING"}`, ok ? "pass" : "fail"));
    const s = getSettings() || {};
    const turbo = !!(s?.turbo?.enabled);
    logLine(`Turbo: ${turbo ? "enabled" : "disabled"} (${String(s?.turbo?.model || "unknown")})`, "info");
    const aiConfirm = !!(s?.generation?.aiConfirm);
    logLine(`AI confirm: ${aiConfirm ? "ON" : "OFF"}`, "info");
    try {
        const ctx = getContext?.() || {};
        const ep = ctx?.extensionPrompts && typeof ctx.extensionPrompts === "object" ? ctx.extensionPrompts : {};
        const hasTriggers = typeof ep.UIE_TRIGGERS === "string" && ep.UIE_TRIGGERS.includes("[UIE_CALL:");
        const hasRel = typeof ep.UIE_RELATIONSHIPS === "string" && ep.UIE_RELATIONSHIPS.includes("[UIE_RELATIONSHIP_GOVERNOR");
        logLine(`Chat prompt hooks: UIE_TRIGGERS=${hasTriggers ? "OK" : "MISSING"}, UIE_RELATIONSHIPS=${hasRel ? "OK" : "MISSING"}`, (hasTriggers && hasRel) ? "pass" : "warn");
    } catch (_) {}
    try {
        const hid = s?.menuHidden || {};
        const hiddenKeys = Object.keys(hid).filter(k => hid[k]);
        logLine(`Menu hidden: ${hiddenKeys.length ? hiddenKeys.join(", ") : "none"}`, "info");
    } catch (_) {}
}

export function runDiagnostics() {
    runDomScan();
    if ($("#uie-debug-window").is(":visible")) renderLog();
}

function hookGlobalErrors() {
    if (hooked) return;
    hooked = true;

    window.addEventListener("error", (ev) => {
        const msg = `${ev.message || "Script error"}${ev.filename ? ` @ ${ev.filename}:${ev.lineno || 0}:${ev.colno || 0}` : ""}`;
        pushEntry({ ts: nowIso(), type: "fail", msg, stack: ev?.error?.stack ? String(ev.error.stack).slice(0, 9000) : "" });
    });

    window.addEventListener("unhandledrejection", (ev) => {
        const err = normalizeError(ev.reason);
        pushEntry({ ts: nowIso(), type: "fail", msg: `Unhandled Promise Rejection: ${err.name}: ${err.message}`, stack: err.stack });
    });

    const origError = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...args) => {
        try {
            const msg = args.map(a => safeString(a)).join(" ");
            pushEntry({ ts: nowIso(), type: "fail", msg: `console.error: ${msg}`.slice(0, 4000) });
        } catch (_) {}
        origError(...args);
    };
    console.warn = (...args) => {
        try {
            const msg = args.map(a => safeString(a)).join(" ");
            pushEntry({ ts: nowIso(), type: "warn", msg: `console.warn: ${msg}`.slice(0, 4000) });
        } catch (_) {}
        origWarn(...args);
    };
}

export function initDiagnostics() {
    hookGlobalErrors();
    $(document)
        .off("click.uieDiag")
        .on("click.uieDiag", "#uie-run-diag", function(e){ e.preventDefault(); e.stopPropagation(); runDiagnostics(); })
        .on("click.uieDiag", "#uie-debug-clear", function(e){ e.preventDefault(); e.stopPropagation(); buffer.length = 0; renderLog(); })
        .on("click.uieDiag", "#uie-debug-copy", async function(e){ e.preventDefault(); e.stopPropagation(); await copyReport(); })
        .on("click.uieDiag", "#uie-debug-download", function(e){ e.preventDefault(); e.stopPropagation(); downloadReport(); });

    logLine("Debug capture online.", "pass");
}
