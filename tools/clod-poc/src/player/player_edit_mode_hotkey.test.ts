import { describe, expect, it } from "vitest";
import { shouldTogglePlayerEdit } from "./player_edit_mode_hotkey.js";

describe("player edit mode hotkey", () => {
  it("toggles only for a non-repeating Shift+E press in player mode", () => {
    expect(shouldTogglePlayerEdit({ code: "KeyE", shiftKey: true, repeat: false }, "playing")).toBe(true);
    expect(shouldTogglePlayerEdit({ code: "KeyE", shiftKey: false, repeat: false }, "playing")).toBe(false);
    expect(shouldTogglePlayerEdit({ code: "KeyE", shiftKey: true, repeat: true }, "playing")).toBe(false);
    expect(shouldTogglePlayerEdit({ code: "KeyE", shiftKey: true, repeat: false }, "orbit")).toBe(false);
  });
});
