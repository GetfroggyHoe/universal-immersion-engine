import { getContext } from "/scripts/extensions.js";

let bound = false;
let langResyncTries = 0;
let observerBound = false;
let applyQueued = false;
let stReverseBuiltForLang = "";
let stReverseIndex = null;

function getI18nextInstance() {
    try {
        const candidates = [];
        try { candidates.push(window.i18next); } catch (_) {}
        try { candidates.push(window.i18n); } catch (_) {}
        try { candidates.push(window.SillyTavern?.i18next); } catch (_) {}
        try { candidates.push(window.SillyTavern?.i18n); } catch (_) {}
        try {
            const ctx = getContext?.() || null;
            if (ctx) {
                candidates.push(ctx.i18next);
                candidates.push(ctx.i18n);
            }
        } catch (_) {}

        for (const c of candidates) {
            if (c && typeof c === "object" && typeof c.t === "function") return c;
        }

        // Last resort: scan a subset of window keys. Some builds don't expose i18next as window.i18next.
        try {
            const keys = Object.keys(window);
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                let v = null;
                try { v = window[k]; } catch (_) { continue; }
                if (!v || typeof v !== "object") continue;
                let hasT = false;
                try { hasT = typeof v.t === "function"; } catch (_) { hasT = false; }
                if (!hasT) continue;
                return v;
            }
        } catch (_) {}
    } catch (_) {}

    return null;
}

function scheduleLangResync() {
    if (langResyncTries >= 10) return;
    langResyncTries++;
    setTimeout(() => {
        try { applyI18n(document); } catch (_) {}
    }, 750);
}

function getSupportedLanguagesFromDom() {
    try {
        const out = [];
        const selects = Array.from(document.querySelectorAll("select")).filter((el) => {
            try {
                const id = String(el.id || "").toLowerCase();
                const name = String(el.name || "").toLowerCase();
                return id.includes("lang") || id.includes("language") || name.includes("lang") || name.includes("language");
            } catch (_) {
                return false;
            }
        });

        for (const sel of selects) {
            const opts = Array.from(sel.options || []);
            if (!opts.length) continue;

            const vals = [];
            for (const o of opts) {
                const v = String(o?.value || "").trim();
                if (!v) continue;
                if (v === "cimode") continue;
                if (v === "dev") continue;
                if (v === "debug") continue;
                if (!vals.includes(v)) vals.push(v);
            }

            if (vals.length >= 5) {
                for (const v of vals) if (!out.includes(v)) out.push(v);
            }
        }

        return out;
    } catch (_) {
        return [];
    }
}

