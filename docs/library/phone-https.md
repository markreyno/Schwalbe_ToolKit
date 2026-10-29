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

1. Connect PWA → **Phone hub server** shows transport status, certificate validity, and **Retry certificate**.
2. On every toolkit startup, `PhoneTlsManager` checks certificates **in the background** (does not block the UI):
   - **Tailscale:** runs `tailscale cert` when the cert is missing, expired, expiring within 30 days, or no longer matches the current MagicDNS name.
   - **Local CA:** regenerates the **leaf** cert when missing, expired, expiring within 14 days, or SANs no longer match current LAN/Tailscale IPs. The **CA** is kept so phones that already trusted it do not reinstall; the CA is recreated only if missing or expired.
3. Phone HTTPS listeners on **48731**, **48732**, and **48734** **hot-swap** renewed certificates via SNI (no full server restart). Port **48730** stays HTTP for CA trust bootstrap only.
4. If Tailscale is not running at startup, the desktop keeps the local CA cert and retries Tailscale renewal on a timer (every few hours via maintenance, plus shorter retries while HTTPS is unavailable).
5. Freight / PalletVision pages show the same TLS status and retry when HTTPS is unavailable.

## Phone checklist

| Symptom | Fix |
|--------|-----|
| Desktop shows certificate error | Fix Tailscale HTTPS or local CA; tap **Retry certificate** on desktop |
| Local LAN TLS error on phone | Open `http://<desktop-ip>:48730/`, install CA, verify fingerprint on desktop |
| PWA install / push / Background Fetch | Require HTTPS **and** trusted cert on the phone |
| Uploads stall when hub offline | Desktop must show HTTPS ready and servers running |

## Developers

1. Single `PhoneTlsManager` per toolkit profile; `load()` on startup, then `runStartupCertificateCheck()` after phone services register.
2. `refreshServerTls` before starting listeners; pass `tls: manager.getServerTls()` and **`allowInsecureHttp: false`**. Renewal decisions live in `electron/tls/certRenewalPolicy.ts`.
3. Do not start plain HTTP on 48731–48734. Port 48730 remains HTTP for CA bootstrap only.
