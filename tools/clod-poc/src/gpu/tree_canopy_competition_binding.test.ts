import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const forest = vi.hoisted(() => ({
  active: vi.fn(),
  register: vi.fn(),
}));

vi.mock("../forest_lighting/index.js", () => ({
  activeForestLightingGpuTexture: forest.active,
  registerForestLightingGpuDevice: forest.register,
}));

import { TreeCanopyCompetitionBinding } from "./tree_canopy_competition_binding.js";

interface FakeTexture {
  readonly label: string;
  readonly view: object;
  readonly createView: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
}

function texture(label: string): FakeTexture {
  const view = { label: `${label}-view` };
  return {
    label,
    view,
    createView: vi.fn(() => view),
    destroy: vi.fn(),
  };
}

function device(fallback: FakeTexture) {
  return {
    createTexture: vi.fn(() => fallback),
    queue: { writeTexture: vi.fn() },
  } as unknown as GPUDevice;
}

describe("tree canopy competition binding", () => {
  beforeEach(() => {
    forest.active.mockReset();
    forest.register.mockReset();
    forest.active.mockReturnValue(null);
    vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, COPY_DST: 2 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts fail-open and registers the shared forest GPU device", () => {
    const fallback = texture("fallback");
    const gpuDevice = device(fallback);
    const binding = new TreeCanopyCompetitionBinding(gpuDevice);

    expect(forest.register).toHaveBeenCalledWith(gpuDevice);
    expect(binding.params()).toEqual({ worldCells: 1, resolution: 1, enabled: false });
    expect(binding.view()).toBe(fallback.view);
    expect(binding.rebindCount()).toBe(0);
  });

  it("rebinds only when the canonical detail texture identity changes", () => {
    const fallback = texture("fallback");
    const first = texture("first");
    const second = texture("second");
    const binding = new TreeCanopyCompetitionBinding(device(fallback));

    forest.active.mockReturnValue({ detailTexture: first, worldCells: 512, resolution: 128 });
    expect(binding.refresh()).toBe(true);
    expect(binding.params()).toEqual({ worldCells: 512, resolution: 128, enabled: true });
    expect(binding.view()).toBe(first.view);
    expect(binding.rebindCount()).toBe(1);

    forest.active.mockReturnValue({ detailTexture: first, worldCells: 1024, resolution: 128 });
    expect(binding.refresh()).toBe(false);
    expect(binding.params()).toEqual({ worldCells: 1024, resolution: 128, enabled: true });
    expect(binding.rebindCount()).toBe(1);

    forest.active.mockReturnValue({ detailTexture: second, worldCells: 1024, resolution: 256 });
    expect(binding.refresh()).toBe(true);
    expect(binding.view()).toBe(second.view);
    expect(binding.rebindCount()).toBe(2);
  });

  it("returns to the owned fallback without destroying shared textures", () => {
    const fallback = texture("fallback");
    const shared = texture("shared");
    const binding = new TreeCanopyCompetitionBinding(device(fallback));

    forest.active.mockReturnValue({ detailTexture: shared, worldCells: 512, resolution: 128 });
    binding.refresh();
    forest.active.mockReturnValue(null);
    expect(binding.refresh()).toBe(true);
    expect(binding.params().enabled).toBe(false);

    binding.destroy();
    expect(fallback.destroy).toHaveBeenCalledOnce();
    expect(shared.destroy).not.toHaveBeenCalled();
  });
});