const DICTS = {
    en: {
        "lang.en": "English",
        "lang.ko": "Korean",
        "settings.language": "Language",
        "settings.title.game_settings": "Game Settings",
        "settings.tab.general": "General",
        "settings.tab.menu": "Menu",
        "settings.tab.features": "Features",
        "settings.tab.automation": "Automation",
        "settings.tab.rpg": "RPG",
        "settings.tab.style": "Style",
        "settings.title.uie": "Universal Immersion Engine",
        "settings.tab.turbo": "Turbo API",
        "settings.tab.profiles": "Presets",
        "settings.tab.prompts": "Prompts",
        "settings.tab.popups": "Popups",
        "menu.title": "SYSTEM MENU",
        "menu.tab.main": "MAIN",
        "menu.tab.misc": "MISC",
        "menu.tab.system": "SYSTEM",
        "menu.inventory": "Inventory",
        "menu.shop": "Shop",
        "menu.journal": "Journal",
        "menu.party": "Party",
        "menu.diary": "Diary",
        "menu.social": "Social",
        "menu.stats": "Stats",
        "menu.activities": "Activities",
        "menu.phone": "Phone",
        "menu.map": "Map",
        "menu.reality": "Reality",
        "menu.calendar": "Calendar",
        "menu.databank": "Databank",
        "menu.war_room": "War Room",
        "menu.settings": "Settings",
        "menu.debug": "Debug",
        "menu.help_manual": "Help / Manual",
        "phone.books": "Books",
        "phone.books.guide": "Guide",
        "phone.books.library": "Library",
        "phone.manual.title": "UIE User Manual",
        "phone.manual.intro": "Welcome to the Universal Immersion Engine (UIE). This extension transforms your roleplay into a dynamic RPG experience. Tap a section below or use the \"Help\" buttons (?) found in various windows to jump to specific instructions.",
        "phone.common.delete": "Delete",
        "phone.common.save": "Save",
        "phone.msg.messages": "Messages",
        "phone.msg.block_unblock": "Block / Unblock contact",
        "phone.msg.text_number": "Text a number",
        "phone.msg.send_image": "Send image",
        "phone.msg.stickers": "Stickers",
        "phone.msg.placeholder": "Message...",
        "phone.dial.title": "Phone",
        "phone.dial.recents": "Recents",
        "phone.dial.clear": "Clear",
        "phone.dial.clear_log": "Clear call log",
        "phone.dial.del": "Del",
        "phone.dial.call": "Call",
        "phone.browser.back": "Back",
        "phone.browser.forward": "Forward",
        "phone.browser.placeholder": "Search or enter location...",
        "phone.browser.go": "Go",
        "phone.browser.save_page": "Save Page",
        "social.title": "SOCIAL MENU",
        "social.manage_contacts": "Manage Contacts",
        "social.menu.help_guide": "Help / Guide",
        "social.menu.scan_chat": "Scan Chat Log",
        "social.menu.auto_scan": "Auto Scan:",
        "social.menu.manual_add": "Manual Add",
        "social.menu.mass_delete": "Mass Delete",
        "social.menu.change_bg": "Change Background",
        "social.menu.change_heart": "Change Heart Icon",
        "social.tab.friends": "FRIENDS",
        "social.tab.associates": "ASSOCIATES",
        "social.tab.relationships": "RELATIONSHIPS",
        "social.tab.family": "FAMILY",
        "social.tab.rivals": "RIVALS",
        "social.delete.confirm": "CONFIRM DELETE",
        "social.delete.cancel": "CANCEL",
        "social.add.title": "CONTACT DETAILS",
        "social.add.upload_image": "Click to upload image",
        "social.add.image_url": "Image URL (Optional)",
        "social.add.name": "Name",
        "social.add.age": "Age",
        "social.add.known_family": "Known Family",
        "social.add.category": "Category",
        "social.add.category.friend": "Friend",
        "social.add.category.associate": "Associate",
        "social.add.category.relationship": "Relationship",
        "social.add.category.family": "Family",
        "social.add.category.rival": "Rival",
        "social.add.affinity": "Affinity (0-100)",
        "social.add.known_past": "Known from Past",
        "social.add.met_phys": "Met Physically",
        "social.add.family_role": "Family Role",
        "social.add.status": "Status",
        "social.add.more_details": "More Details",
        "social.add.background_notes": "Background / Notes",
        "social.add.birthday": "Birthday",
        "social.add.location": "Location",
        "social.add.likes": "Likes (comma sep)",
        "social.add.dislikes": "Dislikes (comma sep)",
        "social.add.save_contact": "Save Contact",
        "social.common.cancel": "Cancel",
        "social.common.edit": "Edit",
        "social.common.delete": "Delete",
        "social.common.add": "Add",
        "social.common.clear": "Clear",
        "social.profile.message": "Message",
        "social.profile.memories": "Memories",
        "social.field.birthday": "Birthday:",
        "social.field.location": "Location:",
        "social.field.age": "Age:",
        "social.field.known_family": "Known Family:",
        "social.field.family_role": "Family Role:",
        "social.field.status": "Status:",
        "social.field.presence": "Presence:",
        "social.field.likes": "Likes",
        "social.field.dislikes": "Dislikes",
        "social.memories.title": "Memories",
        "social.memories.scan": "Scan From Chat",
        "social.memories.inject": "Inject to Chat",
        "social.memories.empty": "— No memories saved —",
        "social.empty": "- Empty Page -",
        "inv.help": "Help",
        "inv.help_guide": "Help / Guide",
        "inv.edit_mode": "Edit Mode",
        "inv.creation_station": "Creation Station",
        "inv.create.quantity": "Quantity",
        "inv.create.run": "Create",
        "inv.create.generate_image": "Generate Image",
        "inv.create.desc_placeholder": "Describe what you’re creating (optional)…",
        "inv.create.kind.item": "Item",
        "inv.create.kind.class": "Create Class",
        "inv.create.kind.skill": "Skill",
        "inv.create.kind.asset": "Asset",
        "inv.create.kind.status": "Status Effects",
        "inv.create.scan_chat": "Scan Chat Log",
        "inv.create.scan_war_room": "Scan War Room",
        "inv.settings": "Inventory Settings",
        "inv.tabs.title": "Inventory Tabs",
        "inv.tab.items": "Items",
        "inv.tab.skills": "Skills",
        "inv.tab.assets": "Assets",
        "inv.tab.equipment": "Equipment",
        "inv.tab.equip": "Equip",
        "inv.tab.life": "Life",
        "inv.tab.create": "Create",
        "inv.functions.title": "Functions",
        "inv.fn.edit_pencil": "Edit Pencil",
        "inv.fn.creation_station": "Creation Station",
        "inv.fn.slot_types": "Slot Types (categories)",
        "inv.progression.title": "Progression",
        "inv.progression.leveling": "Leveling (XP → Level)",
        "inv.progression.show_bars": "Show Bars / Level / Stats",
        "inv.rebirth": "Initiate Rebirth",
        "inv.toggle_fullscreen": "Toggle Fullscreen",
        "inv.character": "Character",
        "inv.portrait": "Portrait",
        "inv.editor.title": "Item Editor",
        "inv.editor.name": "Name",
        "inv.editor.type": "Type",
        "inv.editor.description": "Description",
        "inv.editor.stat_mods": "Stat Modifiers",
        "inv.editor.status_effects": "Status Effects (comma-separated)",
        "inv.editor.pick_image": "Pick Image",
        "inv.common.add": "Add",
        "inv.common.save": "Save",
        "inv.common.close": "Close"
    },
    ko: {
        "lang.en": "영어",
        "lang.ko": "한국어",
        "settings.language": "언어",
        "settings.title.game_settings": "게임 설정",
        "settings.tab.general": "일반",
        "settings.tab.menu": "메뉴",
        "settings.tab.features": "기능",
        "settings.tab.automation": "자동화",
        "settings.tab.rpg": "RPG",
        "settings.tab.style": "스타일",
        "settings.title.uie": "유니버설 몰입 엔진",
        "settings.tab.turbo": "터보 API",
        "settings.tab.profiles": "프리셋",
        "settings.tab.prompts": "프롬프트",
        "settings.tab.popups": "팝업",
        "menu.title": "시스템 메뉴",
        "menu.tab.main": "메인",
        "menu.tab.misc": "기타",
        "menu.tab.system": "시스템",
        "menu.inventory": "인벤토리",
        "menu.shop": "상점",
        "menu.journal": "저널",
        "menu.party": "파티",
        "menu.diary": "일기",
        "menu.social": "소셜",
        "menu.stats": "스탯",
        "menu.activities": "활동",
        "menu.phone": "휴대폰",
        "menu.map": "지도",
        "menu.reality": "리얼리티",
        "menu.calendar": "달력",
        "menu.databank": "데이터뱅크",
        "menu.war_room": "전쟁실",
        "menu.settings": "설정",
        "menu.debug": "디버그",
        "menu.help_manual": "도움말 / 매뉴얼",
        "phone.books": "도서",
        "phone.books.guide": "가이드",
        "phone.books.library": "라이브러리",
        "phone.manual.title": "UIE 사용자 매뉴얼",
        "phone.manual.intro": "유니버설 몰입 엔진(UIE)에 오신 것을 환영합니다. 이 확장 기능은 롤플레이를 동적인 RPG 경험으로 바꿔줍니다. 아래 섹션을 누르거나, 다양한 창에 있는 \"도움말\" 버튼(?)을 사용해 필요한 안내로 바로 이동할 수 있습니다.",
        "phone.common.delete": "삭제",
        "phone.common.save": "저장",
        "phone.msg.messages": "메시지",
        "phone.msg.block_unblock": "연락처 차단/해제",
        "phone.msg.text_number": "번호로 문자",
        "phone.msg.send_image": "이미지 보내기",
        "phone.msg.stickers": "스티커",
        "phone.msg.placeholder": "메시지...",
        "phone.dial.title": "전화",
        "phone.dial.recents": "최근 통화",
        "phone.dial.clear": "지우기",
        "phone.dial.clear_log": "통화 기록 지우기",
        "phone.dial.del": "삭제",
        "phone.dial.call": "전화",
        "phone.browser.back": "뒤로",
        "phone.browser.forward": "앞으로",
        "phone.browser.placeholder": "검색하거나 주소 입력...",
        "phone.browser.go": "이동",
        "phone.browser.save_page": "페이지 저장",
        "social.title": "소셜 메뉴",
        "social.manage_contacts": "연락처 관리",
        "social.menu.help_guide": "도움말 / 가이드",
        "social.menu.scan_chat": "채팅 로그 스캔",
        "social.menu.auto_scan": "자동 스캔:",
        "social.menu.manual_add": "수동 추가",
        "social.menu.mass_delete": "대량 삭제",
        "social.menu.change_bg": "배경 변경",
        "social.menu.change_heart": "하트 아이콘 변경",
        "social.tab.friends": "친구",
        "social.tab.associates": "지인",
        "social.tab.relationships": "관계",
        "social.tab.family": "가족",
        "social.tab.rivals": "라이벌",
        "social.delete.confirm": "삭제 확인",
        "social.delete.cancel": "취소",
        "social.add.title": "연락처 정보",
        "social.add.upload_image": "클릭하여 이미지 업로드",
        "social.add.image_url": "이미지 URL(선택)",
        "social.add.name": "이름",
        "social.add.age": "나이",
        "social.add.known_family": "알려진 가족",
        "social.add.category": "분류",
        "social.add.category.friend": "친구",
        "social.add.category.associate": "지인",
        "social.add.category.relationship": "관계",
        "social.add.category.family": "가족",
        "social.add.category.rival": "라이벌",
        "social.add.affinity": "호감도(0-100)",
        "social.add.known_past": "과거부터 알고 있음",
        "social.add.met_phys": "직접 만남",
        "social.add.family_role": "가족 역할",
        "social.add.status": "상태",
        "social.add.more_details": "세부 정보",
        "social.add.background_notes": "배경 / 메모",
        "social.add.birthday": "생일",
        "social.add.location": "위치",
        "social.add.likes": "좋아하는 것(쉼표 구분)",
        "social.add.dislikes": "싫어하는 것(쉼표 구분)",
        "social.add.save_contact": "연락처 저장",
        "social.common.cancel": "취소",
        "social.common.edit": "편집",
        "social.common.delete": "삭제",
        "social.common.add": "추가",
        "social.common.clear": "지우기",
        "social.profile.message": "메시지",
        "social.profile.memories": "기억",
        "social.field.birthday": "생일:",
        "social.field.location": "위치:",
        "social.field.age": "나이:",
        "social.field.known_family": "알려진 가족:",
        "social.field.family_role": "가족 역할:",
        "social.field.status": "상태:",
        "social.field.presence": "존재:",
        "social.field.likes": "좋아하는 것",
        "social.field.dislikes": "싫어하는 것",
        "social.memories.title": "기억",
        "social.memories.scan": "채팅에서 스캔",
        "social.memories.inject": "채팅에 주입",
        "social.memories.empty": "— 저장된 기억 없음 —",
        "social.empty": "- 비어 있음 -",
        "inv.help": "도움말",
        "inv.help_guide": "도움말 / 가이드",
        "inv.edit_mode": "편집 모드",
        "inv.creation_station": "제작소",
        "inv.create.quantity": "수량",
        "inv.create.run": "생성",
        "inv.create.generate_image": "이미지 생성",
        "inv.create.desc_placeholder": "만들 항목을 설명하세요(선택)…",
        "inv.create.kind.item": "아이템",
        "inv.create.kind.class": "클래스 생성",
        "inv.create.kind.skill": "스킬",
        "inv.create.kind.asset": "자산",
        "inv.create.kind.status": "상태 효과",
        "inv.create.scan_chat": "채팅 로그 스캔",
        "inv.create.scan_war_room": "전쟁실 스캔",
        "inv.settings": "인벤토리 설정",
        "inv.tabs.title": "인벤토리 탭",
        "inv.tab.items": "아이템",
        "inv.tab.skills": "스킬",
        "inv.tab.assets": "자산",
        "inv.tab.equipment": "장비",
        "inv.tab.equip": "장비",
        "inv.tab.life": "생활",
        "inv.tab.create": "생성",
        "inv.functions.title": "기능",
        "inv.fn.edit_pencil": "연필 편집",
        "inv.fn.creation_station": "제작소",
        "inv.fn.slot_types": "슬롯 유형(카테고리)",
        "inv.progression.title": "성장",
        "inv.progression.leveling": "레벨링(XP → 레벨)",
        "inv.progression.show_bars": "바/레벨/스탯 표시",
        "inv.rebirth": "환생 시작",
        "inv.toggle_fullscreen": "전체 화면 전환",
        "inv.character": "캐릭터",
        "inv.portrait": "초상화",
        "inv.editor.title": "아이템 편집기",
        "inv.editor.name": "이름",
        "inv.editor.type": "유형",
        "inv.editor.description": "설명",
        "inv.editor.stat_mods": "스탯 수정치",
        "inv.editor.status_effects": "상태 효과(쉼표로 구분)",
        "inv.editor.pick_image": "이미지 선택",
        "inv.common.add": "추가",
        "inv.common.save": "저장",
        "inv.common.close": "닫기"
    }
};

