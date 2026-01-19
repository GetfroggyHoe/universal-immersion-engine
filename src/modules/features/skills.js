
import { getSettings, saveSettings } from "../core.js";

export function init() {
  render();
}

export function render() {
  const s = getSettings();
  if (!s) return;
  const list = document.getElementById("uie-skills-list");
  if (!list) return;
  
  list.innerHTML = "";
  
  const skills = Array.isArray(s.inventory?.skills) ? s.inventory.skills : [];
  
  if (skills.length === 0) {
    list.innerHTML = `<div style="opacity:0.6; font-style:italic;">No skills learned yet.</div>`;
    return;
  }
  
  skills.forEach(skill => {
    const el = document.createElement("div");
    el.className = "uie-skill-card";
    el.style.cssText = "background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); padding:10px; border-radius:8px;";
    
    const name = String(skill.name || "Skill");
    const desc = String(skill.description || skill.desc || "");
    const type = String(skill.type || skill.skillType || "Passive");
    
    el.innerHTML = `
      <div style="font-weight:bold; color:#f1c40f; margin-bottom:4px;">${name}</div>
      <div style="font-size:0.8em; color:rgba(255,255,255,0.7); margin-bottom:4px;">${type}</div>
      <div style="font-size:0.9em; line-height:1.4;">${desc}</div>
    `;
    list.appendChild(el);
  });
  
  // Update stats summary if needed
  const statsDiv = document.getElementById("uie-skills-stats");
  if (statsDiv) {
      statsDiv.innerHTML = `<div style="font-size:0.9em; opacity:0.8;">Total Skills: ${skills.length}</div>`;
  }
}
