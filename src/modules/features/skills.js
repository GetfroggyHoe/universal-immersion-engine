import { getSettings, saveSettings } from "../core.js";

function ensureSkillsModel(s) {
  if (!s.inventory || typeof s.inventory !== "object") s.inventory = {};
  if (!Array.isArray(s.inventory.skills)) s.inventory.skills = [];
}

function normalizeSkillType(v) {
  return String(v || "active").trim().toLowerCase() === "passive" ? "passive" : "active";
}

function normalizeLevel(value) {
  const digits = String(value ?? "").replace(/\D+/g, "").replace(/^0+(?=\d)/, "");
  return digits || "1";
}

function compareDecimal(a, b) {
  const aa = normalizeLevel(a);
  const bb = normalizeLevel(b);
  if (aa.length !== bb.length) return aa.length > bb.length ? 1 : -1;
  if (aa === bb) return 0;
  return aa > bb ? 1 : -1;
}

function addDecimal(a, b) {
  const x = normalizeLevel(a);
  const y = normalizeLevel(b);
  let i = x.length - 1;
  let j = y.length - 1;
  let carry = 0;
  let out = "";
  while (i >= 0 || j >= 0 || carry) {
    const da = i >= 0 ? Number(x[i]) : 0;
    const db = j >= 0 ? Number(y[j]) : 0;
    const sum = da + db + carry;
    out = String(sum % 10) + out;
    carry = Math.floor(sum / 10);
    i -= 1;
    j -= 1;
  }
  return normalizeLevel(out);
}

