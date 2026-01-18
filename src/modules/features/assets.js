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
    const imgHtml = a.img ? `<div style="width:100%;aspect-ratio:1;border-radius:12px;background:#000;margin-bottom:8px;overflow:hidden;border:1px solid #444;"><img src="${a.img}" style="width:100%;height:100%;object-fit:cover;"></div>` : "";
    
    $l.append(`
        <div style="padding:12px;border-radius:16px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);display:flex;flex-direction:column;">
            ${imgHtml}
            <div style="font-weight:800;color:#eee;">${escapeHtml(name)}</div>
            ${a.description ? `<div style="font-size:11px;opacity:0.7;margin-top:4px;white-space:pre-wrap;">${escapeHtml(a.description)}</div>` : ""}
        </div>
    `);
  }
}
function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
