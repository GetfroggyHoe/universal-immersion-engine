/**
 * Centralized feature HTML loader.
 * Inventory.js never fetches templates; features call this.
 */
export async function loadFeatureTemplate(featureName) {
  try {
    const { fetchTemplateHtml } = await import("./templateFetch.js");
    const name = String(featureName || "").trim();
    if (!name) return "";

    let root = String(window.UIE_BASEPATH || "scripts/extensions/third-party/universal-immersion-engine");
    root = root.replace(/^\/+|\/+$/g, "");

    const baseUrl = (() => {
      try {
        const u = String(window.UIE_BASEURL || "");
        if (u) return u.endsWith("/") ? u : `${u}/`;
      } catch (_) {}
      return "/scripts/extensions/third-party/universal-immersion-engine/";
    })();

    const urls = [
      `${baseUrl}src/templates/features/${name}.html`,
      `/${root}/src/templates/features/${name}.html`,
      `/scripts/extensions/third-party/universal-immersion-engine/src/templates/features/${name}.html`,
    ];

    for (const url of urls) {
      try {
        const html = await fetchTemplateHtml(url);
        if (String(html || "").trim()) return html;
      } catch (_) {}
    }

    return `<div style="padding:20px;color:#f38ba8;font-weight:900;">Failed to load ${name}.html</div>`;
  } catch (e) {
    console.error("[UIE] Failed to load feature template:", featureName, e);
    return `<div style="padding:20px;color:#f38ba8;font-weight:900;">Failed to load ${String(featureName || "").trim()}.html</div>`;
  }
}
