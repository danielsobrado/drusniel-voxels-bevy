const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const prDir = 'tools/clod-poc/pr';
const files = fs.readdirSync(prDir)
  .filter(f => /^\d{4}-clod-.*\.patch$/.test(f))
  .sort();

let success = 0;
let fail = 0;

for (const f of files) {
  const fullPath = path.join(prDir, f);
  let content = fs.readFileSync(fullPath, 'utf8');
  const idx = content.indexOf('diff --git');
  if (idx < 0) { console.log('SKIP (no diff): ' + f); continue; }
  const hunk = content.substring(idx);
  const tmp = '.temp-' + f;
  fs.writeFileSync(tmp, hunk, 'utf8');
  try {
    execSync('git apply "' + tmp + '"', { stdio: 'pipe' });
    console.log('OK: ' + f);
    success++;
  } catch (e) {
    console.log('FAIL: ' + f + ' - ' + e.stderr.toString().trim());
    fail++;
  }
  fs.unlinkSync(tmp);
}

console.log('\nDone: ' + success + ' applied, ' + fail + ' failed');
