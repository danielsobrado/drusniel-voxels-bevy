import { describe, expect, it } from "vitest";
import {
  MATERIAL_SWATCH_PAGE_SIZE,
  materialCarouselBounds,
  materialCarouselPageForIndex,
  materialCarouselPageForSelection,
} from "./material_carousel.js";

describe("material carousel", () => {
  it("does not carousel eight or fewer materials", () => {
    const bounds = materialCarouselBounds(8, 0);
    expect(bounds.needsCarousel).toBe(false);
    expect(bounds.start).toBe(0);
    expect(bounds.end).toBe(8);
  });

  it("pages through more than eight materials", () => {
    const first = materialCarouselBounds(12, 0);
    expect(first.needsCarousel).toBe(true);
    expect(first.start).toBe(0);
    expect(first.end).toBe(MATERIAL_SWATCH_PAGE_SIZE);

    const second = materialCarouselBounds(12, 1);
    expect(second.start).toBe(MATERIAL_SWATCH_PAGE_SIZE);
    expect(second.end).toBe(12);
    expect(second.maxPage).toBe(1);
  });

  it("jumps to the page containing the selected material", () => {
    expect(materialCarouselPageForIndex(9)).toBe(1);
    expect(materialCarouselPageForSelection(9, 0, 12)).toBe(1);
    expect(materialCarouselPageForSelection(2, 1, 12)).toBe(0);
  });
});
