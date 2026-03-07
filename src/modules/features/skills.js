import { getSettings, saveSettings } from "../core.js";

export async function init(){
  const s = getSettings(); if(!s) return;
  const list = s.inventory?.skills || [];
  const $l = $("#uie-skills-list"); if(!$l.length) return;
  $l.empty();
  
  // Bind events if not already bound
  if (!$l.data("eventsBound")) {
      $l.data("eventsBound", true);
      $l.on("click", ".uie-skill-del", function(e) {
          e.preventDefault(); e.stopPropagation();
          const idx = $(this).closest(".uie-skill-card").data("index");
          deleteSkill(idx);
      });
  }
  
  if (!list.length){
    $l.append(`<div style="grid-column:1/-1;opacity:.7;">No skills learned. Use Create Station.</div>`);
  } else {
    for (let i = 0; i < list.length; i++){
      const sk = list[i];
      const name = (sk.name || "Skill");
      const desc = sk.description || sk.desc || "";
      const type = String(sk.skillType || "passive").toLowerCase();
      const typeColor = type === "active" ? "#ff6b6b" : "#4ecdc4"; 
      
      $l.append(`
          <div class="uie-skill-card" data-index="${i}" style="position:relative; padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:4px;">
              <div style="font-weight:800;color:#fff;display:flex;justify-content:space-between;align-items:center;">
                  ${escapeHtml(name)}
                  <div style="display:flex;gap:5px;align-items:center;">
                      <span style="font-size:9px;text-transform:uppercase;padding:2px 4px;border-radius:4px;background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}44;">${type[0]}</span>
                      <button class="uie-skill-del" style="background:transparent;border:none;color:#ff4444;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;">×</button>
                  </div>
              </div>
              ${desc ? `<div style="font-size:11px;opacity:0.75;line-height:1.3;">${escapeHtml(desc)}</div>` : ""}
          </div>
      `);
    }
  }
  
  const $st = $("#uie-skills-stats");
  if ($st.length) {
      const cls = s.character?.className || "Adventurer";
      const lvl = s.character?.level || 1;
      $st.html(`<div style="opacity:0.8;font-size:12px;">Class: <span style="color:#f1c40f;font-weight:bold;">${escapeHtml(cls)}</span> <span style="opacity:0.5;margin:0 6px;">|</span> Level: <span style="color:#fff;font-weight:bold;">${lvl}</span></div>`);
  }
}

function deleteSkill(idx) {
    if (!confirm("Delete this skill?")) return;
    const s = getSettings();
    if (!s || !s.inventory || !s.inventory.skills) return;
    s.inventory.skills.splice(idx, 1);
    saveSettings(s);
    init(); // Re-render
}

function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
