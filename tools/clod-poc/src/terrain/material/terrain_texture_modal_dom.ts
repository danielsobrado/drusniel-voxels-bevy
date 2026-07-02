import { materialCarouselBounds, TEXTURE_MODAL_PAGE_SIZE } from "../../material/material_carousel.js";
import { INITIAL_TERRAIN_TEXTURE_COUNT, terrainTextureSlotLabel } from "../../terrain/terrain_textures.js";
import { iconDataUrl } from "../../ui/icons/index.js";
import { TERRAIN_BAND_ICONS } from "../../app/clod_constants.js";
import { BUILTIN_TERRAIN_TEXTURES } from "./terrain_builtin_textures.js";
import { loadTerrainTextureUrl } from "./texture_loader.js";
import type { TerrainTextureLoadOptions } from "./texture_loader.js";
import type { TerrainTextureController, TerrainTextureSlot } from "./terrain_texture_controller.js";

export function terrainIconForTexture(slot: TerrainTextureSlot, index: number): string {
  const id = `${slot.selectedId} ${slot.name}`.toLowerCase();
  if (id.includes("water")) return "water";
  if (id.includes("snow")) return "snow";
  if (id.includes("rock") || id.includes("cobble") || id.includes("bedrock")) return "rock";
  if (id.includes("sand")) return "sand";
  if (id.includes("earth") || id.includes("ground") || id.includes("dirt") || id.includes("terracotta") || id.includes("bark")) return "earth";
  if (id.includes("grass") || id.includes("leaf")) return "grass";
  return TERRAIN_BAND_ICONS[index] ?? "earth";
}

export const TEXTURE_OPTION_HTML = [
  "<option value=\"\">None</option>",
  ...BUILTIN_TERRAIN_TEXTURES.map(
    (texture) => `<option value="${texture.id}">${texture.label}${texture.normalUrl ? " · PBR" : ""}</option>`,
  ),
  "<option value=\"custom\">Custom file...</option>",
].join("");

export function clampPanelPosition(panel: HTMLElement): { left: number; top: number; maxLeft: number; maxTop: number } {
  const rect = panel.getBoundingClientRect();
  const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
  const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
  return { left: 8, top: 8, maxLeft, maxTop };
}

export function createFileInputs(): { textureInput: HTMLInputElement; normalInput: HTMLInputElement } {
  const textureInput = document.createElement("input");
  textureInput.type = "file";
  textureInput.accept = "image/*";
  textureInput.multiple = true;
  textureInput.style.display = "none";
  document.body.appendChild(textureInput);
  const normalInput = document.createElement("input");
  normalInput.type = "file";
  normalInput.accept = "image/*";
  normalInput.style.display = "none";
  document.body.appendChild(normalInput);
  return { textureInput, normalInput };
}

export function createTextureModalElement(): HTMLDivElement {
  const modal = document.createElement("div");
  modal.id = "texture-modal";
  modal.className = "clod-texture-dialog";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="texture-panel clod-texture-dialog" role="dialog" aria-modal="true" aria-labelledby="texture-modal-title">
      <header>
        <h2 id="texture-modal-title">Terrain materials</h2>
        <button type="button" data-texture-close>Close</button>
      </header>
      <div class="texture-panel-body">
        <div class="texture-slot-carousel">
          <button type="button" class="texture-carousel-nav texture-carousel-prev" aria-label="Previous materials">‹</button>
          <div class="texture-slot-grid"></div>
          <button type="button" class="texture-carousel-nav texture-carousel-next" aria-label="Next materials">›</button>
        </div>
        <div class="texture-actions">
          <button type="button" data-texture-add>+ Add material</button>
          <button type="button" data-texture-load-all>Load custom set</button>
          <button type="button" data-texture-clear>Clear</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  return modal;
}

