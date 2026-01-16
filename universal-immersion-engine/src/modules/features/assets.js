import { getSettings } from "../core.js";
export async function init(){
  const s = getSettings(); if(!s) return;
  const list = s.inventory?.assets || [];
  const $l = $("#uie-assets-list"); if(!$l.length) return;
  $l.empty();
  if (!list.length){
    $l.append(`<div style="opacity:.7;">No assets yet.</div>`);
    return;
  }
  for (const a of list){
    const name = (a && (a.name||a.title)) ? (a.name||a.title) : "Asset";
    $l.append(`<div style="padding:12px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);font-weight:800;">${escapeHtml(name)}</div>`);
  }
}
function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