const PHRASES = {
    ko: {
        "Backups": "백업",
        "Backup": "백업",
        "Backup Now": "지금 백업",
        "Restore": "복원",
        "Restore Latest": "최근 백업 복원",
        "Export JSON": "JSON 내보내기",
        "Import JSON": "JSON 가져오기",
        "Save": "저장",
        "Load": "불러오기",
        "Close": "닫기",
        "Menu": "메뉴",
        "Settings": "설정",
        "Inventory": "인벤토리",
        "Map": "지도",
        "Social": "소셜",
        "Phone": "휴대폰",
        "Party": "파티",
        "Journal": "저널",
        "Diary": "일기",
        "Calendar": "달력",
        "Databank": "데이터뱅크",
        "Library": "라이브러리",
        "Shop": "상점",
        "World": "월드",
        "Stats": "스탯",
        "Battle": "전투",
        "Activities": "활동",
        "Debug": "디버그"
    }
};

function resolveUieKey(key, fallback) {
    const k = String(key || "").trim();
    const fb = fallback != null ? String(fallback) : "";
    if (!k) return fb;

    try {
        const lang = getLang();
        const base = String(lang || "en").split("-")[0];
        const dict = DICTS[lang] || DICTS[base] || DICTS.en || {};
        if (Object.prototype.hasOwnProperty.call(dict, k)) return String(dict[k]);
    } catch (_) {}

    return fb;
}

