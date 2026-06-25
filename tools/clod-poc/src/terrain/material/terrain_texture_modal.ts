import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import { materialCarouselBounds, TEXTURE_MODAL_PAGE_SIZE } from "../../material_carousel.js";
import {
  INITIAL_TERRAIN_TEXTURE_COUNT,
  MAX_TERRAIN_TEXTURES,
  terrainTextureSlotLabel,
} from "../../terrain_textures.js";
import { iconDataUrl } from "../../ui/icons/index.js";
import { setButtonIcon } from "../../ui/dom_icons.js";
import { TERRAIN_BAND_ICONS } from "../../app/clod_constants.js";
import { BUILTIN_TERRAIN_TEXTURES } from "./terrain_builtin_textures.js";
import {
  loadNormalMap,
  loadTerrainTexture,
  loadTerrainTextureUrl,
  type TerrainTextureLoadOptions,
} from "./texture_loader.js";
import type { TerrainTextureController, TerrainTextureSlot } from "./terrain_texture_controller.js";

export interface TerrainTextureModalDeps {
  textureController: TerrainTextureController;
  textureLoadOptions: TerrainTextureLoadOptions;
  applyTerrainTextures: () => void;
  setLoadedTextureFiles: (value: string) => void;
  onBrushMaterialClamped: (maxIndex: number) => void;
}

export interface TerrainTextureModal {
  actions: {
    loadTexture: () => void;
    clearTexture: () => void;
  };
  refreshTextureState: () => void;
  syncTextureModalControls: () => void;
  updateTextureSlotPreviews: () => void;
  rebuildTextureSlotCards: () => void;
  bindLoadedTextureController: (controller: { updateDisplay: () => unknown }) => void;
  closeTextureModal: () => void;
}

