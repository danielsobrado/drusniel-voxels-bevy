# Visual sequence report

- Artifact: `sequence-runs\s0-static-continent-rim-2026-07-19`
- Result: **PASS**

```json
{
  "schemaVersion": 1,
  "id": "static-continent-rim",
  "mode": "static",
  "frameCount": 8,
  "static_temporal_variance": {
    "adjacent": [
      {
        "meanLuma": 0.00009626443114306218,
        "p95Luma": 0.00028313725490196963,
        "maxLuma": 0.005305882352941211,
        "meanChroma": 0.00016575973377093618,
        "changedRatio": 0.00008810713828014866,
        "edgeMean": 0.00020763421118416212
      },
      {
        "meanLuma": 0.0000942146036508703,
        "p95Luma": 0.0002831372549019557,
        "maxLuma": 0.005305882352941154,
        "meanChroma": 0.00016234643287024242,
        "changedRatio": 0.00007475757187406553,
        "edgeMean": 0.00020437586110543993
      },
      {
        "meanLuma": 0.00008755849937054984,
        "p95Luma": 0.00028313725490194177,
        "maxLuma": 0.003921568627451092,
        "meanChroma": 0.00015177148222699055,
        "changedRatio": 0.000018689392968516384,
        "edgeMean": 0.00019384867377615186
      },
      {
        "meanLuma": 0.00008879362219493755,
        "p95Luma": 0.00028313725490194177,
        "maxLuma": 0.004755294117647038,
        "meanChroma": 0.00015298079588965915,
        "changedRatio": 0.000029369046093382887,
        "edgeMean": 0.00019618730804897314
      },
      {
        "meanLuma": 0.00008653542210598135,
        "p95Luma": 0.00028313725490194177,
        "maxLuma": 0.003921568627451036,
        "meanChroma": 0.00014952037887223948,
        "changedRatio": 0.00001334956640608313,
        "edgeMean": 0.00019234023430026608
      },
      {
        "meanLuma": 0.00009093586847360192,
        "p95Luma": 0.00028313725490194177,
        "maxLuma": 0.004472156862745152,
        "meanChroma": 0.00015632080505322132,
        "changedRatio": 0.00005339826562433252,
        "edgeMean": 0.00019909532476499237
      },
      {
        "meanLuma": 0.00009046655216405391,
        "p95Luma": 0.00028313725490194177,
        "maxLuma": 0.004472156862745152,
        "meanChroma": 0.00015564547404679608,
        "changedRatio": 0.00003203895937459951,
        "edgeMean": 0.0001984830735990675
      }
    ],
    "meanLuma": 0.00009068128558615101,
    "maxP95Luma": 0.00028313725490196963,
    "maxChangedRatio": 0.00008810713828014866,
    "multiScaleMean": {
      "1": 0.00009068128558615101,
      "2": 0.00008976026543847886,
      "4": 0.00008751198931585078
    }
  },
  "transition_residual": null,
  "moving_residual": null,
  "reprojected_colour_residual": [
    {
      "frame": 1,
      "meanLuma": 0.00009618123905758832,
      "edgeMean": 0.0004828996494501288,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    },
    {
      "frame": 2,
      "meanLuma": 0.00009409178602259371,
      "edgeMean": 0.0004795371743949401,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    },
    {
      "frame": 3,
      "meanLuma": 0.00008747780083680342,
      "edgeMean": 0.00046910198076407334,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    },
    {
      "frame": 4,
      "meanLuma": 0.00008868397953159442,
      "edgeMean": 0.00047125469051637666,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    },
    {
      "frame": 5,
      "meanLuma": 0.00008644200677826704,
      "edgeMean": 0.0004674925193202443,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    },
    {
      "frame": 6,
      "meanLuma": 0.00009084945545712882,
      "edgeMean": 0.0004740870742357395,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    },
    {
      "frame": 7,
      "meanLuma": 0.00009043198594128082,
      "edgeMean": 0.00047368450935703207,
      "validRatio": 0.9985609167414242,
      "disoccludedRatio": 0.0014390832585757796
    }
  ],
  "popEvents": 0,
  "eventResidual": null,
  "eventPopEvents": 0,
  "consoleErrors": [],
  "thresholds": {
    "meanLuma": 0.0002,
    "maxP95Luma": 0.001,
    "maxChangedRatio": 0.001,
    "popEvents": 0,
    "counterMax": {
      "live_clod_gap_holes": 0,
      "clod_far_gap_holes": 0,
      "live_clod_overlap_cells": 0,
      "clod_far_overlap_cells": 0,
      "priority_owner_overlap_cells": 0,
      "far_clipmap_ownership_holes": 0
    }
  },
  "gateViolations": [],
  "passed": true
}
```
