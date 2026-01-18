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

CHAT (last 20 messages):
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
    }
};
