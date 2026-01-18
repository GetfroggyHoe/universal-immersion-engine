export async function fetchTemplateHtml(url) {
  try {
    return await $.ajax({ url, method: "GET", timeout: 20000 });
  } catch (jqErr) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(url, { cache: "no-cache", credentials: "same-origin", signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (fetchErr) {
      console.error("[UIE] Template fetch failed", { url, jqErr, fetchErr });
      if (String(fetchErr?.name || "") === "AbortError") {
        const err = new Error(`Template fetch timed out: ${url}`);
        err.name = "UIETemplateTimeout";
        throw err;
      }
      throw fetchErr;
    }
  }
}