function subDecimal(a, b) {
  const x = normalizeLevel(a);
  const y = normalizeLevel(b);
  if (compareDecimal(x, y) <= 0) return "1";
  let i = x.length - 1;
  let j = y.length - 1;
  let borrow = 0;
  let out = "";
  while (i >= 0) {
    let da = Number(x[i]) - borrow;
    const db = j >= 0 ? Number(y[j]) : 0;
    if (da < db) {
      da += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    out = String(da - db) + out;
    i -= 1;
    j -= 1;
  }
  return normalizeLevel(out);
}

function smartStep(level) {
  const lv = normalizeLevel(level);
  const zeros = Math.max(0, lv.length - 2);
  return `1${"0".repeat(zeros)}`;
}

function normalizeSkill(raw) {
  if (!raw) return null;
  const name = String(raw.name || raw.title || raw.skill || "Skill").trim().slice(0, 80) || "Skill";
  const description = String(raw.description || raw.desc || "").trim().slice(0, 1200);
  const skillType = normalizeSkillType(raw.skillType || raw.type);
  const level = normalizeLevel(raw.level ?? raw.rank ?? raw.tier ?? "1");
  return {
    ...raw,
    kind: "skill",
    name,
    description,
    desc: description,
    type: skillType,
    skillType,
    level,
  };
}

function persistCard($card, mutate = null) {
  const idx = Number($card?.data("index"));
  if (!Number.isFinite(idx)) return;
  const s = getSettings();
  if (!s) return;
  ensureSkillsModel(s);
  if (!s.inventory.skills[idx]) return;

  const base = normalizeSkill(s.inventory.skills[idx]);
  if (!base) return;

  const draft = normalizeSkill({
    ...base,
    name: String($card.find(".uie-skill-name").val() || base.name),
    description: String($card.find(".uie-skill-desc").val() || ""),
    skillType: String($card.find(".uie-skill-type").val() || base.skillType),
    level: String($card.find(".uie-skill-level").val() || base.level),
  });
  if (!draft) return;

  const next = normalizeSkill(typeof mutate === "function" ? mutate(draft) : draft);
  if (!next) return;

  s.inventory.skills[idx] = { ...s.inventory.skills[idx], ...next, kind: "skill" };
  saveSettings(s);
  init();
}

export async function init(){
  const s = getSettings(); if(!s) return;
  ensureSkillsModel(s);
  const normalized = s.inventory.skills.map((x) => normalizeSkill(x)).filter(Boolean);
  if (JSON.stringify(normalized) !== JSON.stringify(s.inventory.skills)) {
    s.inventory.skills = normalized;
    saveSettings(s);
  }

  const list = s.inventory.skills;
  const $l = $("#uie-skills-list"); if(!$l.length) return;
  $l.empty();

  $(document)
    .off("click.uieSkillsAdd", "#uie-skills-add")
    .on("click.uieSkillsAdd", "#uie-skills-add", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const s2 = getSettings();
      if (!s2) return;
      ensureSkillsModel(s2);
      s2.inventory.skills.push(normalizeSkill({ name: "New Skill", description: "", skillType: "active", level: "1" }));
      saveSettings(s2);
      init();
    });
  
  // Bind events if not already bound
  if (!$l.data("eventsBound")) {
      $l.data("eventsBound", true);
      $l.on("click", ".uie-skill-del", function(e) {
          e.preventDefault(); e.stopPropagation();
          const idx = $(this).closest(".uie-skill-card").data("index");
          deleteSkill(idx);
      });
      $l.on("click", ".uie-skill-save", function(e) {
          e.preventDefault(); e.stopPropagation();
          persistCard($(this).closest(".uie-skill-card"));
      });
      $l.on("click", ".uie-skill-level-btn", function(e) {
          e.preventDefault(); e.stopPropagation();
          const $card = $(this).closest(".uie-skill-card");
          const act = String($(this).data("act") || "");
          persistCard($card, (draft) => {
              const cur = normalizeLevel(draft.level);
              const step = act.startsWith("smart") ? smartStep(cur) : "1";
              if (act === "plus" || act === "smart-plus") draft.level = addDecimal(cur, step);
              if (act === "minus" || act === "smart-minus") draft.level = subDecimal(cur, step);
              return draft;
          });
      });
  }
  
  if (!list.length){
    $l.append(`<div style="grid-column:1/-1;opacity:.7;">No skills learned. Use Create Station.</div>`);
  } else {
    for (let i = 0; i < list.length; i++){
      const sk = list[i];
      const name = (sk.name || "Skill");
      const desc = sk.description || sk.desc || "";
      const type = normalizeSkillType(sk.skillType || "active");
      const level = normalizeLevel(sk.level ?? "1");
      const typeColor = type === "active" ? "#ff6b6b" : "#4ecdc4"; 
      
      $l.append(`
          <div class="uie-skill-card" data-index="${i}" style="position:relative; padding:10px;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);display:flex;flex-direction:column;gap:8px;">
              <div style="display:flex;gap:8px;align-items:center;">
                  <input class="uie-skill-name" value="${escapeHtml(name)}" placeholder="Skill name" style="flex:1;min-width:0;background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:6px 8px;font-weight:800;">
                  <select class="uie-skill-type" style="width:90px;background:${typeColor}22;border:1px solid ${typeColor}44;color:${typeColor};border-radius:8px;padding:6px 4px;font-weight:800;">
                      <option value="active" ${type === "active" ? "selected" : ""}>Active</option>
                      <option value="passive" ${type === "passive" ? "selected" : ""}>Passive</option>
                  </select>
              </div>
              <textarea class="uie-skill-desc" placeholder="Description" style="width:100%;min-height:56px;resize:vertical;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,.12);color:#ddd;border-radius:8px;padding:6px 8px;">${escapeHtml(desc)}</textarea>
              <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                  <span style="font-size:11px;opacity:.75;font-weight:700;">Level</span>
                  <input class="uie-skill-level" inputmode="numeric" pattern="[0-9]*" value="${escapeHtml(level)}" style="width:116px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:6px 8px;font-weight:800;">
                  <button class="uie-skill-level-btn" data-act="minus" style="height:30px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:800;">-1</button>
                  <button class="uie-skill-level-btn" data-act="plus" style="height:30px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-weight:800;">+1</button>
                  <button class="uie-skill-level-btn" data-act="smart-minus" style="height:30px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#f8b4c7;cursor:pointer;font-weight:800;">Smart -</button>
                  <button class="uie-skill-level-btn" data-act="smart-plus" style="height:30px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:#a0f7bf;cursor:pointer;font-weight:800;">Smart +</button>
                  <button class="uie-skill-save" style="height:30px;padding:0 10px;border-radius:8px;border:1px solid rgba(46,204,113,.45);background:rgba(46,204,113,.18);color:#2ecc71;cursor:pointer;font-weight:800;">Save</button>
                  <button class="uie-skill-del" style="height:30px;padding:0 10px;border-radius:8px;border:1px solid rgba(255,68,68,.45);background:rgba(255,68,68,.16);color:#ff8e8e;cursor:pointer;font-weight:800;">Delete</button>
              </div>
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
    if (!s) return;
    ensureSkillsModel(s);
    s.inventory.skills.splice(idx, 1);
    saveSettings(s);
    init(); // Re-render
}

function escapeHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
