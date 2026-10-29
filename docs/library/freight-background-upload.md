# Freight phone background upload (Android Chrome)

## What Mark needs

Pictures should keep uploading after **Upload All** when the driver locks the phone, switches apps, or leaves the Freight page. IndexedDB resume when reopening the app is a safety net, not the primary experience.

## Chrome tab vs installed Connect PWA

| Capability | Normal Chrome tab (`https://…:48731/?key=…`) | Installed Connect PWA (Add to Home Screen from hub) |
|------------|-----------------------------------------------|-----------------------------------------------------|
| HTTPS + trusted desktop CA | Required | Required |
| Service worker (`/freight-sw.js`) | Yes, after first load | Yes |
| **Background Fetch** (large POST uploads while app inactive) | **Not available** on Android Chrome | **Available** when permission granted |
| Service worker `fetch()` drain from IndexedDB | Best-effort while tab/process alive; **stops** if the tab is killed | Better while PWA process stays alive; still not as strong as Background Fetch |
| One-off **Background Sync** | Registered as fallback; wakes SW when back online, does **not** replace Background Fetch for multi‑MB files | Same |
| IndexedDB queue + reopen to resume | Always | Always |

**Plain language:** For reliable upload with the screen off, install the **Connect PWA** from the toolkit hub (48733), trust the desktop CA, then open **Freight Pictures** from the hub tile—not only from a one-off tab bookmark.

## What the app does (v1.6.9+)

1. **Upload All** saves originals to IndexedDB, creates the desktop batch, registers the freight service worker (`skipWaiting` + `clients.claim`).
2. **Immediately** tries **Background Fetch** for all remaining `/file` POSTs (installed PWA path).
3. If Background Fetch is unavailable, reports **`service-worker`** on the desktop and starts the SW drain **right away** (not only when the page hides). Optional **Background Sync** tag `freight-upload-continue` is registered.
4. If the SW makes no progress for ~45s, falls back to in-page XHR (**`page`** channel)—foreground-oriented.
5. When the tab hides mid-upload, in-flight XHR is aborted and the SW is nudged again.

## Desktop indicator

While a batch is open, the shipment list shows:

`Upload in progress (X of Y, background | service worker | phone page)`

- **background** — Background Fetch registered  
- **service worker** — SW drain from IndexedDB  
- **phone page** — XHR from the visible Freight page  

## Debugging on a phone

After **Upload All**, the page stores a JSON probe in `sessionStorage` key `schwalbe-freight-upload-probe` (secure context, SW controller, installed PWA, Background Fetch API, permission state). Use remote debugging (`chrome://inspect`) to read it if uploads stall.

## Periodic Background Sync

Not used for Freight uploads: it is meant for small periodic updates, requires installed PWA + permission, and does not stream large picture bodies.
