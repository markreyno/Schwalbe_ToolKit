# Connect PWA (phone hub)

The Connect PWA is a phone hub on port **48734** (HTTPS only) with links to Freight Pictures and PalletVision.

## Desktop setup

1. Open **Connect PWA** in the toolkit.
2. Choose **Local network** or **Tailscale**.
3. When HTTPS is ready, scan the QR or copy the link (opens **`/install`**).
4. If HTTPS is not ready, fix certificates and use **Retry certificate** — the hub does not fall back to HTTP.

**Local network:** scan the CA trust QR first (`http://<desktop>:48730/`) if the phone has not trusted the desktop CA.

## Install flow

- **`/install`** — Add to Home Screen steps; Android install prompt when available.
- **`/`** — Warehouse tools hub (no install banners).
- Service worker and manifest require **HTTPS** and a trusted certificate on the phone.

If Android shows “already installed” but **Open app** does nothing after an uninstall, the install page offers steps to clear the stale install (Settings → Apps, Chrome site data).

## Picker Water (optional)

Push notifications for installed PWA require HTTPS and a trusted cert on the phone.

## Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 48730 | HTTP | CA trust bootstrap only |
| 48731 | HTTPS | Freight Pictures |
| 48732 | HTTPS | PalletVision |
| 48734 | HTTPS | Connect hub + `/install` |