export function getLang() {
    try {
        const st = getI18nextInstance();
        const stLang = String(st?.resolvedLanguage || st?.language || "");
        if (stLang) return stLang;
    } catch (_) {}
    return "en";
}

export function setLang(lang) {
    try { void lang; } catch (_) {}
}

export function t(key, fallback) {
    return resolveUieKey(key, fallback != null ? fallback : key);
}

function flattenStrings(obj, prefix = "", out = []) {
    if (!obj || typeof obj !== "object") return out;
    for (const [k, v] of Object.entries(obj)) {
        const kk = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") out.push([kk, v]);
        else if (v && typeof v === "object" && !Array.isArray(v)) flattenStrings(v, kk, out);
    }
    return out;
}

function guessEnglishLangKey(storeData) {
    try {
        if (!storeData || typeof storeData !== "object") return "";
        if (storeData.en) return "en";
        const keys = Object.keys(storeData);
        for (const k of keys) {
            const s = String(k || "");
            if (s === "en" || s.startsWith("en-")) return s;
        }
    } catch (_) {}
    return "";
}

function buildStReverseIndex() {
    try {
        const st = getI18nextInstance();
        const storeData = st?.store?.data;
        if (!storeData || typeof storeData !== "object") return;

        const enKey = guessEnglishLangKey(storeData);
        if (!enKey) return;
        if (stReverseBuiltForLang === enKey && stReverseIndex) return;

        const entry = storeData[enKey];
        if (!entry || typeof entry !== "object") return;

        const map = new Map();
        for (const [ns, nsObj] of Object.entries(entry)) {
            if (!nsObj || typeof nsObj !== "object") continue;
            const pairs = flattenStrings(nsObj);
            for (const [key, val] of pairs) {
                const v = String(val || "").trim();
                if (!v) continue;
                const norm = v.toLowerCase();
                if (!map.has(norm)) map.set(norm, { ns, key });
            }
        }

        stReverseIndex = map;
        stReverseBuiltForLang = enKey;
    } catch (_) {}
}

