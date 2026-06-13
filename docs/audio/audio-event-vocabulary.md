# Game Audio Event Vocabulary

This document outlines the typed, event-based audio system added to the Drusniel Bevy runtime.

## Why Event-Based?

Drusniel uses a decoupled event-driven architecture to keep gameplay, UI, and rendering logic separated from audio playback implementation details:
1. **Decoupled Architecture**: Systems emit semantic events (`GameAudioEvent`) describing *what* occurred (e.g. `UiClick`, `InventoryOpen`) rather than directly playing a sound asset.
2. **Configuration-Driven**: A central configuration file (`audio_events.yaml`) defines volumes, cooldowns, and asset paths. We can mute, remap, or re-route sounds without modifying compile-time Rust logic.
3. **Throttling & Cooldowns**: Decoupled events can be automatically throttled (e.g., continuous digging or rapid UI hover) in a single unified system rather than scattering timers across dozens of different source files.

---

## Event Vocabulary

Events are configured in `assets/config/audio_events.yaml` and grouped into categories:

| Event ID (kebab-case) | Category | Description |
|---|---|---|
| **UI** | | |
| `ui-click` | `ui` | Main UI mouse click |
| `ui-hover` | `ui` | Main UI hover |
| `ui-error` | `ui` | UI operation error |
| `ui-warning` | `ui` | UI operation warning |
| `ui-success` | `ui` | UI operation success |
| `ui-toggle-on` | `ui` | UI toggle element turned on |
| `ui-toggle-off` | `ui` | UI toggle element turned off |
| **Menu / Settings** | | |
| `menu-open` | `ui` | Pause menu open |
| `menu-close` | `ui` | Pause menu close / resume |
| `settings-open` | `ui` | Settings dialog open |
| `settings-close` | `ui` | Settings dialog close |
| `settings-save` | `ui` | Settings saved to disk |
| `settings-tab-change` | `ui` | Settings category tab change |
| **Inventory / Hotbar** | | |
| `inventory-open` | `inventory` | Inventory screen open |
| `inventory-close` | `inventory` | Inventory screen close |
| `inventory-slot-select`| `inventory` | Inventory slot selected / hovered |
| `inventory-item-pick-up`| `inventory` | Pick up item from slot |
| `inventory-item-place` | `inventory` | Place item to slot / swap |
| `hotbar-select` | `inventory` | Choose active hotbar item slot |
| `hotbar-blocked` | `inventory` | Slot selection or usage blocked |
| **Map / Chat** | | |
| `map-open` | `map` | Fullscreen map overlay open |
| `map-close` | `map` | Fullscreen map overlay close |
| `chat-open` | `chat` | Chat input buffer open |
| `chat-close` | `chat` | Chat input buffer close / cancel |
| `chat-submit` | `chat` | Chat message submitted |
| `chat-error` | `chat` | Failed chat submission |
| **Terrain Tools** | | |
| `terrain-tool-select` | `terrain` | Selected terraform tool changes |
| `terrain-dig-start` | `terrain` | Block digging start |
| `terrain-dig-tick` | `terrain` | Continuous block dig progression / hit |
| `terrain-dig-stop` | `terrain` | Block digging stop |
| `terrain-raise` | `terrain` | Terrain raise tool action |
| `terrain-lower` | `terrain` | Terrain lower tool action |
| `terrain-smooth` | `terrain` | Terrain smooth tool action |
| `terrain-paint` | `terrain` | Terrain block placed |
| `terrain-brush-radius` | `terrain` | Brush radius adjusted |
| `terrain-edit-blocked` | `terrain` | Block edit blocked (e.g. protected, unbreakable) |
| **Build / Project / World** | | |
| `save-success` | `world` | Save world success |
| `save-error` | `world` | Save world error |
| `load-success` | `world` | Load world success |
| `load-error` | `world` | Load world error |
| `world-warning` | `world` | General world warning |
| `world-error` | `world` | General world error |
| **Debug / Render** | | |
| `debug-panel-open` | `debug` | Egui Game Tweaks panel open |
| `debug-panel-close` | `debug` | Egui Game Tweaks panel close |
| `debug-toggle-on` | `debug` | General debug toggle set to ON |
| `debug-toggle-off` | `debug` | General debug toggle set to OFF |
| `lod-toggle` | `debug` | LOD updates frozen or live |
| `wireframe-toggle` | `debug` | Wireframe overlay toggle |
| `naadf-toggle` | `debug` | NAADF split view toggle |
| `validation-warning` | `debug` | Validation check warning |
| `validation-error` | `debug` | Validation check error |

---

## How to Add a New Event

1. **Rust Enum**: Add the variant (in CamelCase) to the `AudioEventId` enum in `src/audio/events.rs`.
2. **YAML Config**: Add the event entry (in kebab-case matching Serde's serialization) under `events` in `assets/config/audio_events.yaml`:
   ```yaml
   events:
     my-new-event:
       enabled: true
       volume: 0.50
       cooldown_ms: 100
       category: ui
       asset: "audio/ui/my_new_sound.ogg"
   ```
3. **Emit**: In any Bevy system, write the message using `MessageWriter<GameAudioEvent>`:
   ```rust
   audio_events.write(GameAudioEvent::ui(AudioEventId::MyNewEvent));
   ```

---

## How Throttling Works

To prevent audio clipping and jank when events fire repeatedly (e.g. `terrain-dig-tick` while digging, or `ui-hover` when sweeping the mouse), `AudioThrottle` holds a timestamp cache of when each event was last played.
If the elapsed duration since the last play is less than the configured `cooldown_ms`, the system skips spawning the audio entity.

---

## Handling Missing Assets

- **Robust & Crash-Safe**: If an audio file is missing or not yet configured, the game **never panics or crashes**.
- **No Spam Logging**: Missing asset warnings are logged **once per session** in debug builds. In release builds, they fail silently or trace once to prevent console spam.

---

## References & Attribution

- The audio event vocabulary and lightweight feedback approach were inspired by the MIT-licensed `world-of-claudecraft` audio reference located under `docs/reference/world-of-claudecraft-audio`.
- **Procedural Music**: Music scheduling and generation are intentionally deferred; this layer strictly covers UI/interaction sounds.
