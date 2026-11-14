UI refactor: controls, docking, typed commands, TOML config

## What
- Docking: dockview with a 9-slice layout, saved and named layouts, panel reset, plugin panels, keyboard resize
- Controls on React Aria: button, input, text area, dropdown, table, tabs, slider, checkbox
- No raw form elements left in the features, enforced by lint with a baseline
- Data-driven UI: registries for settings, keybindings, panels, field editors and main menus
- Property grid and schema form as reusable blocks
- Config and themes: TOML dev config, TOML themes (lion, dark, light), theme studio, limits file
- Typed backend: all 106 Tauri commands go through tauri-specta, one generated bindings file, no second handler
- Loading: one resource hook and one abortable effect replace all hand-made cancel flags
- Tooling: lint with baseline, style lint, encoding check, folder map check, bundle measurement, golden menu test
- SSH tunnel: russh based tunnel, shared tunnels, loopback setup, key handling (earlier work in this branch)

## Fixes
- Window limit never applied: the UI sent camelCase names, the backend expects snake_case
- A docked panel could not be brought back: added panel layout reset and a layouts menu
- Dock crashed when a plugin panel was unregistered
- Typing in a table cell no longer jumps focus (type-ahead is ignored for inputs)

## Notes
- 765 UI tests, type check, lint, build and Rust check are green
- Not run in the Tauri app yet: docking, dropdowns and tables were only checked in tests and in the browser
- React Aria quirks handled: clicks bubble like native buttons, table headers redraw late, tables read typing as type-ahead
- Specta forbids 64-bit integers and raw JSON values, so those fields use number types and a JSON wrapper
- Left for later: project tree on React Aria Tree (own virtualisation) and splitting the large files
- Plan and decisions are in the refactor plan document