function stTranslateByEnglishPhrase(text) {
    try {
        const st = getI18nextInstance();
        if (!st || typeof st.t !== "function") return null;
        buildStReverseIndex();
        if (!stReverseIndex) return null;

        const raw = String(text || "").trim();
        if (!raw) return null;
        const hit = stReverseIndex.get(raw.toLowerCase());
        if (!hit) return null;
        const out = st.t(hit.key, { ns: hit.ns, defaultValue: raw });
        const s = String(out != null ? out : "").trim();
        if (!s) return null;
        if (s === raw) return null;
        return s;
    } catch (_) {
        return null;
    }
}

function translatePhrase(text) {
    try {
        const stHit = stTranslateByEnglishPhrase(text);
        if (stHit) return stHit;
        const lang = getLang();
        const base = String(lang || "en").split("-")[0];
        const dict = PHRASES[lang] || PHRASES[base] || null;
        if (!dict) return null;
        const k = String(text || "").trim();
        if (!k) return null;
        if (Object.prototype.hasOwnProperty.call(dict, k)) return String(dict[k]);
    } catch (_) {}
    return null;
}

function isLikelyUieRoot(el) {
    try {
        if (!el || el.nodeType !== 1) return false;
        const id = String(el.id || "");
        if (id.startsWith("uie")) return true;
        const cls = String(el.className || "");
        if (cls.includes("uie-")) return true;
        return false;
    } catch (_) {
        return false;
    }
}

