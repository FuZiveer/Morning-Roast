# Morning Roast — Windows installer hosting

The installer (`.exe`) is **~325 MB** — GitHub repos reject files over **100 MB**, so **do not commit the `.exe`**. Host it on **GitHub Releases** instead.

## Build

```bash
cd desktop
npm install
npm run release
```

This writes into `downloads/`:

| File | Commit to Git? | Purpose |
|------|----------------|---------|
| `Morning-Roast-Setup-x.y.z.exe` | **No** (gitignored) | Windows installer |
| `desktop-version.json` | Yes | Download page + release URL |
| `latest.yml` | Yes | Auto-update manifest |
| `*.exe.blockmap` | Yes | Differential updates |

## Publish (GitHub Releases)

After each build, create or update a release and attach the large files:

```bash
gh release create v1.0.0 \
  downloads/Morning-Roast-Setup-1.0.0.exe \
  downloads/latest.yml \
  downloads/Morning-Roast-Setup-1.0.0.exe.blockmap \
  --title "Morning Roast Desktop 1.0.0" \
  --notes "Windows desktop app"
```

Or on GitHub: **Releases → New release** → tag `v1.0.0` → drag in the three files above.

Commit and push the small files (`desktop-version.json`, `latest.yml`, `.blockmap`). The site reads `installerUrl` from `desktop-version.json` and links to the release asset.

## Auto-update

Installed apps fetch updates from:

`https://github.com/FuZiveer/Morning-Roast/releases/latest/download/`

Each new desktop version needs a new release with `latest.yml`, the `.exe`, and `.blockmap`.

Bump `version` in `desktop/package.json` when shipping a new installer. Bump `APP_CACHE_VERSION` in `script.js` for website-only changes.
