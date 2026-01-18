import { getSettings } from "./core.js";
import { fetchTemplateHtml } from "./templateFetch.js";

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
        // SVG Icon fallback in case image fails
        const launcherHtml = `
            <div id="uie-launcher" title="Open Menu">
                <svg viewBox="0 0 24 24" style="width:100%;height:100%;fill:none;stroke:#cba35c;stroke-width:2;display:none;" class="uie-launcher-fallback">
                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
            </div>`;
        $("body").append(launcherHtml);
        
        // Show SVG if background image fails to load (handled via CSS or error event usually, 
        // but here we just leave it hidden unless we need it. 
        // Actually, let's just rely on the CSS background image, but ensure the DIV is there.)
    }

    const required = ["menu", "inventory"];
    for (const f of required) {
        if ($(`#uie-${f === "menu" ? "main-menu" : `${f}-window`}`).length) continue;
        const urls = [
            `${baseUrl}src/templates/${f}.html`,
            `/scripts/extensions/third-party/universal-immersion-engine/src/templates/${f}.html`
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

    const optional = ['phone', 'calendar', 'debug', 'journal', 'social', 'diary', 'settings_window', 'shop', 'world', 'map', 'party', 'databank', 'battle', 'chatbox', 'launcher_options', 'sprites'];
    Promise.allSettled(
        optional.map(async (f) => {
            const url = `${baseUrl}src/templates/${f}.html`;
            const html = await fetchTemplateHtml(url);
            $("body").append(html);
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
                const html = await fetchTemplateHtml(`${baseUrl}src/templates/settings.html`);
                target.append($(html).attr("id", "uie-settings-block"));
            } catch(e) {}
        } else {
            setTimeout(inject, 2000);
        }
    };
    inject();
}
