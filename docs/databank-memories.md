# Databank Memories (Storage + Display)

## Data Flow
- **Storage location**: UIE stores databank entries in the extension settings object at `settings.databank` (array).
- **Write path (Archive Memory)**:
  - Reads the recent chat transcript from the DOM.
  - Calls the Turbo/system model and expects JSON `{ "title": "...", "summary": "..." }`.
  - Stores a normalized entry into `settings.databank` and persists via `saveSettings()`.
- **Read path (UI display)**:
  - When the Databank window opens, UIE ensures the Databank template is present, then runs `initDatabank()`.
  - `render()` pulls `settings.databank`, normalizes entries, converts them into display entries, and renders into `#uie-db-list`.

## Chat Scope
- Databank entries are **chat-scoped**: each SillyTavern chat keeps its own databank.
- If you switch chats and see an “empty” databank, it usually means you are in a different chat scope (not data loss).

## Supported Entry Formats
UIE normalizes multiple databank formats into a single display shape:
- **Archived memory files**: `{ id, created, date, title, summary }`
- **Lore-style entries** (from scanners): `{ id, created, date, key, entry }` or `{ key, content }`

Normalization guarantees:
- `id` is always a string
- `created` is always a timestamp
- `date` is always a user-readable string (best-effort)
- Lore entries are mapped into `title/summary` so they always display

## Display Behavior
- Entries render with:
  - Title + date
  - A type badge (`MEMORY` or `LORE`)
  - Wrapped text (`white-space: pre-wrap`, `word-break: break-word`) to prevent invisible/overflowing content
- Large datasets:
  - UI renders a limited number first and offers a **LOAD MORE** button to expand progressively.

## Error Handling
- Archive Memory:
  - Uses loose JSON parsing to handle code-fenced or slightly noisy model outputs.
  - Shows a user-visible error toast on failure and logs details to console.

## Performance Monitoring
- The last render time (ms) is stored at `window.UIE_lastDatabankRenderMs`.
  - This is meant for lightweight monitoring/debugging of large databanks.

## Edge Cases
- **Numeric IDs** from older entries are coerced to strings (also fixes delete behavior).
- **Special characters** are HTML-escaped during rendering to prevent markup injection and display corruption.
- **Missing template** is handled by lazy-loading `databank.html` when the Databank button is clicked.

