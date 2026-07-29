# Morning Roast Desktop (Windows)

Electron wrapper for Morning Roast with **auto-update** and **live website sync**.

## Features

- Loads **morningroast.net** when online (always matches the website)
- Falls back to **bundled files** when offline
- **electron-updater** checks `/downloads/latest.yml` for new installers
- In-app banner when a website or desktop update is ready

## Requirements

- [Node.js](https://nodejs.org/) 20 LTS or newer
- Windows 10/11 (x64)

## Development

```bash
npm install
npm start
```

Uses local files from the parent repo on `127.0.0.1` (no auto-update in dev).

## Release a new build

1. Bump `version` in `desktop/package.json`
2. Build and copy artifacts to the website:

```bash
npm run release
```

3. Deploy `downloads/` to production:
   - `Morning-Roast-Setup-x.y.z.exe`
   - `latest.yml`
   - `Morning-Roast-Setup-x.y.z.exe.blockmap`
   - `desktop-version.json`

Installed apps will download updates automatically. Website-only changes only need a normal site deploy — the app loads the live site when online.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `MORNING_ROAST_APP_URL` | `https://morningroast.net/` | Live site URL |
| `MORNING_ROAST_UPDATE_URL` | `https://morningroast.net/downloads` | Update feed base |

## Project layout

| File | Purpose |
|------|---------|
| `main.js` | Window, remote/local loading, menus |
| `updater.js` | electron-updater integration |
| `config.js` | URLs and intervals |
| `preload.js` | `window.MorningRoastDesktop` API |
| `static-server.js` | Offline fallback server |
| `tools/desktop-update.js` | In-app update banner (website) |
