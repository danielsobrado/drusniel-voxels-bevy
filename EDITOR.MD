# Editor

The desktop editor lives in `editor/frontend` and runs as a Tauri app. Tauri owns the editor window and starts the Bevy editor runtime in backend mode automatically.

### Start The Desktop Editor

```powershell
cd C:\Development\workspace\GitHub\drusniel-voxels\editor\frontend
npm.cmd run dev:desktop
```

### Build The Desktop Editor

```powershell
cd C:\Development\workspace\GitHub\drusniel-voxels\editor\frontend
npm.cmd run build:desktop
```

The desktop build creates a release editor runtime sidecar first, then builds the Tauri app with that sidecar configured.

### Run A Built Editor Exe

After a successful production build, run:

```powershell
C:\Development\workspace\GitHub\drusniel-voxels\editor\frontend\src-tauri\target\release\drusniel_voxels_editor.exe
```

### Browser-Only Frontend Development

Use this only for frontend work that does not need the desktop runtime lifecycle:

```powershell
cd C:\Development\workspace\GitHub\drusniel-voxels\editor\frontend
npm.cmd run dev
```
