import { describe, expect, it } from "vitest";
import {
  DRESSING_GRASS_CONTACT_FIELD_CAPACITY,
  dressingGrassContactRuntimeStats,
  registerDressingGrassContactField,
} from "./dressing_grass_contact_field.js";

describe("dressing grass-contact field runtime", () => {
  it("publishes only the newest registration", () => {
    const first = registerDressingGrassContactField();
    const second = registerDressingGrassContactField();
    first.commit(10, 20, 4);
    expect(dressingGrassContactRuntimeStats().contentRevision).toBe(0);
    second.commit(30, 40, 7);
    expect(dressingGrassContactRuntimeStats()).toMatchObject({
      registrationGeneration: second.generation,
      contentRevision: 7,
      active: true,
      readbacks: 0,
    });
    first.dispose();
    expect(dressingGrassContactRuntimeStats().active).toBe(true);
    second.dispose();
    expect(dressingGrassContactRuntimeStats().active).toBe(false);
  });

  it("uses the configured fixed-capacity topology", () => {
    expect(DRESSING_GRASS_CONTACT_FIELD_CAPACITY).toBe(192 * 192);
  });
});
