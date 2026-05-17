# Free Nature Assets Download Guide

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
  - YES -> Use `scripts/download-nature-assets.ps1`
  - NO -> Use `scripts/organize-downloaded-assets.ps1`

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

```powershell
# Semi-automated flow
.\scripts\download-nature-assets.ps1

# Manual organizer
.\scripts\organize-downloaded-assets.ps1
```

---

## Troubleshooting

### Script won't run
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Downloads not detected
- Check: `$env:USERPROFILE\Downloads`
- Or specify: `-DownloadsFolder "C:\Your\Path"`
