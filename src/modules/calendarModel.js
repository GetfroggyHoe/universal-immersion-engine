function pad2(n) { return String(n).padStart(2, "0"); }

export function ymdFromDate(d) {
    if (!(d instanceof Date)) return "";
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmdAny(str) {
    const m = String(str || "").trim().match(/^(\d{1,6})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
    if (y < 1 || y > 999999) return null;
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;
    const d = new Date(y, mm - 1, dd);
    if (d.getFullYear() !== y || d.getMonth() !== (mm - 1) || d.getDate() !== dd) return null;
    return d;
}

export function advanceYmd(str, deltaDays) {
    const d = parseYmdAny(str);
    if (!d) return null;
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + Number(deltaDays || 0));
    return ymdFromDate(x);
}

export function monthKeyFromYmd(str) {
    const d = parseYmdAny(str);
    if (!d) return null;
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

