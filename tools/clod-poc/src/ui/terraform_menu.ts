import { emitAudio } from "../audio/index.js";
import type { BrushOp, BrushShape } from "../terrain/terrain.js";
import { PAINT_SWATCH_COLORS } from "../app/clod_constants.js";
import { materialCarouselBounds, materialCarouselPageForSelection } from "../material/material_carousel.js";
import { terrainTextureSlotLabel } from "../terrain/terrain_textures.js";
import type { ClodIconKind } from "./icons/index.js";
import { setButtonIcon } from "./dom_icons.js";
import type { TerrainMaterialController } from "../terrain/material/terrain_material_controller.js";

export interface TerraformMenuDeps {
  root: HTMLElement;
  state: {
    digRadius: number;
    brushOp: BrushOp;
    brushShape: BrushShape;
    brushMaterial: number;
    brushHeight: number;
    brushStrength: number;
    brushFalloff: number;
    brushFlowMs: number;
    terrainMaterialSource: string;
  };
  materialController: TerrainMaterialController;
  digRadiusController: { updateDisplay: () => unknown };
  updateInfo: () => void;
  bindTerraformEditCheckbox: (input: HTMLInputElement) => void;
  bindEditToggleInput: (input: HTMLInputElement) => void;
  onEditToggleChanged: (enabled: boolean) => void;
}

export interface TerraformMenu {
  readonly editCheckbox: HTMLInputElement;
  refreshSwatches: () => void;
  syncMenu: () => void;
}