export function createTerrainTextureModal(deps: TerrainTextureModalDeps): TerrainTextureModal {
  const { textureController, textureLoadOptions } = deps;
  const textureSlots = textureController.slots;

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

  let pendingNormalLoad: number | null = null;
  let pendingTextureLoad: number | "all" | null = null;
  const slotCards: HTMLElement[] = [];
  let loadedTextureController: { updateDisplay: () => unknown } | null = null;
  let syncTextureModalControls = () => {};

  const terrainIconForTexture = (slot: TerrainTextureSlot, index: number): string => {
    const id = `${slot.selectedId} ${slot.name}`.toLowerCase();
    if (id.includes("water")) return "water";
    if (id.includes("snow")) return "snow";
    if (id.includes("rock") || id.includes("cobble") || id.includes("bedrock")) return "rock";
    if (id.includes("sand")) return "sand";
    if (id.includes("earth") || id.includes("terracotta") || id.includes("bark")) return "earth";
    if (id.includes("grass") || id.includes("leaf")) return "grass";
    return TERRAIN_BAND_ICONS[index] ?? "earth";
  };

  const updateLoadedTextureDisplay = () => {
    const loaded = textureSlots
      .map((slot, index) => (slot.texture ? `${terrainTextureSlotLabel(index)}: ${slot.name}` : ""))
      .filter(Boolean);
    deps.setLoadedTextureFiles(loaded.length > 0 ? loaded.join(" | ") : "none");
    loadedTextureController?.updateDisplay();
  };

  const updateTextureSlotPreview = (index: number) => {
    const card = slotCards[index];
    if (!card) return;
    const slot = textureSlots[index];
    const preview = card.querySelector<HTMLElement>(".texture-preview");
    const name = card.querySelector<HTMLElement>(".texture-slot-name");
    const band = card.querySelector<HTMLElement>(".clod-texture-band");
    const badge = card.querySelector<HTMLElement>(".clod-material-badge");
    const isLoaded = slot.texture !== null;
    card.classList.toggle("is-loaded", isLoaded);
    card.classList.toggle("is-empty", !isLoaded);
    if (preview) {
      preview.style.backgroundImage = slot.previewUrl ? `url("${slot.previewUrl}")` : "";
      preview.style.setProperty("--clod-preview-icon", `url("${iconDataUrl("terrain", terrainIconForTexture(slot, index) as Parameters<typeof iconDataUrl>[1], 64)}")`);
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
    if (removeBtn) removeBtn.hidden = textureSlots.length <= INITIAL_TERRAIN_TEXTURE_COUNT;
  };

  const updateTextureSlotPreviews = () => {
    for (let i = 0; i < textureSlots.length; i++) updateTextureSlotPreview(i);
  };

  const textureOptionHtml = [
    `<option value="">None</option>`,
    ...BUILTIN_TERRAIN_TEXTURES.map((texture) => `<option value="${texture.id}">${texture.label}</option>`),
    `<option value="custom">Custom file...</option>`,
  ].join("");

  const refreshTextureState = () => {
    updateLoadedTextureDisplay();
    updateTextureSlotPreviews();
    syncTextureModalControls();
    deps.applyTerrainTextures();
  };

  const textureModal = document.createElement("div");
  textureModal.id = "texture-modal";
  textureModal.className = "clod-texture-dialog";
  textureModal.hidden = true;
  textureModal.innerHTML = `
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
  document.body.appendChild(textureModal);
  const texturePanel = textureModal.querySelector<HTMLElement>(".texture-panel")!;
  const texturePanelHeader = texturePanel.querySelector<HTMLElement>("header")!;
  let texturePanelDrag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
  const clampTexturePanelPosition = (left: number, top: number) => {
    const rect = texturePanel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    texturePanel.style.left = `${THREE.MathUtils.clamp(left, 8, maxLeft)}px`;
    texturePanel.style.top = `${THREE.MathUtils.clamp(top, 8, maxTop)}px`;
    texturePanel.style.transform = "none";
  };
  texturePanelHeader.addEventListener("pointerdown", (event) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = texturePanel.getBoundingClientRect();
    texturePanelDrag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    texturePanelHeader.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  texturePanelHeader.addEventListener("pointermove", (event) => {
    if (!texturePanelDrag || texturePanelDrag.pointerId !== event.pointerId) return;
    clampTexturePanelPosition(event.clientX - texturePanelDrag.offsetX, event.clientY - texturePanelDrag.offsetY);
  });
  const stopTexturePanelDrag = (event: PointerEvent) => {
    if (!texturePanelDrag || texturePanelDrag.pointerId !== event.pointerId) return;
    texturePanelDrag = null;
    if (texturePanelHeader.hasPointerCapture(event.pointerId)) {
      texturePanelHeader.releasePointerCapture(event.pointerId);
    }
  };
  texturePanelHeader.addEventListener("pointerup", stopTexturePanelDrag);
  texturePanelHeader.addEventListener("pointercancel", stopTexturePanelDrag);
  const slotCarousel = textureModal.querySelector<HTMLElement>(".texture-slot-carousel")!;
  const slotGrid = textureModal.querySelector<HTMLElement>(".texture-slot-grid")!;
  const textureCarouselPrev = textureModal.querySelector<HTMLButtonElement>(".texture-carousel-prev")!;
  const textureCarouselNext = textureModal.querySelector<HTMLButtonElement>(".texture-carousel-next")!;
  let textureModalPage = 0;

  const syncTextureModalCarousel = () => {
    const count = textureSlots.length;
    const bounds = materialCarouselBounds(count, textureModalPage, TEXTURE_MODAL_PAGE_SIZE);
    textureModalPage = bounds.page;
    slotCarousel.classList.toggle("texture-slot-carousel-active", bounds.needsCarousel);
    textureCarouselPrev.disabled = bounds.page <= 0;
    textureCarouselNext.disabled = bounds.page >= bounds.maxPage;
    for (let i = 0; i < slotCards.length; i++) {
      const card = slotCards[i];
      if (!card) continue;
      card.style.display = !bounds.needsCarousel || (i >= bounds.start && i < bounds.end) ? "" : "none";
    }
    const addBtn = textureModal.querySelector<HTMLButtonElement>("[data-texture-add]")!;
    addBtn.disabled = textureSlots.length >= MAX_TERRAIN_TEXTURES;
  };

  const wireTextureSlotControls = (index: number) => {
    const card = slotCards[index];
    if (!card) return;
    card.querySelector<HTMLSelectElement>(`[data-slot-texture="${index}"]`)!.onchange = async (event) => {
      const select = event.target as HTMLSelectElement;
      const selectedId = select.value;
      emitAudio("texture.slot.select");
      if (selectedId === "") {
        textureController.clearTextureSlot(index);
        refreshTextureState();
        return;
      }
      if (selectedId === "custom") {
        pendingTextureLoad = index;
        textureInput.multiple = false;
        textureInput.click();
        syncTextureModalControls();
        return;
      }
      const builtin = BUILTIN_TERRAIN_TEXTURES.find((texture) => texture.id === selectedId);
      if (!builtin) return;
      const previousName = textureSlots[index].name;
      textureSlots[index].name = "loading...";
      updateTextureSlotPreview(index);
      const texture = await loadTerrainTextureUrl(builtin.url, textureLoadOptions);
      if (!texture) {
        textureSlots[index].name = previousName;
        select.value = textureSlots[index].selectedId;
        refreshTextureState();
        return;
      }
      textureController.setBuiltinTextureSlot(index, texture, builtin.label, builtin.url, builtin.id);
      refreshTextureState();
    };
    card.querySelector<HTMLInputElement>(`[data-slot-low="${index}"]`)!.onchange = (event) => {
      textureSlots[index].heightMin = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    };
    card.querySelector<HTMLInputElement>(`[data-slot-high="${index}"]`)!.onchange = (event) => {
      textureSlots[index].heightMax = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    };
    card.querySelector<HTMLInputElement>(`[data-slot-scale="${index}"]`)!.onchange = (event) => {
      textureSlots[index].scale = Number((event.target as HTMLInputElement).value);
      refreshTextureState();
    };
  };

  const mountTextureSlotCard = (index: number) => {
    const card = document.createElement("article");
    card.className = "texture-slot clod-texture-slot is-empty";
    const bandIcon = iconDataUrl("terrain", (TERRAIN_BAND_ICONS[index] ?? "earth") as Parameters<typeof iconDataUrl>[1], 64);
    card.innerHTML = `
      <button class="texture-preview clod-texture-preview" type="button" style="--clod-preview-icon: url('${bandIcon}')">
        <span class="clod-texture-band">${terrainTextureSlotLabel(index)}</span>
        <span class="clod-material-badge">Empty</span>
      </button>
      <span class="texture-slot-name">empty</span>
      <label class="texture-slot-select"><span>Built-in texture</span><select data-slot-texture="${index}">${textureOptionHtml}</select></label>
      <div class="texture-slot-params">
        <label class="texture-slot-param"><span>Scale</span><input data-slot-scale="${index}" type="number" min="${1 / 512}" max="${1 / 8}" step="${1 / 512}" value="${textureSlots[index].scale}" /></label>
        <label class="texture-slot-param"><span>Low</span><input data-slot-low="${index}" type="number" min="0" max="128" step="1" value="${textureSlots[index].heightMin}" /></label>
        <label class="texture-slot-param"><span>High</span><input data-slot-high="${index}" type="number" min="0" max="128" step="1" value="${textureSlots[index].heightMax}" /></label>
      </div>
      <div class="texture-slot-normal">
        <button class="texture-normal-load" type="button">+ Normal map</button>
        <button class="texture-normal-clear" type="button" title="clear normal map">✕</button>
        <button class="texture-slot-remove" type="button" title="Remove material">Remove</button>
      </div>
    `;
    card.querySelector(".texture-preview")!.addEventListener("click", () => {
      pendingTextureLoad = index;
      textureInput.multiple = false;
      textureInput.click();
    });
    card.querySelector(".texture-normal-load")!.addEventListener("click", () => {
      pendingNormalLoad = index;
      normalInput.click();
    });
    card.querySelector(".texture-normal-clear")!.addEventListener("click", () => {
      textureController.clearSlotNormal(index);
      refreshTextureState();
    });
    card.querySelector(".texture-slot-remove")!.addEventListener("click", () => {
      removeTextureSlot(index);
    });
    slotCards[index] = card;
    slotGrid.appendChild(card);
    wireTextureSlotControls(index);
    updateTextureSlotPreview(index);
  };

  const rebuildTextureSlotCards = () => {
    slotGrid.replaceChildren();
    slotCards.length = 0;
    for (let i = 0; i < textureSlots.length; i++) mountTextureSlotCard(i);
    syncTextureModalCarousel();
  };

  const addTextureSlot = (refresh = true) => {
    if (textureSlots.length >= MAX_TERRAIN_TEXTURES) return;
    textureController.addEmptySlot();
    mountTextureSlotCard(textureSlots.length - 1);
    syncTextureModalCarousel();
    if (refresh) refreshTextureState();
  };

  const removeTextureSlot = (index: number) => {
    if (textureSlots.length <= INITIAL_TERRAIN_TEXTURE_COUNT) return;
    textureController.removeSlot(index);
    deps.onBrushMaterialClamped(textureSlots.length - 1);
    rebuildTextureSlotCards();
    refreshTextureState();
  };

  textureCarouselPrev.addEventListener("click", () => {
    textureModalPage = Math.max(0, textureModalPage - 1);
    syncTextureModalCarousel();
  });
  textureCarouselNext.addEventListener("click", () => {
    const { maxPage } = materialCarouselBounds(textureSlots.length, textureModalPage, TEXTURE_MODAL_PAGE_SIZE);
    textureModalPage = Math.min(maxPage, textureModalPage + 1);
    syncTextureModalCarousel();
  });

  rebuildTextureSlotCards();
  setButtonIcon(textureModal.querySelector<HTMLElement>("[data-texture-close]")!, "system", "warning", "Close");
  setButtonIcon(textureModal.querySelector<HTMLElement>("[data-texture-load-all]")!, "texture", "load", "Load custom set");
  setButtonIcon(textureModal.querySelector<HTMLElement>("[data-texture-clear]")!, "texture", "slot", "Clear");

  syncTextureModalControls = () => {
    for (let i = 0; i < textureSlots.length; i++) {
      const low = textureModal.querySelector<HTMLInputElement>(`[data-slot-low="${i}"]`);
      const high = textureModal.querySelector<HTMLInputElement>(`[data-slot-high="${i}"]`);
      const scale = textureModal.querySelector<HTMLInputElement>(`[data-slot-scale="${i}"]`);
      const select = textureModal.querySelector<HTMLSelectElement>(`[data-slot-texture="${i}"]`);
      if (low) low.value = String(textureSlots[i].heightMin);
      if (high) high.value = String(textureSlots[i].heightMax);
      if (scale) scale.value = String(textureSlots[i].scale);
      if (select) select.value = textureSlots[i].selectedId;
    }
    syncTextureModalCarousel();
  };

  textureModal.querySelector<HTMLElement>("[data-texture-add]")!.addEventListener("click", () => {
    addTextureSlot();
    textureModalPage = materialCarouselBounds(
      textureSlots.length,
      textureModalPage,
      TEXTURE_MODAL_PAGE_SIZE,
    ).maxPage;
    syncTextureModalCarousel();
  });
  textureModal.querySelector<HTMLElement>("[data-texture-load-all]")!.addEventListener("click", () => {
    pendingTextureLoad = "all";
    textureInput.multiple = true;
    textureInput.click();
  });

  const closeTextureModal = () => {
    if (!textureModal.hidden) {
      textureModal.hidden = true;
      emitAudio("texture.dialog.close");
    }
  };

  textureModal.querySelector<HTMLElement>("[data-texture-clear]")!.addEventListener("click", () => {
    textureController.clearAllTextures();
    refreshTextureState();
  });
  textureModal.querySelector<HTMLElement>("[data-texture-close]")!.addEventListener("click", closeTextureModal);
  textureModal.addEventListener("click", (event) => {
    if (event.target === textureModal) closeTextureModal();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeTextureModal();
  });

  normalInput.addEventListener("change", async () => {
    const file = normalInput.files?.[0];
    normalInput.value = "";
    if (file == null || pendingNormalLoad == null) return;
    emitAudio("texture.load.open");
    try {
      const result = await loadNormalMap(file, textureLoadOptions);
      if (result) {
        emitAudio("texture.load.success");
        textureController.setSlotNormal(
          pendingNormalLoad,
          result.texture,
          result.previewUrl,
          result.bytes,
          result.mimeType,
          result.extension,
        );
      } else {
        emitAudio("texture.load.error");
      }
    } catch {
      emitAudio("texture.load.error");
    }
    pendingNormalLoad = null;
    refreshTextureState();
  });

  textureInput.addEventListener("change", async () => {
    const files = Array.from(textureInput.files ?? []);
    if (files.length === 0) return;
    emitAudio("texture.load.open");
    try {
      if (pendingTextureLoad === "all") {
        const loaded = await Promise.all(files.slice(0, MAX_TERRAIN_TEXTURES).map((file) => loadTerrainTexture(file, textureLoadOptions)));
        const succeeded = loaded.some((x) => x !== null);
        if (succeeded) emitAudio("texture.load.success");
        else emitAudio("texture.load.error");
        loaded.forEach((result, index) => {
          while (textureSlots.length <= index) addTextureSlot(false);
          if (result) {
            textureController.setTextureSlot(
              index,
              result.texture,
              files[index].name,
              result.previewUrl,
              result.bytes,
              result.mimeType,
              result.extension,
            );
          }
        });
      } else if (typeof pendingTextureLoad === "number") {
        const result = await loadTerrainTexture(files[0], textureLoadOptions);
        if (result) {
          emitAudio("texture.load.success");
          textureController.setTextureSlot(
            pendingTextureLoad,
            result.texture,
            files[0].name,
            result.previewUrl,
            result.bytes,
            result.mimeType,
            result.extension,
          );
        } else {
          emitAudio("texture.load.error");
        }
      }
    } catch {
      emitAudio("texture.load.error");
    }
    pendingTextureLoad = null;
    refreshTextureState();
    textureInput.value = "";
  });

  const actions = {
    loadTexture: () => {
      syncTextureModalControls();
      updateTextureSlotPreviews();
      textureModal.hidden = false;
      emitAudio("texture.dialog.open");
    },
    clearTexture: () => {
      textureController.clearAllTextures();
      refreshTextureState();
    },
  };

  return {
    actions,
    refreshTextureState,
    syncTextureModalControls: () => syncTextureModalControls(),
    updateTextureSlotPreviews,
    rebuildTextureSlotCards,
    bindLoadedTextureController: (controller) => {
      loadedTextureController = controller;
    },
    closeTextureModal,
  };
}
