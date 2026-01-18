import { getSettings, saveSettings, updateVitals } from "../core.js";

export async function init(){
  const s = getSettings(); if(!s) return;
  renderStats(s);
  renderSkills(s);
}

function renderStats(s) {
    const $c = $("#uie-skills-stats");
    if (!$c.length) return;
    $c.empty();

    if (!s.character) s.character = {};
    if (!s.character.stats) s.character.stats = {};
    
    const pts = Number(s.character.statPoints || 0);
    if (pts > 0) {
        $c.append(`<div style="margin-bottom:8px;font-weight:900;color:#f1c40f;">Unspent Points: ${pts}</div>`);
    }

    const level = Number(s.character.level || 1);
    if (level >= 150) {
        $c.append(`
            <div style="margin-bottom:12px;padding:10px;border:1px solid rgba(241,196,15,0.3);background:rgba(241,196,15,0.1);border-radius:10px;text-align:center;">
                <div style="font-weight:900;color:#f1c40f;margin-bottom:4px;">Rebirth Available!</div>
                <div style="font-size:11px;opacity:0.8;margin-bottom:8px;">Reset Level to 1, but keep all Stats.</div>
                <button id="uie-rebirth-btn" style="padding:6px 12px;border-radius:6px;border:none;background:#f1c40f;color:#000;font-weight:900;cursor:pointer;">Rebirth</button>
            </div>
        `);
        $c.find("#uie-rebirth-btn").on("click", function(e) {
            e.preventDefault();
            if (!confirm("Rebirth? You will reset to Level 1, but keep all Stats.")) return;
            s.character.level = 1;
            s.xp = 0;
            s.maxXp = 1000;
            s.character.rebirths = (Number(s.character.rebirths) || 0) + 1;
            saveSettings();
            updateVitals();
            renderStats(s);
        });
    }

    const keys = ["str","dex","con","int","wis","cha","per","luk","agi","vit","end","spi"];
    const grid = $(`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(70px,1fr));gap:6px;"></div>`);
    
    for (const k of keys) {
        const val = Number(s.character.stats[k] || 10);
        const item = $(`
            <div style="display:flex;flex-direction:column;align-items:center;padding:6px;border-radius:10px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:10px;text-transform:uppercase;opacity:0.7;">${k}</div>
                <div style="font-size:15px;font-weight:900;">${val}</div>
                ${pts > 0 ? `<button class="uie-stat-add" data-stat="${k}" style="margin-top:4px;width:100%;border:none;background:rgba(241,196,15,0.2);color:#f1c40f;font-weight:900;border-radius:4px;cursor:pointer;font-size:12px;">+</button>` : ""}
            </div>
        `);
        grid.append(item);
    }
    $c.append(grid);
    
    $c.find(".uie-stat-add").off("click").on("click", function(e) {
        e.preventDefault();
        const k = $(this).data("stat");
        if (s.character.statPoints > 0) {
            s.character.statPoints--;
            s.character.stats[k] = (Number(s.character.stats[k]) || 10) + 1;
            saveSettings();
            updateVitals();
            renderStats(s);
        }
    });
}

function renderSkills(s) {
  const list = s.inventory?.skills || [];
  const $l = $("#uie-skills-list"); if(!$l.length) return;
  $l.empty();
  if (!list.length){
    $l.append(`<div style="opacity:.7;grid-column:1/-1;">No skills yet.</div>`);
    return;
  }
  for (const sk of list){
    const name = (sk && (sk.name||sk.title)) ? (sk.name||sk.title) : "Skill";
    const desc = sk.description || sk.desc || "";
    const imgHtml = sk.img ? `<div style="width:40px;height:40px;border-radius:8px;background:#000;margin-right:10px;overflow:hidden;flex-shrink:0;border:1px solid #444;"><img src="${sk.img}" style="width:100%;height:100%;object-fit:cover;"></div>` : "";
    
    $l.append(`
      <div style="padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);display:flex;align-items:start;">
        ${imgHtml}
        <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:13px;color:#eee;">${escapeHtml(name)}</div>
            ${desc ? `<div style="font-size:11px;opacity:0.7;margin-top:4px;white-space:pre-wrap;">${escapeHtml(desc)}</div>` : ""}
        </div>
      </div>
    `);
  }
}

function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}