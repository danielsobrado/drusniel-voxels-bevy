import type { PlayerInteractionState } from "../player_controller.js";

const EDIT_TOGGLE_CODE = "KeyE";

export interface PlayerEditModeHotkeyDeps {
  interaction: Pick<PlayerInteractionState, "mode">;
  rendererElement: HTMLElement;
  playerModeButton: HTMLButtonElement;
  orbitModeButton: HTMLButtonElement;
  editCheckbox: HTMLInputElement;
}

export interface PlayerEditModeHotkey {
  dispose(): void;
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export function shouldTogglePlayerEdit(
  event: Pick<KeyboardEvent, "code" | "shiftKey" | "repeat">,
  mode: string,
): boolean {
  return mode === "playing"
    && event.code === EDIT_TOGGLE_CODE
    && event.shiftKey
    && !event.repeat;
}

function setEditEnabled(input: HTMLInputElement, enabled: boolean): void {
  document.body.dataset.tfEdit = enabled ? "true" : "false";
  if (input.checked === enabled) return;
  input.checked = enabled;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function installPlayerEditModeHotkey(deps: PlayerEditModeHotkeyDeps): PlayerEditModeHotkey {
  let wasPlaying = deps.interaction.mode === "playing";

  const disableForPlayerMode = (): void => setEditEnabled(deps.editCheckbox, false);

  if (wasPlaying) disableForPlayerMode();

  const onModeButton = (): void => {
    wasPlaying = false;
  };

  const onViewportPointerDown = (): void => {
    const playing = deps.interaction.mode === "playing";
    if (playing && !wasPlaying) disableForPlayerMode();
    wasPlaying = playing;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (isTextInput(event.target)) return;
    if (!shouldTogglePlayerEdit(event, deps.interaction.mode)) return;
    event.preventDefault();
    setEditEnabled(deps.editCheckbox, !deps.editCheckbox.checked);
  };

  deps.playerModeButton.addEventListener("click", onModeButton);
  deps.orbitModeButton.addEventListener("click", onModeButton);
  deps.rendererElement.addEventListener("pointerdown", onViewportPointerDown);
  window.addEventListener("keydown", onKeyDown);

  return {
    dispose() {
      deps.playerModeButton.removeEventListener("click", onModeButton);
      deps.orbitModeButton.removeEventListener("click", onModeButton);
      deps.rendererElement.removeEventListener("pointerdown", onViewportPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