function queueApply(root) {
    if (applyQueued) return;
    applyQueued = true;
    setTimeout(() => {
        applyQueued = false;
        try { applyI18n(root || document); } catch (_) {}
    }, 50);
}

function bindObserver() {
    if (observerBound) return;
    observerBound = true;
    try {
        const obs = new MutationObserver((mutations) => {
            try {
                for (const m of mutations) {
                    const nodes = m.addedNodes ? Array.from(m.addedNodes) : [];
                    for (const n of nodes) {
                        if (!n || n.nodeType !== 1) continue;
                        const el = /** @type {Element} */ (n);
                        if (isLikelyUieRoot(el) || el.querySelector?.("[id^='uie'], [class*='uie-']")) {
                            queueApply(el);
                            return;
                        }
                    }
                }
            } catch (_) {}
        });
        obs.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
}

function getSupportedLanguages() {
    try {
        const st = getI18nextInstance();
        const list =
            (Array.isArray(st?.options?.supportedLngs) ? st.options.supportedLngs : null) ||
            (Array.isArray(st?.services?.languageUtils?.options?.supportedLngs)
                ? st.services.languageUtils.options.supportedLngs
                : null) ||
            (Array.isArray(st?.languages) ? st.languages : null) ||
            (st?.store?.data && typeof st.store.data === "object" ? Object.keys(st.store.data) : null) ||
            null;
        if (list && list.length) {
            const out = [];
            for (const it of list) {
                const c = String(it || "").trim();
                if (!c) continue;
                if (c === "cimode") continue;
                if (c === "dev") continue;
                if (c === "debug") continue;
                if (!out.includes(c)) out.push(c);
            }
            return out.length ? out : ["en"];
        }
    } catch (_) {}

    try {
        const dom = getSupportedLanguagesFromDom();
        if (dom && dom.length) return dom;
    } catch (_) {}

    return ["en", "ko"];
}

function getLanguageLabel(code, displayLocale) {
    const c = String(code || "").trim();
    if (!c) return "";
    const base = c.split("-")[0];
    try {
        const dn = (typeof Intl !== "undefined" && Intl.DisplayNames)
            ? new Intl.DisplayNames([displayLocale || "en"], { type: "language" })
            : null;
        const name = dn ? dn.of(base) : "";
        if (name) {
            if (c.includes("-")) return `${name} (${c})`;
            return name;
        }
    } catch (_) {}
    return c;
}

function syncLanguageSelect(el) {
    if (!el) return;
    const supported = getSupportedLanguages();
    const active = getLang();
    const displayLocale = active || "en";

    const prevValue = String(el.value || "").trim();
    const keepScroll = el.scrollTop;

    el.innerHTML = "";

    const addOpt = (value, label) => {
        const opt = document.createElement("option");
        opt.value = String(value);
        opt.textContent = String(label);
        el.appendChild(opt);
    };

    addOpt("auto", "Auto (SillyTavern)");
    for (const code of supported) {
        const label = getLanguageLabel(code, displayLocale) || code;
        addOpt(code, label);
    }

    const candidates = [prevValue, active, "auto", "en"];
    let picked = "auto";
    for (const c of candidates) {
        if (!c) continue;
        if (el.querySelector(`option[value="${CSS.escape(String(c))}"]`)) { picked = c; break; }
    }
    el.value = picked;
    try { el.scrollTop = keepScroll; } catch (_) {}
}

export function applyI18n(root = document) {
    try {
        const base = root && root.nodeType ? root : document;
        const scope = base.querySelectorAll ? base : document;

        const lang = getLang();
        const baseLang = String(lang || "en").split("-")[0];

        // If ST i18n isn't ready yet, we may only see the fallback list. Retry briefly.
        try {
            const st = getI18nextInstance();
            const langs = getSupportedLanguages();
            if (!st || (Array.isArray(langs) && langs.length <= 2)) scheduleLangResync();
        } catch (_) {}

        const els = scope.querySelectorAll("[data-i18n], [data-i18n-placeholder], [data-i18n-title]");
        for (const el of Array.from(els)) {
            if (el.hasAttribute("data-i18n")) {
                const k = String(el.getAttribute("data-i18n") || "").trim();
                const fb = el.getAttribute("data-i18n-fallback") ?? el.textContent;
                let v = resolveUieKey(k, fb);
                if (String(v) === String(fb) && baseLang !== "en") {
                    const ph = translatePhrase(v);
                    if (ph) v = ph;
                }
                if (el.textContent !== v) el.textContent = v;
            }
            if (el.hasAttribute("data-i18n-placeholder")) {
                const k = String(el.getAttribute("data-i18n-placeholder") || "").trim();
                const fb = el.getAttribute("data-i18n-placeholder-fallback") ?? el.getAttribute("placeholder") ?? "";
                let v = resolveUieKey(k, fb);
                if (String(v) === String(fb) && baseLang !== "en") {
                    const ph = translatePhrase(v);
                    if (ph) v = ph;
                }
                if (el.getAttribute("placeholder") !== v) el.setAttribute("placeholder", v);
            }
            if (el.hasAttribute("data-i18n-title")) {
                const k = String(el.getAttribute("data-i18n-title") || "").trim();
                const fb = el.getAttribute("data-i18n-title-fallback") ?? el.getAttribute("title") ?? "";
                let v = resolveUieKey(k, fb);
                if (String(v) === String(fb) && baseLang !== "en") {
                    const ph = translatePhrase(v);
                    if (ph) v = ph;
                }
                if (el.getAttribute("title") !== v) el.setAttribute("title", v);
            }
        }

        // Phrase-based fallback for common UI labels/buttons.
        try {
            const candidates = scope.querySelectorAll("button, label, option, span, b, div");
            for (const el of Array.from(candidates)) {
                if (!el || el.nodeType !== 1) continue;
                if (el.hasAttribute("data-i18n")) continue;
                const tag = String(el.tagName || "").toLowerCase();
                if (tag === "option") {
                    // Don't touch language selectors.
                    const parent = el.parentElement;
                    const pid = String(parent?.id || "");
                    if (pid === "uie-lang-select" || pid === "uie-sw-lang-select") continue;
                }
                if (el.children && el.children.length) continue;
                const txt = String(el.textContent || "").trim();
                if (!txt) continue;
                const v = translatePhrase(txt);
                if (!v) continue;
                if (el.textContent !== v) el.textContent = v;
            }
        } catch (_) {}
    } catch (_) {}
}

export function initI18n() {
    if (bound) return;
    bound = true;

    applyI18n(document);
    try { scheduleLangResync(); } catch (_) {}
    try { bindObserver(); } catch (_) {}
}
