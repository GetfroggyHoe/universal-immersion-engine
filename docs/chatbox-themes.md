# UIE Chatbox Themes

UIE Chatbox is an optional overlay that reuses SillyTavern’s real composer (textarea + send/continue/regenerate buttons) so you keep feature parity while changing visuals.

## Theme Model
Themes are implemented via CSS variables applied to `#uie-chatbox-window`.

Current variables:
- `--cb-bg`: window background
- `--cb-card`: message bubble background
- `--cb-border`: window border color
- `--cb-accent`: speaker/name accent
- `--cb-text`: main text color
- `--cb-muted`: secondary text color

UIE also applies:
- `textScale` (percent-based font scaling)
- `highContrast` (CSS filter)
- `bgUrl` (optional background image overlay)

## Adding New Themes
1. Add a new key to `THEMES` in `chatbox.js`
2. Add an `<option>` to `#uie-chatbox-theme` in `chatbox.html`

The theme key should be lowercase and underscore-separated, for example `dark_fantasy`.

