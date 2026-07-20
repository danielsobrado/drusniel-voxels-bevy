import { describe, expect, it } from "vitest";
import configText from "../../../config/probe_gi.yaml?raw";
import { parseProbeGiConfig } from "./config.js";
import { ProbeGiPublication } from "./publication.js";

 describe("probe GI publication", () => {
  it("double-buffers three SH textures per cascade below the storage budget", () => {
    const publication = new ProbeGiPublication(parseProbeGiConfig(configText).cascades);
    try {
      expect(publication.byteSize()).toBe(1_179_648);
      const active = publication.read("near").active;
      expect(active.shR.image.width).toBe(32);
      expect(active.shR.image.height).toBe(8);
      expect(active.shR.image.depth).toBe(32);
      publication.queueEmptyPublish(4);
      expect(publication.publishAtFrameBoundary(4)).toBe(false);
      expect(publication.publishAtFrameBoundary(5)).toBe(true);
    } finally {
      publication.dispose();
    }
  });
});
