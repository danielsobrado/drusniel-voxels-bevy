import { describe, expect, it } from "vitest";
import {
  FAR_SUMMARY_ATLAS_UPLOAD_FALLBACK_REASON_CODE,
  FAR_SUMMARY_ATLAS_UPLOAD_MODE_CODE,
  farSummaryAtlasUploadFallbackReasonCode,
  farSummaryAtlasUploadModeCode,
} from "./farSummaryAtlasUploadCounters.js";

describe("far-summary atlas upload counter codes", () => {
  it("keeps upload mode codes stable for HUD and perf probes", () => {
    expect(FAR_SUMMARY_ATLAS_UPLOAD_MODE_CODE).toEqual({
      none: 0,
      dirty: 1,
      full: 2,
    });
    expect(farSummaryAtlasUploadModeCode("none")).toBe(0);
    expect(farSummaryAtlasUploadModeCode("dirty")).toBe(1);
    expect(farSummaryAtlasUploadModeCode("full")).toBe(2);
  });

  it("keeps fallback reason codes stable for HUD and perf probes", () => {
    expect(FAR_SUMMARY_ATLAS_UPLOAD_FALLBACK_REASON_CODE).toEqual({
      none: 0,
      initial: 1,
      explicit: 2,
      disabled: 3,
      too_many_rects: 4,
      threshold: 5,
      invalid_atlas: 6,
      partial_ranges_unsupported: 7,
      full_invalidation: 8,
    });
    expect(farSummaryAtlasUploadFallbackReasonCode(null)).toBe(0);
    expect(farSummaryAtlasUploadFallbackReasonCode("initial")).toBe(1);
    expect(farSummaryAtlasUploadFallbackReasonCode("partial_ranges_unsupported")).toBe(7);
    expect(farSummaryAtlasUploadFallbackReasonCode("full_invalidation")).toBe(8);
  });
});