export function createTerraformMenu(deps: TerraformMenuDeps): TerraformMenu {
  const activeTerrainSlots = () => deps.materialController.activeTerrainSlots();

  const menuHeader = document.createElement("div");
  menuHeader.className = "tf-menu-header";
  const paletteSection = document.createElement("div");
  paletteSection.className = "tf-palette";
  const editToggle = document.createElement("label");
  editToggle.className = "tf-edit-toggle";
  editToggle.title = "Show brush and sculpt controls";
  const editToggleInput = document.createElement("input");
  editToggleInput.type = "checkbox";
  editToggleInput.checked = true;
  deps.bindTerraformEditCheckbox(editToggleInput);
  deps.bindEditToggleInput(editToggleInput);
  editToggle.append(editToggleInput, document.createTextNode(" Edit"));
  editToggleInput.addEventListener("change", () => {
    document.body.dataset.tfEdit = editToggleInput.checked ? "true" : "false";
    deps.onEditToggleChanged(editToggleInput.checked);
  });
  menuHeader.appendChild(editToggle);
  deps.root.appendChild(menuHeader);
  deps.root.appendChild(paletteSection);
  const editSection = document.createElement("div");
  editSection.className = "tf-edit-section";
  deps.root.appendChild(editSection);
  document.body.dataset.tfEdit = "true";

  const makeRow = (label: string, parent: HTMLElement = deps.root) => {
    const row = document.createElement("div");
    row.className = "tf-row";
    const tag = document.createElement("span");
    tag.className = "tf-label";
    tag.textContent = label;
    row.appendChild(tag);
    parent.appendChild(row);
    return row;
  };

  const materialRow = makeRow("Material", paletteSection);
  materialRow.classList.add("tf-row-material");
  let materialSwatchPage = 0;
  const materialCarousel = document.createElement("div");
  materialCarousel.className = "tf-material-carousel";
  const carouselPrev = document.createElement("button");
  carouselPrev.type = "button";
  carouselPrev.className = "tf-carousel-nav tf-carousel-prev";
  carouselPrev.setAttribute("aria-label", "Previous materials");
  carouselPrev.textContent = "‹";
  const materialSwatches = document.createElement("div");
  materialSwatches.className = "tf-material-swatches";
  const carouselNext = document.createElement("button");
  carouselNext.type = "button";
  carouselNext.className = "tf-carousel-nav tf-carousel-next";
  carouselNext.setAttribute("aria-label", "Next materials");
  carouselNext.textContent = "›";
  materialCarousel.append(carouselPrev, materialSwatches, carouselNext);
  materialRow.appendChild(materialCarousel);
  const swatchButtons: HTMLButtonElement[] = [];
  const ensureSwatchButton = (index: number) => {
    while (swatchButtons.length <= index) {
      const slotIndex = swatchButtons.length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tf-swatch";
      const name = document.createElement("span");
      btn.appendChild(name);
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        deps.state.brushMaterial = slotIndex;
        refreshSwatches();
      });
      swatchButtons.push(btn);
      materialSwatches.appendChild(btn);
    }
  };
  const syncMaterialCarousel = () => {
    const count = activeTerrainSlots().length;
    const bounds = materialCarouselBounds(count, materialSwatchPage);
    materialSwatchPage = bounds.page;
    materialCarousel.classList.toggle("tf-material-carousel-active", bounds.needsCarousel);
    carouselPrev.disabled = bounds.page <= 0;
    carouselNext.disabled = bounds.page >= bounds.maxPage;
    for (let i = 0; i < swatchButtons.length; i++) {
      const visible = i < count && (!bounds.needsCarousel || (i >= bounds.start && i < bounds.end));
      swatchButtons[i].style.display = visible ? "" : "none";
    }
  };
  carouselPrev.addEventListener("click", () => {
    materialSwatchPage = Math.max(0, materialSwatchPage - 1);
    syncMaterialCarousel();
  });
  carouselNext.addEventListener("click", () => {
    const { maxPage } = materialCarouselBounds(activeTerrainSlots().length, materialSwatchPage);
    materialSwatchPage = Math.min(maxPage, materialSwatchPage + 1);
    syncMaterialCarousel();
  });

  const makeToggleGroup = <T extends string>(
    row: HTMLElement,
    options: { value: T; label: string; icon?: readonly [ClodIconKind, string] }[],
    get: () => T,
    set: (v: T) => void,
  ) => {
    const buttons = options.map(({ value, label, icon }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (icon) {
        const [kind, id] = icon;
        setButtonIcon(btn, kind, id, label);
      }
      btn.addEventListener("click", () => {
        set(value);
        sync();
        emitAudio("terrain.tool.select");
      });
      row.appendChild(btn);
      return { value, btn };
    });
    const sync = () => {
      for (const { value, btn } of buttons) btn.setAttribute("aria-pressed", String(get() === value));
    };
    sync();
    return sync;
  };

  const brushRow = makeRow("Brush", editSection);
  const sizeWrap = document.createElement("div");
  sizeWrap.className = "tf-size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "range";
  sizeInput.min = "1"; sizeInput.max = "8"; sizeInput.step = "0.5";
  sizeInput.value = String(deps.state.digRadius);
  const sizeOut = document.createElement("output");
  sizeOut.textContent = String(deps.state.digRadius);
  sizeInput.addEventListener("input", () => {
    deps.state.digRadius = Number(sizeInput.value);
    sizeOut.textContent = String(deps.state.digRadius);
    deps.digRadiusController.updateDisplay();
    deps.updateInfo();
    emitAudio("terrain.brush.radius");
  });
  sizeWrap.append(sizeInput, sizeOut);
  brushRow.appendChild(sizeWrap);

  const sizeGap = document.createElement("span");
  sizeGap.style.width = "8px";
  brushRow.appendChild(sizeGap);

  const syncOp = makeToggleGroup<BrushOp>(
    brushRow,
    [
      { value: "remove", label: "Dig", icon: ["tool", "dig"] },
      { value: "add", label: "Raise", icon: ["tool", "raise"] },
    ],
    () => deps.state.brushOp,
    (v) => { deps.state.brushOp = v; deps.updateInfo(); },
  );
  const spacer = document.createElement("span");
  spacer.style.width = "6px";
  brushRow.appendChild(spacer);
  makeToggleGroup<BrushShape>(
    brushRow,
    [
      { value: "sphere", label: "Sphere", icon: ["tool", "smooth"] },
      { value: "cube", label: "Cube", icon: ["tool", "lower"] },
      { value: "cylinder", label: "Cyl", icon: ["tool", "paint"] },
    ],
    () => deps.state.brushShape,
    (v) => { deps.state.brushShape = v; },
  );

  const makeSlider = (
    parent: HTMLElement,
    label: string,
    min: number, max: number, step: number,
    get: () => number, set: (v: number) => void,
    fmt: (v: number) => string = String,
  ) => {
    const group = document.createElement("div");
    group.className = "tf-slider";
    const lab = document.createElement("span");
    lab.className = "tf-slider-label";
    lab.textContent = label;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step);
    input.value = String(get());
    const out = document.createElement("output");
    out.textContent = fmt(get());
    input.addEventListener("input", () => {
      const v = Number(input.value);
      set(v);
      out.textContent = fmt(v);
      deps.updateInfo();
    });
    group.append(lab, input, out);
    parent.appendChild(group);
    return () => { input.value = String(get()); out.textContent = fmt(get()); };
  };

  const sculptRow = makeRow("Sculpt", editSection);
  sculptRow.classList.add("tf-row-sculpt");
  const syncStrength = makeSlider(
    sculptRow, "Strength", 0, 1, 0.05,
    () => deps.state.brushStrength, (v) => { deps.state.brushStrength = v; }, (v) => v.toFixed(2),
  );
  const syncHeight = makeSlider(
    sculptRow, "Height", 1, 16, 0.5,
    () => deps.state.brushHeight, (v) => { deps.state.brushHeight = v; },
  );
  const syncFalloff = makeSlider(
    sculptRow, "Falloff", 0, 1, 0.05,
    () => deps.state.brushFalloff, (v) => { deps.state.brushFalloff = v; }, (v) => v.toFixed(2),
  );
  const syncFlow = makeSlider(
    sculptRow, "Flow", 80, 600, 20,
    () => deps.state.brushFlowMs, (v) => { deps.state.brushFlowMs = v; }, (v) => `${v}ms`,
  );

  const refreshSwatches = () => {
    const slots = activeTerrainSlots();
    if (deps.state.brushMaterial >= slots.length) deps.state.brushMaterial = 0;
    materialSwatchPage = materialCarouselPageForSelection(
      deps.state.brushMaterial,
      materialSwatchPage,
      slots.length,
    );
    for (let i = 0; i < slots.length; i++) {
      ensureSwatchButton(i);
      const btn = swatchButtons[i];
      const slot = slots[i];
      const label = btn.firstChild as HTMLSpanElement;
      btn.disabled = deps.state.terrainMaterialSource === "external_pbr" && !slot.texture;
      btn.style.backgroundImage = slot.previewUrl ? `url("${slot.previewUrl}")` : "";
      btn.style.backgroundColor = slot.previewUrl ? "transparent" : PAINT_SWATCH_COLORS[i % PAINT_SWATCH_COLORS.length];
      const displayName = slot.name && slot.name !== "empty" ? slot.name : terrainTextureSlotLabel(i);
      label.textContent = displayName;
      btn.title = displayName;
      btn.setAttribute("aria-pressed", String(deps.state.brushMaterial === i && !btn.disabled));
    }
    syncMaterialCarousel();
  };

  const syncMenu = () => {
    sizeInput.value = String(deps.state.digRadius);
    sizeOut.textContent = String(deps.state.digRadius);
    syncOp();
    syncStrength(); syncHeight(); syncFalloff(); syncFlow();
  };

  refreshSwatches();

  return {
    editCheckbox: editToggleInput,
    refreshSwatches,
    syncMenu,
  };
}
