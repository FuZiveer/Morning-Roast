# Morning Roast — Windows installer hosting

Upload these files together when releasing a desktop build:

| File | Purpose |
|------|---------|
| `Morning-Roast-Setup-x.y.z.exe` | Windows installer |
| `latest.yml` | Auto-update manifest for installed apps |
| `Morning-Roast-Setup-x.y.z.exe.blockmap` | Differential update metadata |
| `desktop-version.json` | Version info for the website download page |

## Build & publish

```bash
cd desktop
npm install
npm run release
```

Then deploy everything in this folder to `https://morningroast.net/downloads/`.

## How auto-update works

1. **Website content** — When online, the desktop app loads the live site (`morningroast.net`). Website deploys are picked up on reload or when the app detects a new `APP_CACHE_VERSION`.
2. **Desktop shell** — `electron-updater` checks `latest.yml` on startup and every few hours. Downloaded updates install on restart.

Bump `version` in `desktop/package.json` when shipping a new installer. Bump `APP_CACHE_VERSION` in `script.js` when shipping website-only changes.
