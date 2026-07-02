import * as THREE from "three";
import { emitAudio } from "../../audio/index.js";
import { materialCarouselBounds, TEXTURE_MODAL_PAGE_SIZE } from "../../material/material_carousel.js";
import { INITIAL_TERRAIN_TEXTURE_COUNT, MAX_TERRAIN_TEXTURES } from "../../terrain/terrain_textures.js";
import { setButtonIcon } from "../../ui/dom_icons.js";
import { configureNormalTexture, loadNormalMap, loadTerrainTexture, loadTerrainTextureUrl } from "./texture_loader.js";
export type { TerrainTextureModalDeps, TerrainTextureModal } from "./terrain_texture_modal_types.js";
import type { TerrainTextureModalDeps, TerrainTextureModal } from "./terrain_texture_modal_types.js";
import {
  createFileInputs,
  createTextureModalElement,
  mountTextureSlotCard,
  syncCarousel,
  syncControls,
  updateSlotPreview,
} from "./terrain_texture_modal_dom.js";

export function createTerrainTextureModal(deps: TerrainTextureModalDeps): TerrainTextureModal {
  const { textureController, textureLoadOptions } = deps;
  const textureSlots = textureController.slots;
  const { textureInput, normalInput } = createFileInputs();

  let pendingNormalLoad: number | null = null;
  let pendingTextureLoad: number | "all" | null = null;
  const slotCards: HTMLElement[] = [];
  let loadedTextureController: { updateDisplay: () => unknown } | null = null;
  let syncTextureModalControls = () => {};

  const updateLoadedTextureDisplay = () => {
    const loaded = textureSlots
      .map((slot) => (slot.texture ? `${slot.name}` : ""))
      .filter(Boolean);
    deps.setLoadedTextureFiles(loaded.length > 0 ? loaded.join(" | ") : "none");
    loadedTextureController?.updateDisplay();
  };

  const updateTextureSlotPreview = (index: number) => {
    const card = slotCards[index];
    if (!card) return;
    updateSlotPreview(card, textureSlots[index], index, textureSlots.length);
  };

  const updateTextureSlotPreviews = () => {
    for (let i = 0; i < textureSlots.length; i++) updateTextureSlotPreview(i);
  };

  const refreshTextureState = () => {
    updateLoadedTextureDisplay();
    updateTextureSlotPreviews();
    syncTextureModalControls();
    deps.applyTerrainTextures();
  };

  const loadBuiltinNormalForSlot = async (index: number, normalUrl: string | undefined): Promise<void> => {
    if (!normalUrl) return;
    const normalTexture = await loadTerrainTextureUrl(normalUrl, textureLoadOptions);
    if (!normalTexture) return;
    configureNormalTexture(normalTexture, textureLoadOptions);
    textureController.setBuiltinSlotNormal(index, normalTexture, normalUrl);
  };

  const textureModal = createTextureModalElement();
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
    textureModalPage = syncCarousel(slotCards, slotCarousel, textureCarouselPrev, textureCarouselNext, textureModalPage, textureSlots.length);
    const addBtn = textureModal.querySelector<HTMLButtonElement>("[data-texture-add]")!;
    addBtn.disabled = textureSlots.length >= MAX_TERRAIN_TEXTURES;
  };

  const mountTextureSlot = (index: number) => {
    mountTextureSlotCard(
      slotGrid, slotCards, index, textureSlots, textureController,
      refreshTextureState, textureLoadOptions, loadBuiltinNormalForSlot,
      () => { pendingTextureLoad = index; textureInput.multiple = false; textureInput.click(); },
      () => { pendingNormalLoad = index; normalInput.click(); },
      () => removeTextureSlot(index),
    );
  };

  const rebuildTextureSlotCards = () => {
    slotGrid.replaceChildren();
    slotCards.length = 0;
    for (let i = 0; i < textureSlots.length; i++) mountTextureSlot(i);
    syncTextureModalCarousel();
  };

  const addTextureSlot = (refresh = true) => {
    if (textureSlots.length >= MAX_TERRAIN_TEXTURES) return;
    textureController.addEmptySlot();
    mountTextureSlot(textureSlots.length - 1);
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
    syncControls(textureModal, textureSlots);
    syncTextureModalCarousel();
  };

  textureModal.querySelector<HTMLElement>("[data-texture-add]")!.addEventListener("click", () => {
    addTextureSlot();
    textureModalPage = materialCarouselBounds(textureSlots.length, textureModalPage, TEXTURE_MODAL_PAGE_SIZE).maxPage;
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
        textureController.setSlotNormal(pendingNormalLoad, result.texture, result.previewUrl, result.bytes, result.mimeType, result.extension);
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
            textureController.setTextureSlot(index, result.texture, files[index].name, result.previewUrl, result.bytes, result.mimeType, result.extension);
          }
        });
      } else if (typeof pendingTextureLoad === "number") {
        const result = await loadTerrainTexture(files[0], textureLoadOptions);
        if (result) {
          emitAudio("texture.load.success");
          textureController.setTextureSlot(pendingTextureLoad, result.texture, files[0].name, result.previewUrl, result.bytes, result.mimeType, result.extension);
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
