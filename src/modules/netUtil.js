
export function normalizeBaseUrl(url) {
    if (!url) return "";
    let u = String(url).trim();
    if (!u.match(/^https?:\/\//i)) {
        u = "http://" + u;
    }
    return u.replace(/\/+$/, "");
}

export async function tryJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
        throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return await res.json();
}
