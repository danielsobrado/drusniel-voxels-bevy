import { emitAudio } from "../audio/index.js";
import { defaultSpellConfig, type SpellConfig } from "./spell_config.js";
import type { SpellVfxController } from "./spell_vfx_controller.js";

export interface SpellMenu {
  castFire: () => void;
  castWater: () => void;
  castAir: () => void;
  castEarth: () => void;
  castLightning: () => void;
  castFireball: () => void;
  dispose: () => void;
}

export interface SpellMenuDeps {
  config?: SpellConfig;
  root?: HTMLElement;
  /** In-scene VFX controller that plays the 3D spell effects. */
  controller?: SpellVfxController;
}

export function createSpellMenu(deps: SpellMenuDeps = {}): SpellMenu {
  const config = deps.config ?? defaultSpellConfig;
  const root = deps.root ?? ensureMenuRoot(config.menu.rootId);
  const shouldRemoveRoot = deps.root === undefined;
  const controller = deps.controller;
  let fireActiveReset = 0;
  let waterActiveReset = 0;
  let airActiveReset = 0;
  let earthActiveReset = 0;
  let lightningActiveReset = 0;
  let fireballActiveReset = 0;
  let dragOffset: { x: number; y: number } | null = null;

  root.replaceChildren();
  root.setAttribute("aria-label", "Spell menu");

  const title = document.createElement("span");
  title.className = "spell-menu-title";
  title.textContent = config.menu.title;

  const slots = document.createElement("div");
  slots.className = "spell-menu-slots";

  const fireButton = createSpellButton(`1 🔥 ${config.fire.label}`, `${config.fire.label} spell (1)`, () => castFire());
  const waterButton = createSpellButton(`2 💧 ${config.water.label}`, `${config.water.label} spell (2)`, () => castWater());
  const airButton = createSpellButton(`3 💨 ${config.air.label}`, `${config.air.label} spell (3)`, () => castAir());
  const earthButton = createSpellButton(`4 🪨 ${config.earth.label}`, `${config.earth.label} spell (4)`, () => castEarth());
  const lightningButton = createSpellButton(`5 ⚡ ${config.lightning.label}`, `${config.lightning.label} spell (5)`, () => castLightning());
  const fireballButton = createSpellButton(`6 ☄️ ${config.fireball.label}`, `${config.fireball.label} spell (6)`, () => castFireball());

  root.addEventListener("pointerdown", stopUiPropagation);
  root.addEventListener("click", stopUiPropagation);
  slots.append(fireButton, waterButton, airButton, earthButton, lightningButton, fireballButton);
  root.append(title, slots);

  title.addEventListener("pointerdown", onDragStart);

  function onDragStart(event: PointerEvent): void {
    if (!(event.target instanceof HTMLElement) || !title.contains(event.target)) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.transform = "none";
    root.style.bottom = "auto";
    root.style.right = "auto";
    root.classList.add("dragging");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
  }

  function onDragMove(event: PointerEvent): void {
    if (!dragOffset) return;
    root.style.left = `${event.clientX - dragOffset.x}px`;
    root.style.top = `${event.clientY - dragOffset.y}px`;
  }

  function onDragEnd(): void {
    dragOffset = null;
    root.classList.remove("dragging");
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
  }

  function castFire(): void {
    window.clearTimeout(fireActiveReset);
    fireButton.setAttribute("aria-pressed", "true");
    controller?.playFire(config.fire.castDurationMs);
    emitAudio("spell.fire.cast", { volume: config.fire.audio.volume, durationMs: config.fire.castDurationMs });
    fireActiveReset = window.setTimeout(() => fireButton.setAttribute("aria-pressed", "false"), config.fire.castDurationMs);
  }

  function castWater(): void {
    window.clearTimeout(waterActiveReset);
    waterButton.setAttribute("aria-pressed", "true");
    controller?.playWater(config.water.castDurationMs);
    emitAudio("spell.water.cast", { volume: config.water.audio.volume, durationMs: config.water.castDurationMs });
    waterActiveReset = window.setTimeout(() => waterButton.setAttribute("aria-pressed", "false"), config.water.castDurationMs);
  }

  function castAir(): void {
    window.clearTimeout(airActiveReset);
    airButton.setAttribute("aria-pressed", "true");
    controller?.playAir(config.air.castDurationMs);
    emitAudio("spell.air.cast", { volume: config.air.audio.volume, durationMs: config.air.castDurationMs });
    airActiveReset = window.setTimeout(() => airButton.setAttribute("aria-pressed", "false"), config.air.castDurationMs);
  }

  function castEarth(): void {
    window.clearTimeout(earthActiveReset);
    earthButton.setAttribute("aria-pressed", "true");
    const fired = controller?.playEarth(config.earth.castDurationMs);
    if (!fired) flashSpellMiss(earthButton);
    emitAudio("spell.earth.cast", { volume: config.earth.audio.volume, durationMs: config.earth.castDurationMs });
    earthActiveReset = window.setTimeout(() => earthButton.setAttribute("aria-pressed", "false"), config.earth.castDurationMs);
  }

  let missFlashReset = 0;
  function flashSpellMiss(button: HTMLButtonElement): void {
    window.clearTimeout(missFlashReset);
    button.classList.add("spell-miss");
    missFlashReset = window.setTimeout(() => button.classList.remove("spell-miss"), 280);
  }

  function castLightning(): void {
    window.clearTimeout(lightningActiveReset);
    lightningButton.setAttribute("aria-pressed", "true");
    controller?.playLightning(config.lightning.castDurationMs);
    emitAudio("spell.lightning.cast", { volume: config.lightning.audio.volume, durationMs: config.lightning.castDurationMs });
    lightningActiveReset = window.setTimeout(
      () => lightningButton.setAttribute("aria-pressed", "false"),
      config.lightning.castDurationMs,
    );
  }

  function castFireball(): void {
    window.clearTimeout(fireballActiveReset);
    fireballButton.setAttribute("aria-pressed", "true");
    controller?.playFireball(config.fireball.castDurationMs);
    emitAudio("spell.fireball.cast", { volume: config.fireball.audio.volume, durationMs: config.fireball.castDurationMs });
    fireballActiveReset = window.setTimeout(
      () => fireballButton.setAttribute("aria-pressed", "false"),
      config.fireball.castDurationMs,
    );
  }

  return {
    castFire,
    castWater,
    castAir,
    castEarth,
    castLightning,
    castFireball,
    dispose: () => {
      window.clearTimeout(fireActiveReset);
      window.clearTimeout(waterActiveReset);
      window.clearTimeout(airActiveReset);
      window.clearTimeout(earthActiveReset);
      window.clearTimeout(lightningActiveReset);
      window.clearTimeout(fireballActiveReset);
      window.clearTimeout(missFlashReset);
      fireActiveReset = 0;
      waterActiveReset = 0;
      airActiveReset = 0;
      earthActiveReset = 0;
      lightningActiveReset = 0;
      fireballActiveReset = 0;
      if (dragOffset) onDragEnd();
      title.removeEventListener("pointerdown", onDragStart);
      root.removeEventListener("pointerdown", stopUiPropagation);
      root.removeEventListener("click", stopUiPropagation);
      fireButton.remove();
      waterButton.remove();
      airButton.remove();
      earthButton.remove();
      lightningButton.remove();
      fireballButton.remove();
      if (shouldRemoveRoot) root.remove();
      else root.replaceChildren();
    },
  };
}

function createSpellButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", onClick);
  return button;
}

function ensureMenuRoot(rootId: string): HTMLElement {
  const existing = document.getElementById(rootId);
  if (existing) return existing;

  const root = document.createElement("nav");
  root.id = rootId;
  document.body.appendChild(root);
  return root;
}

function stopUiPropagation(event: Event): void {
  event.stopPropagation();
}
