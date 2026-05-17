# Simple Manual Download Guide

If the automated scripts are not working, follow these steps manually.

## Step 1: Download the Assets

### Essential Downloads

1. Quaternius Nature MEGAKIT
   - URL: https://quaternius.itch.io/stylized-nature-megakit
   - Click "Download Now"
   - Enter $0
   - Click "No thanks, just take me to the downloads"
   - Download the ZIP (glTF preferred)
   - Save as: `quaternius_nature_megakit.zip`

2. KayKit Forest Pack
   - URL: https://kaylousberg.itch.io/kaykit-forest
   - Scroll to "Download Now"
   - Click "No thanks, just take me to the downloads"
   - Download the free version
   - Save as: `kaykit_forest.zip`

3. Kenney Nature Kit
   - URL: https://kenney.nl/assets/nature-kit
   - Click "Download this package"
   - Click "Continue without donating"
   - Download the ZIP
   - Save as: `kenney_nature_kit.zip`

### Optional Downloads

4. Quaternius Crops
   - URL: https://poly.pizza/m/Ro6K0Yg7mx
   - Click download
   - Choose glTF
   - Save as: `quaternius_crops.zip`

5. KayKit Resources
   - URL: https://kaylousberg.itch.io/resource-bits
   - Same process as KayKit Forest
   - Save as: `kaykit_resources.zip`

---

## Step 2: Organize the Files

### Option A: Use the Organizer Script

```powershell
# Put all ZIPs in your Downloads folder, then run:
.\scripts\organize-downloaded-assets.ps1
```

### Option B: Manual Organization

Create this folder structure:

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

Extract and move files:

Quaternius Nature MEGAKIT:
- Trees -> `assets/models/vegetation/trees/quaternius/`
- Rocks -> `assets/models/rocks/quaternius/`
- Plants -> `assets/models/vegetation/plants_flowers/quaternius/`
- Bushes/Grass -> `assets/models/vegetation/grass_bushes/quaternius/`

KayKit Forest:
- Names with "tree" -> `assets/models/vegetation/trees/kaykit/`
- Names with "rock" -> `assets/models/rocks/kaykit/`
- Names with "bush/grass" -> `assets/models/vegetation/grass_bushes/kaykit/`

Kenney Nature Kit:
- rock/stone/boulder -> `assets/models/rocks/kenney/`
- tree/pine/oak -> `assets/models/vegetation/trees/kenney/`
- plant/flower/bush/grass -> `assets/models/vegetation/grass_bushes/kenney/`
- tent/camp/fire -> `assets/models/props/camping/kenney/`

Quaternius Crops:
- Extract to `assets/models/vegetation/crops/quaternius/`

KayKit Resources:
- Extract to `assets/models/props/resources/kaykit/`

---

## Step 3: Verify

```powershell
Get-ChildItem -Path "assets\\models" -Recurse -Filter "*.glb" | Measure-Object
Get-ChildItem -Path "assets\\models" -Recurse -Filter "*.fbx" | Measure-Object
Get-ChildItem -Path "assets\\models" -Recurse -Filter "*.obj" | Measure-Object
```
