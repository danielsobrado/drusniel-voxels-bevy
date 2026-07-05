import fs from "node:fs";
import path from "node:path";

const RUN_DIR = process.argv[2];
const OUT_FILE = path.join(RUN_DIR, "metrics-summary.json");

const WANTED = [
  "stream_ready_frame",
  "live_clod_stream_required_pages",
  "live_clod_stream_cached_pages",
  "live_clod_stream_ready_pages",
  "live_clod_stream_pending_pages",
  "live_clod_stream_failed_pages",
  "live_clod_stream_max_root_level",
  "live_clod_stream_requested_l0_pages",
  "live_clod_stream_requested_l1_pages",
  "live_clod_stream_requested_l2_pages",
  "live_clod_stream_requested_l3_pages",
  "live_clod_stream_applied_l0_pages",
  "live_clod_stream_applied_l1_pages",
  "live_clod_stream_applied_l2_pages",
  "live_clod_stream_applied_l3_pages",
  "live_clod_stream_stale_completed_l0_pages",
  "live_clod_stream_stale_completed_l1_pages",
  "live_clod_stream_stale_completed_l2_pages",
  "live_clod_stream_stale_completed_l3_pages",
  "live_clod_stream_worker_build_ms_l0_p95",
  "live_clod_stream_worker_build_ms_l1_p95",
  "live_clod_stream_worker_build_ms_l2_p95",
  "live_clod_stream_worker_build_ms_l3_p95",
  "priority_owner_overlap_cells",
  "priority_unowned_cells",
  "clod_parent_coverage_violations",
  "horizon_hole_ratio",
  "frame_ms_p95",
  "render_ms_p95",
  "streamRequired",
  "streamCached",
  "streamReady",
  "streamPending",
  "streamFailed"
];

function listJsonFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listJsonFiles(full));
    if (entry.isFile() && entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function visit(value, file, keyPath, hits) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, file, `${keyPath}[${index}]`, hits));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPath = keyPath ? `${keyPath}.${key}` : key;
    if (WANTED.includes(key)) {
      hits.push({ file, path: nextPath, key, value: child });
    }
    visit(child, file, nextPath, hits);
  }
}

if (!RUN_DIR || !fs.existsSync(RUN_DIR)) {
  console.error(`Run directory not found: ${RUN_DIR}`);
  process.exit(1);
}

const hits = [];
for (const file of listJsonFiles(RUN_DIR)) {
  try {
    visit(JSON.parse(fs.readFileSync(file, "utf8")), path.relative(RUN_DIR, file), "", hits);
  } catch (error) {
    console.warn(`Skipping invalid JSON ${file}: ${error.message}`);
  }
}

const grouped = Object.fromEntries(WANTED.map((key) => [key, hits.filter((hit) => hit.key === key)]));
fs.writeFileSync(OUT_FILE, JSON.stringify({ runDir: RUN_DIR, grouped, hits }, null, 2));

for (const key of WANTED) {
  const values = grouped[key];
  if (!values.length) continue;
  console.log(`\n${key}`);
  for (const hit of values.slice(-10)) {
    console.log(`  ${hit.value}  ${hit.file} :: ${hit.path}`);
  }
}

console.log(`\nWrote ${OUT_FILE}`);