export function createSlotCardHTML(index: number, slot: TerrainTextureSlot): string {
  const bandIcon = iconDataUrl(
    "terrain",
    (TERRAIN_BAND_ICONS[index] ?? "earth") as Parameters<typeof iconDataUrl>[1],
    64,
  );
  return `
    <button class="texture-preview clod-texture-preview" type="button" style="--clod-preview-icon: url('${bandIcon}')">
      <span class="clod-texture-band">${terrainTextureSlotLabel(index)}</span>
      <span class="clod-material-badge">Empty</span>
    </button>
    <span class="texture-slot-name">empty</span>
    <label class="texture-slot-select"><span>Built-in texture</span><select data-slot-texture="${index}">${TEXTURE_OPTION_HTML}</select></label>
    <div class="texture-slot-params">
      <label class="texture-slot-param"><span>Scale</span><input data-slot-scale="${index}" type="number" min="${1 / 512}" max="${1 / 8}" step="${1 / 512}" value="${slot.scale}" /></label>
      <label class="texture-slot-param"><span>Low</span><input data-slot-low="${index}" type="number" min="0" max="128" step="1" value="${slot.heightMin}" /></label>
      <label class="texture-slot-param"><span>High</span><input data-slot-high="${index}" type="number" min="0" max="128" step="1" value="${slot.heightMax}" /></label>
    </div>
    <div class="texture-slot-normal">
      <button class="texture-normal-load" type="button">+ Normal map</button>
      <button class="texture-normal-clear" type="button" title="clear normal map">✕</button>
      <button class="texture-slot-remove" type="button" title="Remove material">Remove</button>
    </div>
  `;
}

export function updateSlotPreview(
  card: HTMLElement,
  slot: TerrainTextureSlot,
  index: number,
  slotCount: number,
): void {
  const preview = card.querySelector<HTMLElement>(".texture-preview");
  const name = card.querySelector<HTMLElement>(".texture-slot-name");
  const band = card.querySelector<HTMLElement>(".clod-texture-band");
  const badge = card.querySelector<HTMLElement>(".clod-material-badge");
  const isLoaded = slot.texture !== null;
  card.classList.toggle("is-loaded", isLoaded);
  card.classList.toggle("is-empty", !isLoaded);
  if (preview) {
    preview.style.backgroundImage = slot.previewUrl ? `url("${slot.previewUrl}")` : "";
    preview.style.setProperty(
      "--clod-preview-icon",
      `url("${iconDataUrl("terrain", terrainIconForTexture(slot, index) as Parameters<typeof iconDataUrl>[1], 64)}")`,
    );
    if (band) {
      band.textContent = terrainTextureSlotLabel(index);
    } else {
      preview.textContent = slot.previewUrl ? "" : terrainTextureSlotLabel(index);
    }
  }
  if (name) name.textContent = slot.texture ? slot.name : "empty";
  if (badge) badge.textContent = slot.texture ? "Loaded" : "Empty";
  const normalBtn = card.querySelector<HTMLElement>(".texture-normal-load");
  if (normalBtn) normalBtn.textContent = slot.normalTexture ? "Normal map ✓" : "+ Normal map";
  card.title = `${terrainTextureSlotLabel(index)} height texture`;
  const removeBtn = card.querySelector<HTMLButtonElement>(".texture-slot-remove");
  if (removeBtn) removeBtn.hidden = slotCount <= INITIAL_TERRAIN_TEXTURE_COUNT;
}

export function syncCarousel(
  slotCards: HTMLElement[],
  slotCarousel: HTMLElement,
  textureCarouselPrev: HTMLButtonElement,
  textureCarouselNext: HTMLButtonElement,
  textureModalPage: number,
  slotCount: number,
): number {
  const bounds = materialCarouselBounds(slotCount, textureModalPage, TEXTURE_MODAL_PAGE_SIZE);
  const page = bounds.page;
  slotCarousel.classList.toggle("texture-slot-carousel-active", bounds.needsCarousel);
  textureCarouselPrev.disabled = page <= 0;
  textureCarouselNext.disabled = page >= bounds.maxPage;
  for (let i = 0; i < slotCards.length; i++) {
    const card = slotCards[i];
    if (!card) continue;
    card.style.display =
      !bounds.needsCarousel || (i >= bounds.start && i < bounds.end) ? "" : "none";
  }
  return page;
}

