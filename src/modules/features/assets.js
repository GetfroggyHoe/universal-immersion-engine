import { getSettings } from "../core.js";
export async function init(){
  const s = getSettings(); if(!s) return;
  const list = s.inventory?.assets || [];
  const $l = $("#uie-assets-list"); if(!$l.length) return;
  $l.empty();
  if (!list.length){
    $l.append($("<div>").css({opacity:.7}).text("No assets yet."));
    return;
  }
  
  const template = document.getElementById("uie-asset-card-template");
  
  for (const a of list){
    const name = (a && (a.name||a.title)) ? (a.name||a.title) : "Asset";
    const category = String(a?.category || "other").trim();
    const owned = a?.owned !== false;
    
    const clone = template.content.cloneNode(true);
    const $card = $(clone).children().first();
    
    if (a.img) {
        $card.find(".asset-img-container").show();
        $card.find(".asset-img").attr("src", a.img);
    }
    
    $card.find(".asset-name").text(name);
    
    if (a.description) {
        $card.find(".asset-desc").text(a.description).show();
    }

    if (category || owned) {
        const chips = [];
        if (category) chips.push(category);
        if (owned) chips.push("owned");
        $card.find(".asset-desc").append(`<div style="margin-top:6px;opacity:.8;font-size:.85em;">${escapeHtml(chips.join(" • "))}</div>`);
    }
    
    $l.append($card);
  }
}
function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
