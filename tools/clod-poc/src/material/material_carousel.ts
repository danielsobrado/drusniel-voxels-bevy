export const MATERIAL_SWATCH_PAGE_SIZE = 8;
export const TEXTURE_MODAL_PAGE_SIZE = 4;

export interface MaterialCarouselBounds {
  page: number;
  maxPage: number;
  start: number;
  end: number;
  needsCarousel: boolean;
}

export function materialCarouselBounds(
  materialCount: number,
  page: number,
  pageSize: number = MATERIAL_SWATCH_PAGE_SIZE,
): MaterialCarouselBounds {
  const needsCarousel = materialCount > pageSize;
  const maxPage = needsCarousel
    ? Math.max(0, Math.ceil(materialCount / pageSize) - 1)
    : 0;
  const clampedPage = Math.max(0, Math.min(page, maxPage));
  const start = clampedPage * pageSize;
  const end = Math.min(materialCount, start + pageSize);
  return { page: clampedPage, maxPage, start, end, needsCarousel };
}

export function materialCarouselPageForIndex(index: number, pageSize: number = MATERIAL_SWATCH_PAGE_SIZE): number {
  return Math.floor(index / pageSize);
}

export function materialCarouselPageForSelection(
  selectedIndex: number,
  currentPage: number,
  materialCount: number,
  pageSize: number = MATERIAL_SWATCH_PAGE_SIZE,
): number {
  const selectedPage = materialCarouselPageForIndex(selectedIndex, pageSize);
  const { start, end, page } = materialCarouselBounds(materialCount, currentPage, pageSize);
  if (selectedIndex >= start && selectedIndex < end) return page;
  return selectedPage;
}
