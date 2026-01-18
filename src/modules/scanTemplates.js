export const SCAN_TEMPLATES = {
    // --- INVENTORY ---
    inventory: {
        full: (charName, charPersona, partyContext, transcript) => `[UIE_LOCKED]
Analyze the chat log and extract NEW progression elements.
User: ${charName}
Persona: ${charPersona}
Party/Cards:
${partyContext}

Transcript:
${transcript}

Task: Return JSON with NEW Items, Skills, Assets, Life/Status Updates, and Equipment Changes.
Rules:
1. **Strictly JSON only**. No commentary, no conversational filler, no markdown blocks if possible (just raw JSON).
2. **Items**: New loot, currency, or unequipped items found/bought.
3. **Skills**: New skills learned or revealed (for User or Party).
4. **Assets**: New abstract resources (deeds, titles, knowledge).
5. **Life**: Updates to life trackers (HP, MP, Stress, etc.). "delta" for changes.
6. **Equipment**: Clothes/Gear the user is *currently wearing* or *changed into*.
   - If user changes clothes, the old outfit is unequipped.

Return ONLY JSON:
{
  "items": [{"name":"", "type":"item|weapon|currency", "qty":1, "desc":""}],
  "skills": [{"name":"", "desc":"", "type":"active|passive"}],
  "assets": [{"name":"", "desc":"", "category":""}],
  "life": [{"name":"TrackerName", "delta":0, "set":null, "max":null}],
  "equipped": [{"slotId":"Head|Body|MainHand|OffHand|Accessory", "name":"", "desc":"", "type":"armor|weapon"}]
}`,
        // Granular templates for specific tab scanning if implemented later
        items: (charName, transcript) => `[UIE_LOCKED]
Analyze chat for NEW ITEMS only.
User: ${charName}
Transcript:
${transcript}
Return ONLY JSON:
{ "items": [{"name":"", "type":"item|weapon|currency", "qty":1, "desc":""}] }`,
        
        skills: (charName, transcript) => `[UIE_LOCKED]
Analyze chat for NEW SKILLS learned.
User: ${charName}
Transcript:
${transcript}
Return ONLY JSON:
{ "skills": [{"name":"", "desc":"", "type":"active|passive"}] }`
    },

    // --- PARTY ---
    party: {
        roster: (currentMembers, transcript) => `[UIE_LOCKED]
Analyze the chat log to determine the ACTIVE PARTY MEMBERS (allies currently traveling/fighting with the User).
Exclude the User (You).
Exclude enemies or random NPCs unless they have clearly joined the group.

Current Roster: ${currentMembers || "None"}

Chat Log:
${transcript}

Return JSON ONLY (No markdown, no commentary):
{
  "active": [
    { "name": "Exact Name", "class": "Class/Archetype", "role": "Tank|Healer|DPS|Support", "level": 1 }
  ],
  "left": ["Name of anyone who explicitly LEFT the party"]
}`
    },

    // --- SOCIAL ---
    social: {
        contacts: (userName, transcript) => `[UIE_LOCKED]
Analyze the following chat transcript to find characters/people for the Social Contacts list.
User Name: "${userName}"

Transcript:
${transcript}

Task: Identify all characters (NPCs, people) mentioned or present in the story.
Return ONLY valid JSON (No markdown, no commentary):
{
  "found": [
    { "name": "Name", "role": "friend|rival|romance|family|associate|npc", "affinity": 50, "presence": "present|mentioned" }
  ]
}

Rules:
- "name": Extract the name exactly as it appears.
- "presence": "present" if physically in scene, "mentioned" if only talked about.
- "role": Guess relationship role.
- Exclude: The user ("${userName}"), "System", "Narrator", "Game Master".`,

        relationship: (nm, src, tx, prevAff, prevRole, prevMet) => `[UIE_LOCKED]
Analyze this interaction and update relationship info.
Character: ${nm}
Source: ${src}
Message:
${tx}

Current:
{"affinity":${prevAff},"role":"${prevRole}","met_physically":${prevMet}}

Return ONLY valid JSON (No markdown, no commentary):
{"delta":0,"role":"","notes":""}

Rules:
- delta is integer -10..10 representing affinity change due to this message tone.
- role is a short updated role/status label (can be empty to keep).`
    },

    // --- WAR ROOM ---
    warroom: {
        battle: (chat) => `[UIE_LOCKED]
You are a combat parser.
Return ONLY JSON (No markdown, no commentary):
{
  "active": true,
  "enemies": [{"name":"","hp":0,"maxHp":0,"level":0,"boss":false,"statusEffects":[""]}],
  "turnOrder": [""],
  "log": ["short combat log lines (newest last)"]
}
Rules:
- If no combat is happening, return {"active":false,"enemies":[],"turnOrder":[],"log":[]}
- Use conservative numbers; if unknown, keep previous values by omitting or setting null.
- statusEffects are short labels.

CHAT (recent messages):
${chat}`,

        rewards: (chat) => `[UIE_LOCKED]
Return ONLY JSON (No markdown, no commentary):
{
  "items":[{"name":"","type":"","description":"","rarity":"common|uncommon|rare|epic|legendary","qty":1}],
  "currency":0,
  "xp":0
}
Rules:
- Reward should match the battle and outcomes in the chat.
- 0-3 items max.
- currency and xp are integers >= 0.
CHAT:
${chat}`
    },

    // --- DATABANK ---
    databank: {
        archive: (rawLog) => `[UIE_LOCKED]
Task: Summarize this RP segment into a concise "Memory File" for long-term storage.
Input:
${rawLog}

Output JSON (No markdown, no commentary):
{ "title": "Short Title", "summary": "3-4 sentence summary of key events, names, and locations." }`
    },

    // --- WORLD STATE ---
    worldState: {
        unified: (s, lifeTrackers, statusEffects, socialNames, deletedNames, userName, chatSnippet) => `[UIE_LOCKED]
Analyze the chat history to update the RPG State.
Current World: ${JSON.stringify(s.worldState)}
Current HP: ${Number(s.hp ?? 100)} / ${Number(s.maxHp ?? 100)}
Current MP: ${Number(s.mp ?? 50)} / ${Number(s.maxMp ?? 50)}
Life Trackers: ${JSON.stringify(lifeTrackers)}
Current Status Effects: ${JSON.stringify(statusEffects)}
Existing Social Names: ${JSON.stringify(socialNames)}
Deleted Social Names: ${JSON.stringify(deletedNames)}

Task: Return a SINGLE JSON object with these keys:
1. "world": Update location, threat, status, time, weather.
2. "inventory": Object containing "added" (items found/acquired/created) and "removed" (items lost/used/given). Ignore currency.
3. "stats": { "hp": delta, "mp": delta, "xp": delta, "attributes": { "str": 0, "dex": 0, "con": 0, "int": 0, "wis": 0, "cha": 0 } } (Integer deltas)
4. "quests": List of new quest objects { "title": "...", "desc": "...", "type": "main|side" } if a NEW quest is explicitly given.
5. "lore": List of new lore objects { "key": "Term", "entry": "Description" } if NEW important lore is revealed.
6. "messages": List of { "from": "Name", "text": "..." } if a character sends a text message/SMS in the chat.
7. "life": (optional) { "lifeUpdates":[{"name":"","delta":0,"set":null,"max":null}], "newTrackers":[{"name":"","current":0,"max":100,"color":"#89b4fa","notes":""}] }
8. "statusEffects": (optional) { "add":[""], "remove":[""] } (NO EMOJIS)
9. "social": (optional) { "add":[{"name":"","role":"","affinity":50}], "remove":[""] } for ANY character present in the scene.
10. "skills": List of new skills learned/gained: [{ "name": "Name", "type": "active|passive", "desc": "Description" }]
11. "battle": (optional) { "active": true/false, "enemies": [{"name":"","hp":0,"maxHp":0,"statusEffects":[""]}], "turnOrder":[""] } if combat is happening.
12. "contacts": List of new phone contacts: [{ "name": "Name", "number": "123-456-7890", "avatar": "" }]

Rules:
- "inventory": CHECK AGGRESSIVELY. If the user picks up, buys, is given, creates, or finds an item, ADD IT. Examples: "grabbed wood", "found a lighter", "bought a sword".
- Structure for inventory: { "added": [{ "name": "Item Name", "type": "item|weapon|armor", "qty": 1, "desc": "Description" }], "removed": ["Item Name"] }
- "skills": CHECK AGGRESSIVELY. If the user learns, demonstrates, or is granted a new ability/skill, ADD IT.
- "social": Scan for ANY character names in the chat who are not in 'Existing Social Names'. If a character speaks or is described, ADD THEM.
- "social.add": [{ "name": "Name", "role": "friend|rival|romance|family", "affinity": 50 }]
- "battle": CHECK AGGRESSIVELY. If there is a fight, attack, or hostile entity, set "active": true and list enemies.
- "contacts": If the user saves a number, exchanges contacts, or receives a number, ADD IT.
- EXCLUDE from social: "${userName}", "System", "Narrator", "Game", "Omniscient", or any metadata card names.
- "world": Keep values short.
- If no change, omit the key or leave empty.
- Status effects should be short labels like "Tired", "Poisoned", "Smells like smoke". No emojis.
- Return ONLY JSON (No markdown, no commentary).

Chat:
${chatSnippet}`
    },
    
    // --- SOCIAL MEMORIES ---
    socialMemories: {
        scan: (personName, userName, transcript) => `[UIE_LOCKED]
You are extracting ONLY vital, relationship-relevant memories for the character "${personName}" about interactions with "${userName}".

Input transcript (may include omniscient tool cards / metadata; ignore anything that is not an in-world event or a durable fact):
${transcript}

Return ONLY valid JSON (no markdown, no extra keys):
{"memories":[{"text":"...","impact":"...","tags":["..."]}]}

Rules:
- 3 to 8 memories max. If none, return {"memories":[]}.
- Each memory must be a durable fact that CHANGED something: trust, fear, loyalty, obligation, romance, rivalry, plans, secrets, injuries, promises, betrayals, gifts, major discoveries.
- No trivial entries (no greetings, walking in, “they talked”, generic vibes).
- Be specific and consequence-based. 1–2 sentences per memory.
- Tags are short (e.g., "promise", "betrayal", "injury", "secret", "favor", "trauma", "trust").`
    }
};
