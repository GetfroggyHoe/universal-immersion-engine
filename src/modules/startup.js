import { getSettings, updateLayout } from "./core.js";
import { fetchTemplateHtml } from "./templateFetch.js";
import { initTurboUi } from "./apiClient.js";
import { initImageUi } from "./imageGen.js";

const baseUrl = (() => {
    try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
    } catch (_) {}
    return "/scripts/extensions/third-party/universal-immersion-engine/";
})();

export async function loadTemplates() {
    // Manually inject launcher to ensure it exists (bypassing fetch failure risks)
    if ($("#uie-launcher").length === 0) {
        try {
            setTimeout(() => {
                try {
                    const hasMainCss = Array.from(document.styleSheets || []).some(s => String(s?.href || "").includes("/universal-immersion-engine/") && String(s?.href || "").includes("style.css"));
                    if (hasMainCss) return;
                    if (document.getElementById("uie-launcher-fallback-style")) return;
                    const st = document.createElement("style");
                    st.id = "uie-launcher-fallback-style";
                    st.textContent = `
#uie-launcher{position:fixed;bottom:20px;left:20px;width:54px;height:54px;z-index:2147483645;cursor:pointer;background:transparent;}
#uie-launcher .uie-launcher-fallback{display:block; filter: drop-shadow(0 0 4px rgba(0,0,0,0.8));}
`;
                    document.head.appendChild(st);
                } catch (_) {}
            }, 550);
        } catch (_) {}
        // SVG Icon fallback
        const launcherHtml = `
            <div id="uie-launcher" title="Open Menu">
                <svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none;stroke:#cba35c;stroke-width:2;" class="uie-launcher-fallback">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
            </div>`;
        $("body").append(launcherHtml);
        try { updateLayout(); } catch(_) {}

        // Show SVG if background image fails to load (handled via CSS or error event usually,
        // but here we just leave it hidden unless we need it.
        // Actually, let's just rely on the CSS background image, but ensure the DIV is there.)
    }

    const required = ["menu", "inventory", "world"];
    const ts = (() => {
        try {
            const v = Number(window.UIE_BUILD);
            if (Number.isFinite(v) && v > 0) return v;
        } catch (_) {}
        return Date.now();
    })();
    for (const f of required) {
        if ($(`#uie-${f === "menu" ? "main-menu" : `${f}-window`}`).length) continue;
        const urls = [
            `${baseUrl}src/templates/${f}.html?v=${ts}`,
            `${baseUrl}templates/${f}.html?v=${ts}`,
            `/scripts/extensions/third-party/universal-immersion-engine/src/templates/${f}.html?v=${ts}`
        ];
        let html = "";
        for (const url of urls) {
            try {
                html = await fetchTemplateHtml(url);
                if (html) break;
            } catch (_) {}
        }
        if (!html) {
            try { console.error(`[UIE] Required template failed to load: ${f}`, { baseUrl, urls }); } catch (_) {}
            try { window.toastr?.error?.(`UIE failed to load required UI: ${f}. Check UIE_BASEURL / install.`); } catch (_) {}
            return;
        }
        $("body").append(html);
    }

    const optional = ['phone', 'calendar', 'debug', 'journal', 'social', 'diary', 'settings_window', 'shop', 'map', 'party', 'databank', 'battle', 'chatbox', 'launcher_options', 'sprites', 'activities', 'stats'];
    Promise.allSettled(
        optional.map(async (f) => {
            const url = `${baseUrl}src/templates/${f}.html?v=${ts}`;
            const html = await fetchTemplateHtml(url);
            
            // SPECIAL HANDLING: Chatbox needs to go into #reality-stage if possible, others to body
            if (f === "chatbox") {
                 const stage = document.getElementById("reality-stage");
                 if (stage) $(stage).append(html);
                 else $("body").append(html);
            } else {
                 $("body").append(html);
            }
            return { f, url };
        })
    ).then((results) => {
        const failed = results
            .map((r, i) => ({ r, f: optional[i] }))
            .filter((x) => x.r.status === "rejected")
            .map((x) => ({ file: x.f, error: x.r.reason }));
        if (failed.length) console.error("[UIE] Template load failures:", failed, { baseUrl });
    });
}

export function patchToastr() {
    try {
        if (!window.toastr) return;
        const t = window.toastr;
        if (t._uiePatched) return;
        const orig = {
            info: t.info?.bind(t),
            success: t.success?.bind(t),
            warning: t.warning?.bind(t),
            error: t.error?.bind(t),
        };
        t._uieOrig = orig;
        t._uiePatched = true;
        const wrap = (fn) => (msg, title, opts) => {
            const s = getSettings();
            if (s?.ui?.showPopups === false) return;
            return fn ? fn(msg, title, opts) : undefined;
        };
        if (orig.info) t.info = wrap(orig.info);
        if (orig.success) t.success = wrap(orig.success);
        if (orig.warning) t.warning = wrap(orig.warning);
        if (orig.error) t.error = wrap(orig.error);
        try {
            t.options = { ...(t.options || {}), progressBar: true, newestOnTop: true, closeButton: false, positionClass: t.options?.positionClass || "toast-bottom-right", timeOut: 3400, extendedTimeOut: 1200 };
        } catch (_) {}
    } catch (_) {}
}

export function injectSettingsUI() {
    const inject = async () => {
        const target = $("#extensions_settings, #extensions_settings_panel, #extensions-settings-container");
        if(target.length && !$("#uie-settings-block").length) {
            try {
                const ts = (() => {
                    try {
                        const v = Number(window.UIE_BUILD);
                        if (Number.isFinite(v) && v > 0) return v;
                    } catch (_) {}
                    return Date.now();
                })();
                const html = await fetchTemplateHtml(`${baseUrl}src/templates/settings.html?v=${ts}`);
                target.append($(html).attr("id", "uie-settings-block"));
                initTurboUi();
                initImageUi();
            } catch(e) {}
        } else {
            setTimeout(inject, 2000);
        }
    };
    inject();

    // Add Drawer Listener - DISABLED (Conflicts with core SillyTavern drawer listener)
    /*
    $(document).on("click", ".inline-drawer-toggle", function(e) {
        e.preventDefault();
        e.stopPropagation();
        const root = $(this).closest(".inline-drawer");
        const content = root.find(".inline-drawer-content");
        const icon = root.find(".inline-drawer-icon");

        if (content.is(":visible")) {
            content.slideUp(200);
            icon.css("transform", "rotate(-90deg)");
        } else {
            content.slideDown(200);
            icon.css("transform", "rotate(0deg)");
        }
    });
    */
}

try {
    window.uie = window.uie || {};
    window.uie.phone = window.uie.phone || {};
    if (typeof window.uie.phone.openBooksGuide !== "function") {
        window.uie.phone.openBooksGuide = async (sectionId) => {
            try {
                const mod = await import("./phone.js");
                if (typeof mod?.initPhone === "function") mod.initPhone();
                if (typeof mod?.openBooksGuide === "function") mod.openBooksGuide(sectionId);
            } catch (_) {}
        };
    }
} catch (_) {}
