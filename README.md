# Schwalbe ToolKit

A local desktop tool hub built with Electron, React, TypeScript, TanStack Router, and TanStack Query. Python implements both the counter and pallet label logic. Electron connects the Python-generated labels to OS-installed printer drivers.

## Run the desktop app

Download and run the latest **Schwalbe-ToolKit-Setup** installer from [GitHub Releases](https://github.com/markreyno/Schwalbe_ToolKit/releases/latest). It installs the app and bundled Python backend, and creates a desktop shortcut. No separate Python installation is required.

Older unpacked builds cannot update themselves. Install this release once to switch to the updateable app. Installed copies check GitHub on startup and every four hours. The sidebar also offers **Check for updates**, **Download**, and **Restart to update**. Download and restart both require user action; updates are not installed on ordinary exit. Finish printing before restarting. Saved raffle names remain in the app profile, while a counter starts fresh.

For development, install Node.js 22.12 or later and Python 3.9 or later, then run:

```powershell
npm install
npm run dev
```

If Python is not on PATH, set `$env:PYTHON_PATH` to its executable before running the app. React changes update live; restart the development command after changing Electron or preload code.

## Build and verify

```powershell
npm run build
npm start
npm test
npm run test:e2e
```

The end-to-end suite launches the real Electron app and Python backend. It covers rapid presses, keyboard operation, reopen/reload resets, backend failure recovery, and hub search.

Current verification: all five desktop tests passed against both the production source build and the updated packaged executable. Prior counter verification also included four Python tests. The packaged tests deliberately set an invalid external Python path and still count successfully using the bundled backend. The production build and TypeScript checks passed.

## Package for Windows

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r python/requirements.txt
npm run package
```

The output includes a Windows x64 NSIS installer, its `.blockmap`, `latest.yml`, and an unpacked app in `release/win-unpacked`. `npm run package:dir` builds only the unpacked app for development. Local packaging does not publish anything. This project currently produces unsigned installers, so Windows may display an unknown-publisher warning. No signing certificate or GitHub token is embedded in the app.

The executable and desktop window use `assets/schwalbe.ico`, converted from the existing Schwalbe artwork in `src/assets/schwalbe-supersign.png`. To regenerate its seven sizes after replacing the artwork, run `./scripts/create-icon.ps1` before packaging.

## Publish an update

Commit the changes to `main`, then bump and tag the version:

```powershell
npm version patch
git push origin main --follow-tags
```

The `v` tag must match `package.json` (for example, `v1.1.1`). GitHub Actions builds Python and Electron on Windows, runs the Python and desktop tests, and uploads the installer, blockmap, and update manifest to a draft release. It publishes that release only after all assets upload successfully. Normal branch pushes run the build and tests without publishing a release. Downloads come from the public `markreyno/Schwalbe_ToolKit` repository; app users do not need GitHub credentials.

Do not replace files in an existing published release; publish a higher version instead. Keep the app ID and update repository stable. Future production signing can be configured in GitHub Actions using repository secrets and an Authenticode certificate. GitHub update support follows the [electron-builder update documentation](https://www.electron.build/docs/features/auto-update/).

To run the same desktop tests against the packaged app:

```powershell
$env:TOOLKIT_EXECUTABLE = (Resolve-Path 'release/win-unpacked/Schwalbe ToolKit.exe').Path
npx playwright test
```

## How it works

The renderer calls a narrowly scoped preload API. Electron validates requests and forwards newline-delimited JSON to a managed Python child process. Request IDs match replies, and Python session IDs isolate counters. Increments are queued and never automatically retried. Leaving a counter cancels queued presses and closes the session; reentering opens a new one. Counter state stays in memory.

The Electron renderer runs sandboxed with context isolation and no Node integration, following the [Electron context isolation documentation](https://www.electronjs.org/docs/latest/tutorial/context-isolation). Navigation uses [TanStack hash history](https://tanstack.com/router/latest/docs/guide/history-types) so packaged local files support tool routes.

## Add a tool

1. Add its Python module under `python/tools` and explicit operations to `python/main.py`.
2. Add typed API methods in `shared/protocol.ts`, allowlisted handlers in `electron/main.ts`, and preload methods in `electron/preload.ts`.
3. Create a React screen under `src/tools` and register its route in `src/app/router.tsx`.
4. Add its logo, name, description, availability, and route to `src/app/toolRegistry.ts`.

## Pallet Label Printer

Open Pallet Label Printer, enter the company and total pallets, select an OS-installed printer, and click Print. For YMC and 10 pallets, it sends 20 separate labels in order: YMC 1/10, YMC 1/10, YMC 2/10, YMC 2/10, through YMC 10/10 twice.

Use 1.5 × 1-inch roll stock and a driver that supports this custom size. Refresh printers after installing or connecting a device. Printing goes directly to the selected queue. The app reports job submission, not physical completion; check the OS queue for offline, paper, or driver errors before retrying.

A job supports 1–1,000 pallets and company names up to 80 characters. Long names shrink to fit; names that cannot fit legibly are rejected. Actual feed direction and printable margins require verification on the target hardware.

The desktop tests intercept the native spool call while exercising the real print document, IPC validation, printer selection, paired sequence, page dimensions, and driver failure handling. They do not consume labels or verify physical printer output. See [PALLET_LABEL_PRINTER.md](PALLET_LABEL_PRINTER.md) for requirements.




## Python tool ownership

All tools implement their functional logic in Python under `python/tools`. Counter state, pallet input validation, paired sequences, preview data, and print document generation belong to Python. React presents the interface; Electron provides the narrow OS adapter for printer discovery, document rendering and fitting, and native print queue submission. New tools must follow this split.

## Branding

The app uses the supplied Schwalbe Supersign artwork with pale blue (#D4EBF8), black, and white. Both tools retain their Python logic.


## Alignment test

Select a printer in Pallet Label Printer and click Print alignment test to submit one label with an inset border and center cross. No shipment fields are required. Inspect physical margins and clipping; the app does not automatically calibrate the printer.
