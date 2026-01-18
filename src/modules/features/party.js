import { getSettings, saveSettings } from "../core.js";

export function renderParty(container){
  const s=getSettings();
  s.party ??= { members: [] };
  container.innerHTML = s.party.members.map(m=>`
    <div class="party-card" data-id="${m.id}">
      <img src="${m.images?.portrait||''}"/>
      <div>${m.name}</div>
    </div>`).join("");
}

export function init(){
  const pane=document.getElementById("pane");
  if(pane) renderParty(pane);
}