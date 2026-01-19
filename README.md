# Universal Immersion Engine (UIE)

![UIE Welcome](https://files.catbox.moe/57mm3n.jpg)

UIE is a full immersion overlay for SillyTavern: an in-world UI layer that turns chat into a playable RPG interface. It’s built to feel “real”, stay mobile-friendly, and keep your story coherent by driving features from the actual chat log (not random side-context).

## What You Get

### Phone System (Modern Immersion)
- Apps: Dial Pad, Contacts, Messages, Browser, Books, Calculator, Cookies
- **Guidebook (Books App)**: Comprehensive user manual with direct links from every feature window (look for the <i class="fa-solid fa-circle-question"></i> icon).
- **Library (Books App)**: Generate and read in-world lore books.
- Dial Pad is the default Phone dock action (Contacts stays as its own app)
- Contacts: auto-injected from Social (Friends/Relationships/Family/Rivals) while phone-added contacts persist in Phone
- Messages: block/unblock contacts, text any number, send images, import sticker packs, delete texts (single + mass delete)
- Calls + texts are story-driven and can reference recent chat context
- Cookies: clear saved web data, maps, books, world state, and saved numbers

### RPG Inventory (RPG-first UX)
- Fullscreen inventory shell (mobile-first) with window controls
- Items tab uses a tight lined RPG grid (no bubble cards) with real slot icons + large item art
- Edit pencil for character + inventory customization (including per-tab backgrounds)
- **Scan Chat Log**: One-click analysis of the chat to find new Items, Skills, Assets, Life Tracker updates, and Equipment changes.
- **Smart Equipment**: Automatically detects when you change clothes/gear in the story and swaps your equipped items (with AI-generated descriptions).
- **Mobile Optimized**: Equipment tab automatically switches to a focused grid view on mobile, hiding stats/portrait for better usability.
- **Leveling**: Earn XP and gain Stat Points to manually distribute (STR, DEX, etc.) in the Skills tab.
- **Creation Station**: Immersive in-menu builder for Items, Skills, Assets, and Classes. Includes **AI Image Generation** for visual flair.
- Gear menu toggles: disable tabs/functions, slot type categorization, leveling, and UI bars/stats
- Status effects render as icons (no emojis) with smart, on-screen info popovers

### War Room (Combat Tracking)
- One-click scan that reads recent chat and converts it into combat state: enemies, hp/max hp, status effects, turn order, and a combat log
- Optional post-battle rewards: can auto-generate items/currency/xp when combat ends (toggleable)
- Optional dice rolling (default OFF): when enabled, rolls inject into chat so the next AI reply can react to outcomes

### Party (RPG Party UI)
- Fullscreen mobile Party window + fullscreen member sheet
- Roles + Formation (Front/Mid/Back lanes) and Tactics presets/targeting settings
- Member vitals use sleek bars with numbers inside
- Member sheet is facts-first (read-only); editing lives in the Roster tab

### Databank + Journal + Diary
- Databank for world state/memories style tracking
- World State includes a manual Scan/Refresh action
- Databank entries are chat-scoped (each chat keeps its own archive/lore entries)
- Databank supports both “Memory Files” and scanner-saved lore entries (key/entry) in the same list
- Journal + diary tools for roleplay structure and record keeping (quest states include pending/active/completed/failed/abandoned)
- Stickers are user-imported packs (no built-in default pack)
- Diary supports copying/pasting images via clipboard (when supported by device/browser)

### Social
- Friends / Relationships / Family / Rivals, with profiles and richer relationship fields (family role + relationship status)
- Can auto-pull avatars from chat/character context when missing
- Social profiles include a Message action that opens a UIE Messaging thread
- **Scan Chat Log**: Uses deep analysis to find characters mentioned in the story and add them to your contacts.

### Calendar
- Full event tracking with fantasy/RP date support
- **Menu Dropdown**: Clean UI with options to Sync Time, Add Events, and Import/Export calendars.
- Mobile-optimized header and controls.

### Map (Instant World Generator)
- Instant map mode: generates a terrain canvas in under a second (math/noise-based)
- Optional AI naming for points of interest (text-only)

## Token Safety & Control
- Generated content is stored locally and re-opened without re-spending tokens
- Automation toggles exist per feature (phone browser pages/messages/calls, app builder, books, quests, databank scan, map, shop, loot/status)
- UI scale + launcher customization (includes the Fantasy Scroll icon option)
- Popup system is fully optional and customizable: master toggle, per-category toggles (quests/calls/messages/loot/xp/etc), and per-category popup CSS in the Settings “Popups” tab

## Strong Recommendations (Speed + Cost)
- Use Turbo API for fast, consistent generation routing.
- Pair it with a fast, low-cost model for most features (chat-driven scanners, map naming, phone replies).
- Good Turbo-model picks: Kimi K-2 Instruct, Gemini 2.5 Flash.
- Enable image generation only when you want it (it can be pointed at a Turbo/OpenAI-compatible images endpoint).
- Local image backends are supported: Stable Diffusion WebUI (`/sdapi/v1/txt2img`) and ComfyUI (`:8188` / `/prompt` with a workflow JSON).

## Installation
1. In SillyTavern, open Extensions.
2. Install from repository URL.
3. Reload SillyTavern.
4. Click the launcher to open the UIE menu.

## Quick Start
- Phone → Cookies: clear stored data / saved numbers
- Inventory → Gear: toggle tabs/functions, slot categories, leveling, UI bars
- Inventory → Pencil: set per-tab backgrounds and character details
- War Room: press Scan to sync combat state from the chat log
- Map: use Map Actions → Generate (Instant)

Built to sell immersion: fast to use, hard to break, and story-consistent by design.

## Dev / Tests
- Databank normalization regression tests:
  - `node universal-immersion-engine/tests/databankModel.test.js`
