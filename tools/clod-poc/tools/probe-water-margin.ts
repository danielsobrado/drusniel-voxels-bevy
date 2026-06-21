import {
  booleanArg,
  numberArg,
  parseCliArgs,
  waterDebugInfo,
  withWaterHarness,
} from "./water-harness.js";

interface RegionReport {
  totalSamples: number;
  wetSamples: number;
  wetFraction: number;
  isolatedWetSamples: number;
  maxWaterYJump: number;
  maxWetWaterYJump: number;
  maxDrySentinelJump: number;
  maxTerrainWaterCrossingError: number;
}

interface TransectRow {
  d: number;
  x: number;
  z: number;
  terrain: number;
  water: number;
  depth: number;
  wet: boolean;
  transition: string;
  waterYJump: number;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const url = typeof args.url === "string" ? args.url : undefined;

  await withWaterHarness({ url, world }, async ({ page }) => {
    const info = await waterDebugInfo(page);
    if (booleanArg(args, "transect")) {
      await runTransect(args, page, info.worldCells);
    } else {
      await runRegion(args, page, info.worldCells);
    }
  });
}

async function runRegion(args: Record<string, string | boolean>, page: { evaluate<T>(expression: string): Promise<T> }, worldCells: number): Promise<void> {
  const ox = numberArg(args, "ox", 0);
  const oz = numberArg(args, "oz", 0);
  const width = Math.max(1, numberArg(args, "width", worldCells));
  const depth = Math.max(1, numberArg(args, "depth", worldCells));
  const step = Math.max(0.25, numberArg(args, "step", 2));
  const report = await page.evaluate<RegionReport>(`(() => {
    const probe = window.waterProbe;
    const ox = ${ox};
    const oz = ${oz};
    const width = ${width};
    const depth = ${depth};
    const step = ${step};
    const nx = Math.max(1, Math.floor(width / step) + 1);
    const nz = Math.max(1, Math.floor(depth / step) + 1);
    const samples = [];
    let totalSamples = 0;
    let wetSamples = 0;
    let maxTerrainWaterCrossingError = 0;
    for (let iz = 0; iz < nz; iz++) {
      const row = [];
      const z = oz + iz * step;
      for (let ix = 0; ix < nx; ix++) {
        const x = ox + ix * step;
        const s = probe(x, z);
        const wet = s.depth > 0.02 && s.bodyMask > 0.05;
        totalSamples += 1;
        if (wet) wetSamples += 1;
        if (!wet && s.depth > 0) maxTerrainWaterCrossingError = Math.max(maxTerrainWaterCrossingError, s.depth);
        row.push({ wet, water: s.water });
      }
      samples.push(row);
    }
    let isolatedWetSamples = 0;
    let maxWaterYJump = 0;
    let maxWetWaterYJump = 0;
    let maxDrySentinelJump = 0;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const sample = samples[iz][ix];
        if (sample.wet) {
          let wetNeighbors = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dz === 0) continue;
              const neighbor = samples[iz + dz]?.[ix + dx];
              if (neighbor?.wet) wetNeighbors += 1;
            }
          }
          if (wetNeighbors === 0) isolatedWetSamples += 1;
        }
        for (const [dx, dz] of [[1, 0], [0, 1]]) {
          const other = samples[iz + dz]?.[ix + dx];
          if (!other) continue;
          const jump = Math.abs(sample.water - other.water);
          maxWaterYJump = Math.max(maxWaterYJump, jump);
          if (sample.wet && other.wet) maxWetWaterYJump = Math.max(maxWetWaterYJump, jump);
          if (sample.wet !== other.wet) maxDrySentinelJump = Math.max(maxDrySentinelJump, jump);
        }
      }
    }
    return {
      totalSamples,
      wetSamples,
      wetFraction: totalSamples > 0 ? wetSamples / totalSamples : 0,
      isolatedWetSamples,
      maxWaterYJump,
      maxWetWaterYJump,
      maxDrySentinelJump,
      maxTerrainWaterCrossingError,
    };
  })()`);

  console.log(`region ox=${ox} oz=${oz} width=${width} depth=${depth} step=${step}`);
  console.log(`total samples: ${report.totalSamples}`);
  console.log(`wet sample count: ${report.wetSamples}`);
  console.log(`wet fraction: ${report.wetFraction.toFixed(4)}`);
  console.log(`isolated wet samples: ${report.isolatedWetSamples}`);
  console.log(`max waterY jump between adjacent samples: ${report.maxWaterYJump.toFixed(4)}m`);
  console.log(`max wet-only waterY jump: ${report.maxWetWaterYJump.toFixed(4)}m`);
  console.log(`max dry sentinel transition jump: ${report.maxDrySentinelJump.toFixed(4)}m`);
  console.log(`max terrain/water crossing error: ${report.maxTerrainWaterCrossingError.toFixed(4)}m`);
}

async function runTransect(args: Record<string, string | boolean>, page: { evaluate<T>(expression: string): Promise<T> }, worldCells: number): Promise<void> {
  const ox = numberArg(args, "ox", worldCells * 0.52 - 32);
  const oz = numberArg(args, "oz", worldCells * 0.46);
  const yaw = numberArg(args, "yaw", Math.PI * 0.5);
  const length = Math.max(1, numberArg(args, "length", 96));
  const step = Math.max(0.25, numberArg(args, "step", 2));
  const rows = await page.evaluate<TransectRow[]>(`(() => {
    const probe = window.waterProbe;
    const ox = ${ox};
    const oz = ${oz};
    const yaw = ${yaw};
    const length = ${length};
    const step = ${step};
    const dirX = Math.sin(yaw);
    const dirZ = -Math.cos(yaw);
    const rows = [];
    let previous = null;
    for (let d = 0; d <= length + 1e-6; d += step) {
      const x = ox + dirX * d;
      const z = oz + dirZ * d;
      const s = probe(x, z);
      const wet = s.depth > 0.02 && s.bodyMask > 0.05;
      const waterYJump = previous ? Math.abs(s.water - previous.water) : 0;
      let transition = "";
      if (previous && previous.wet !== wet) transition = previous.wet ? "wet->dry" : "dry->wet";
      if (waterYJump > 1 && (!previous || previous.wet === wet)) transition = transition ? \`\${transition},jump\` : "jump";
      rows.push({ d, x, z, terrain: s.terrain, water: s.water, depth: s.depth, wet, transition, waterYJump });
      previous = { wet, water: s.water };
    }
    return rows;
  })()`);

  console.log(`transect ox=${ox} oz=${oz} yaw=${yaw.toFixed(3)} length=${length} step=${step}`);
  console.log("d,x,z,terrainY,waterY,depth,state,transition,waterYJump");
  for (const row of rows) {
    console.log([
      row.d.toFixed(2),
      row.x.toFixed(2),
      row.z.toFixed(2),
      row.terrain.toFixed(3),
      row.water.toFixed(3),
      row.depth.toFixed(3),
      row.wet ? "wet" : "dry",
      row.transition,
      row.waterYJump.toFixed(3),
    ].join(","));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