export function syncControls(
  modal: HTMLElement,
  slots: TerrainTextureSlot[],
): void {
  for (let i = 0; i < slots.length; i++) {
    const low = modal.querySelector<HTMLInputElement>(`[data-slot-low="${i}"]`);
    const high = modal.querySelector<HTMLInputElement>(`[data-slot-high="${i}"]`);
    const scale = modal.querySelector<HTMLInputElement>(`[data-slot-scale="${i}"]`);
    const select = modal.querySelector<HTMLSelectElement>(`[data-slot-texture="${i}"]`);
    if (low) low.value = String(slots[i].heightMin);
    if (high) high.value = String(slots[i].heightMax);
    if (scale) scale.value = String(slots[i].scale);
    if (select) select.value = slots[i].selectedId;
  }
}

export function wireSlotSelect(
  card: HTMLElement,
  index: number,
  slots: TerrainTextureSlot[],
  controller: TerrainTextureController,
  refreshState: () => void,
  loadOptions: TerrainTextureLoadOptions,
  loadBuiltinNormalForSlot: (index: number, normalUrl: string | undefined) => Promise<void>,
  onCustomSelect: () => void,
): void {
  card.querySelector<HTMLSelectElement>(`[data-slot-texture="${index}"]`)!.onchange = async (event) => {
    const select = event.target as HTMLSelectElement;
    const selectedId = select.value;
    if (selectedId === "") {
      controller.clearTextureSlot(index);
      refreshState();
      return;
    }
    if (selectedId === "custom") {
      onCustomSelect();
      return;
    }
    const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === selectedId);
    if (!builtin) return;
    const previousName = slots[index].name;
    slots[index].name = "loading...";
    refreshState();
    const texture = await loadTerrainTextureUrl(builtin.url, loadOptions);
    if (!texture) {
      slots[index].name = previousName;
      select.value = slots[index].selectedId;
      refreshState();
      return;
    }
    controller.setBuiltinTextureSlot(index, texture, builtin.label, builtin.url, builtin.id);
    await loadBuiltinNormalForSlot(index, builtin.normalUrl);
    refreshState();
  };
}

export function wireSlotParams(
  card: HTMLElement,
  index: number,
  slots: TerrainTextureSlot[],
  refreshState: () => void,
): void {
  card.querySelector<HTMLInputElement>(`[data-slot-low="${index}"]`)!.onchange = (event) => {
    slots[index].heightMin = Number((event.target as HTMLInputElement).value);
    refreshState();
  };
  card.querySelector<HTMLInputElement>(`[data-slot-high="${index}"]`)!.onchange = (event) => {
    slots[index].heightMax = Number((event.target as HTMLInputElement).value);
    refreshState();
  };
  card.querySelector<HTMLInputElement>(`[data-slot-scale="${index}"]`)!.onchange = (event) => {
    slots[index].scale = Number((event.target as HTMLInputElement).value);
    refreshState();
  };
}

export function mountTextureSlotCard(
  slotGrid: HTMLElement,
  slotCards: HTMLElement[],
  index: number,
  slots: TerrainTextureSlot[],
  controller: TerrainTextureController,
  refreshState: () => void,
  loadOptions: TerrainTextureLoadOptions,
  loadBuiltinNormalForSlot: (index: number, normalUrl: string | undefined) => Promise<void>,
  onPreviewClick: () => void,
  onNormalLoad: () => void,
  onRemove: () => void,
): HTMLElement {
  const card = document.createElement("article");
  card.className = "texture-slot clod-texture-slot is-empty";
  card.innerHTML = createSlotCardHTML(index, slots[index]);
  card.querySelector(".texture-preview")!.addEventListener("click", onPreviewClick);
  card.querySelector(".texture-normal-load")!.addEventListener("click", onNormalLoad);
  card.querySelector(".texture-normal-clear")!.addEventListener("click", () => {
    controller.clearSlotNormal(index);
    refreshState();
  });
  card.querySelector(".texture-slot-remove")!.addEventListener("click", onRemove);
  slotCards[index] = card;
  slotGrid.appendChild(card);
  wireSlotSelect(card, index, slots, controller, refreshState, loadOptions, loadBuiltinNormalForSlot, onPreviewClick);
  wireSlotParams(card, index, slots, refreshState);
  updateSlotPreview(card, slots[index], index, slots.length);
  return card;
}
