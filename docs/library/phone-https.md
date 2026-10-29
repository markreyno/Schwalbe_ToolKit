# Phone HTTPS

Freight Pictures (**48731**), PalletVision Data Collector (**48732**), and Connect PWA (**48734**) are **HTTPS-only** on those ports. QR codes, hub tiles, copy links, and the home arrow always use `https://`.

There is **no HTTP fallback** on the tool ports. If the desktop certificate is not ready, phone servers stay **offline** and the desktop shows a clear error with **Retry certificate** — phones are never quietly downgraded to HTTP.

## Certificates

- **Tailscale** mode: MagicDNS name + Tailscale-issued cert (SNI on `*.ts.net` for phone ports).
- **Local network** mode: desktop **local CA** covers LAN IP/hostname on the phone ports. Phones trust the CA once via the bootstrap page below.

## Bootstrap HTTP (port 48730 only)

The **CA trust** server on port **48730** is the only intentional HTTP surface. It serves:

- `/ca.crt` and iOS profile for one-time CA install
- Short instructions (no tool UI)

URL shape: `http://<desktop>:48730/?next=<https-install-url>`

After the CA is trusted, use **HTTPS** links on 48731–48734. The trust page **Home** link points at `https://<desktop>:48734/`.

## Desktop

1. Connect PWA → **Phone hub server** shows transport status, errors, and **Retry certificate**.
2. Freight / PalletVision pages show the same TLS status and retry when HTTPS is unavailable.
3. Unchecking “use HTTP” is removed — HTTPS is always on for phone tools.

## Phone checklist

| Symptom | Fix |
|--------|-----|
| Desktop shows certificate error | Fix Tailscale HTTPS or local CA; tap **Retry certificate** on desktop |
| Local LAN TLS error on phone | Open `http://<desktop-ip>:48730/`, install CA, verify fingerprint on desktop |
| PWA install / push / Background Fetch | Require HTTPS **and** trusted cert on the phone |
| Uploads stall when hub offline | Desktop must show HTTPS ready and servers running |

## Developers

1. Single `PhoneTlsManager` per toolkit profile; `load()` on startup.
2. `refreshServerTls` before starting listeners; pass `tls: manager.getServerTls()` and **`allowInsecureHttp: false`**.
3. Do not start plain HTTP on 48731–48734. Port 48730 remains HTTP for CA bootstrap only.
