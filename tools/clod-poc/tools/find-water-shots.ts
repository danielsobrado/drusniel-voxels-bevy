import {
  numberArg,
  parseCliArgs,
  stringArg,
  waterDebugInfo,
  withWaterHarness,
} from "./water-harness.js";

interface CandidateShot {
  x: number;
  z: number;
  yaw: number;
  depth: number;
  wetFraction: number;
  bankDistance: number;
  score: number;
  kind: "lake" | "river";
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const limit = Math.max(1, Math.floor(numberArg(args, "limit", 12)));
  const world = Math.max(1, Math.floor(numberArg(args, "world", 16)));
  const step = Math.max(1, numberArg(args, "step", 2));
  const url = typeof args.url === "string" ? args.url : undefined;

  await withWaterHarness({ url, world }, async ({ page }) => {
    const info = await waterDebugInfo(page);
    const candidates = await page.evaluate<CandidateShot[]>(`(() => {
      const worldCells = ${info.worldCells};
      const step = ${step};
      const dirs = Array.from({ length: 16 }, (_, i) => {
        const a = i / 16 * Math.PI * 2;
        return [Math.cos(a), Math.sin(a)];
      });
      const probe = window.waterProbe;
      const localWetFraction = (x, z) => {
        let wet = 0;
        let total = 0;
        for (let dz = -8; dz <= 8; dz += 2) {
          for (let dx = -8; dx <= 8; dx += 2) {
            const px = x + dx;
            const pz = z + dz;
            if (px < 0 || pz < 0 || px > worldCells || pz > worldCells) continue;
            const s = probe(px, pz);
            total += 1;
            if (s.depth > 0.02 && s.bodyMask > 0.05) wet += 1;
          }
        }
        return total > 0 ? wet / total : 0;
      };
      const nearestBank = (x, z) => {
        let best = null;
        for (const [dx, dz] of dirs) {
          for (let r = 5; r <= 12; r += 1) {
            const px = x + dx * r;
            const pz = z + dz * r;
            if (px < 0 || pz < 0 || px > worldCells || pz > worldCells) continue;
            const s = probe(px, pz);
            if (s.depth <= 0 || s.bodyMask <= 0.02) {
              if (!best || r < best.distance) best = { distance: r, dx, dz };
              break;
            }
          }
        }
        return best;
      };
      const raw = [];
      for (let z = 0; z <= worldCells; z += step) {
        for (let x = 0; x <= worldCells; x += step) {
          const s = probe(x, z);
          if (s.depth < 0.08 || s.depth > 0.7 || s.bodyMask <= 0.05) continue;
          const bank = nearestBank(x, z);
          if (!bank) continue;
          const wetFraction = localWetFraction(x, z);
          if (wetFraction < 0.25) continue;
          const viewX = -bank.dx;
          const viewZ = -bank.dz;
          const yaw = Math.atan2(viewX, -viewZ);
          const depthScore = 1 - Math.min(1, Math.abs(s.depth - 0.32) / 0.38);
          const bankScore = 1 - Math.min(1, Math.abs(bank.distance - 8.5) / 3.5);
          const kind = s.flowSpeed > 0.001 ? "river" : "lake";
          raw.push({
            x,
            z,
            yaw,
            depth: s.depth,
            wetFraction,
            bankDistance: bank.distance,
            score: wetFraction * 2 + depthScore + bankScore + (kind === "river" ? 0.15 : 0),
            kind,
          });
        }
      }
      raw.sort((a, b) => b.score - a.score);
      const selected = [];
      for (const candidate of raw) {
        if (selected.every((s) => Math.hypot(s.x - candidate.x, s.z - candidate.z) >= 18)) {
          selected.push(candidate);
        }
        if (selected.length >= ${Math.max(limit, 6)}) break;
      }
      return selected;
    })()`);

    if (candidates.length === 0) {
      throw new Error(`no water shots matched criteria in ${stringArg(args, "url", info.worldCells.toString())}`);
    }

    console.log(`# ${candidates.length} fake-water candidate shots from ${info.worldCells}x${info.worldCells} world`);
    for (const c of candidates.slice(0, limit)) {
      console.log(
        `--x ${c.x.toFixed(0)} --z ${c.z.toFixed(0)} --yaw ${c.yaw.toFixed(2)}` +
          ` # depth ${c.depth.toFixed(2)} wet ${c.wetFraction.toFixed(2)} bank ${c.bankDistance.toFixed(0)}m kind ${c.kind}`,
      );
    }
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
