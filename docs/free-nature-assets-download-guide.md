# Free Nature Assets Download Guide

Document status (2026-05-17): reference guide; validate external/tool details before use.

This guide covers the recommended workflow for downloading and organizing free CC0 nature assets.

## Why Auto-Downloads Don't Work

### Poly.pizza (and similar sites)
- No public API for direct downloads
- Requires browser session/cookies
- Anti-bot protection
- Downloads are dynamically generated

### Itch.io (Quaternius, KayKit)
- Pay-what-you-want system (even for free)
- Must click through purchase flow
- Session-based download tokens
- Prevents automated scraping

### Kenney
- Donation flow before download
- Session cookies required
- Can be bypassed but not reliably

## Better Solution: Semi-Automated Workflow

The updated scripts:
- Open download pages in your browser
- Watch your Downloads folder for ZIPs
- Auto-extract and organize when they appear
- Provide copy-paste commands for each step

## Which Script/Guide Should I Use?

### Quick Decision Tree

- Do you want scripts to help at all?
  - NO -> Use `docs/simple-manual-guide.md`
  - YES -> Continue below

- Are you comfortable with interactive scripts?
  - YES -> Use `scripts/download-nature-assets.ps1` (opens browsers, waits for downloads)
  - NO -> Use `scripts/organize-downloaded-assets.ps1` (just organizes existing files)

---

## Three Approaches Explained

### 1. simple-manual-guide.md - Zero Automation
Best for: People who don't want to run scripts at all

What it does:
- Pure step-by-step manual instructions
- Copy-paste folder creation commands
- No automation, no complexity

Steps:
1. Open `docs/simple-manual-guide.md`
2. Download each ZIP manually (5 downloads)
3. Extract and move files to folders (following guide)
4. Done

Time: 30-60 minutes
Difficulty: Easy
Reliability: 100%

---

### 2. organize-downloaded-assets.ps1 - Post-Download Organizer
Best for: People who want to download first, organize later

What it does:
- You download ZIPs manually to your Downloads folder
- Script finds them automatically
- Script extracts and organizes everything

Steps:
1. Download all 5 ZIPs manually (see list below)
2. Leave them in your Downloads folder
3. Run: `.\scripts\organize-downloaded-assets.ps1`
4. Script does the rest

Time: 20 minutes (download) + 2 minutes (script)
Difficulty: Easy
Reliability: Very high

---

### 3. download-nature-assets.ps1 - Semi-Automated
Best for: People who want maximum automation

What it does:
- Opens download pages in your browser
- Shows you exactly what to click
- Waits for downloads to complete
- Auto-extracts and organizes
- Interactive prompts guide you through

Steps:
1. Run: `.\scripts\download-nature-assets.ps1`
2. Follow the prompts
3. Click download buttons when browser opens
4. Script handles the rest

Time: 25-30 minutes total
Difficulty: Medium (interactive prompts)
Reliability: High (requires interaction)

---

## Download List (All Approaches Need These)

### Priority 1 - Essential

1. Quaternius Nature MEGAKIT
   - URL: https://quaternius.itch.io/stylized-nature-megakit
   - Size: ~150 MB
   - Models: 110+ (trees, rocks, plants)

2. KayKit Forest Pack
   - URL: https://kaylousberg.itch.io/kaykit-forest
   - Size: ~50 MB
   - Models: 100+ (forest themed)

3. Kenney Nature Kit
   - URL: https://kenney.nl/assets/nature-kit
   - Size: ~80 MB
   - Models: 330+ (nature variety)

### Priority 2 - Supplementary (Optional)

4. Quaternius Crops
   - URL: https://poly.pizza/m/Ro6K0Yg7mx
   - Size: ~20 MB
   - Models: 10+ (farming crops)

5. KayKit Resources
   - URL: https://kaylousberg.itch.io/resource-bits
   - Size: ~30 MB
   - Models: 75+ (resource piles)

Total download: ~330 MB compressed, ~1 GB extracted

---

## Quick Start Commands

### If Using organize-downloaded-assets.ps1
```powershell
# 1. Download all ZIPs to Downloads folder manually
# 2. Run this:
.\scripts\organize-downloaded-assets.ps1

# Optional: specify custom paths
.\scripts\organize-downloaded-assets.ps1 -TargetDir "D:\MyGame\assets\models"
```

### If Using download-nature-assets.ps1
```powershell
# Run and follow prompts:
.\scripts\download-nature-assets.ps1

# Options:
.\scripts\download-nature-assets.ps1 -OpenBrowser:$false
.\scripts\download-nature-assets.ps1 -SkipExisting:$false
```

### If Using simple-manual-guide.md
```powershell
Get-Content docs/simple-manual-guide.md
```

---

## Troubleshooting

### Script won't run
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Downloads not detected
- Make sure ZIPs are in your Downloads folder
- Check: `$env:USERPROFILE\Downloads`
- If using a different location, specify: `-DownloadsFolder "C:\Your\Path"`

### Everything failed
- Fall back to `docs/simple-manual-guide.md`
- Manual approach always works

---

## What You'll Get

```
assets/models/
|-- rocks/
|   |-- quaternius/
|   |-- kaykit/
|   `-- kenney/
|-- vegetation/
|   |-- trees/
|   |   |-- quaternius/
|   |   |-- kaykit/
|   |   `-- kenney/
|   |-- plants_flowers/
|   |   `-- quaternius/
|   |-- grass_bushes/
|   |   |-- quaternius/
|   |   `-- kaykit/
|   `-- crops/
|       `-- quaternius/
`-- props/
    |-- resources/
    |   `-- kaykit/
    `-- camping/
        `-- kenney/
```

Total: ~600 models, all CC0 licensed, game-ready.
