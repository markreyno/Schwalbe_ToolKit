# Phone transport (HTTP default, optional HTTPS)

Freight Pictures (**48731**), PalletVision Data Collector (**48732**), and Connect PWA (**48734**) use **plain HTTP by default** on those ports. QR codes, hub tiles, and copyable links use `http://` unless you turn on **Use HTTPS for phone tools** on the desktop Connect PWA page (or the equivalent setting stored in phone TLS settings).

## Default: HTTP

- No certificate trust step on phones.
- Uploads and the Connect PWA hub work in the mobile browser.
- **Does not** provide a secure context: service worker install/offline caching, “Install app” prompts, and Picker Water **push** notifications are unavailable until HTTPS is enabled and trusted.

## Optional HTTPS

When **Use HTTPS for phone tools** is enabled on the desktop:

### Local network mode

1. Note the **CA fingerprint** and **Trust this desktop** link (plain HTTP on port **48730** — CA download only).
2. On the phone, open `http://<desktop-ip>:48730/` on the same LAN and install the CA (iOS profile + full trust, or Android `ca.crt`).
3. Open tool `https://` links or the Connect PWA hub.

### Tailscale mode

1. Enable **MagicDNS** and **HTTPS Certificates** in the Tailscale admin console (DNS settings).
2. Switch the tool to **Tailscale** network mode on the desktop.
3. The toolkit runs `tailscale cert <magicdns-name>`. Phone links should use the **MagicDNS hostname** (not a raw 100.x IP).

Certificates are renewed automatically before expiry when possible. On Windows, the packaged app looks for `tailscale.exe` on PATH and under `C:\Program Files\Tailscale\tailscale.exe`.

## Troubleshooting

| Issue | What to do |
|--------|------------|
| Uploads fail / connection refused | Confirm Windows Firewall allows ports **48731–48734** on private networks; same Wi‑Fi or Tailscale. |
| Want installable PWA or push | Enable **Use HTTPS for phone tools** and complete certificate trust (local CA or Tailscale). |
| Desktop shows “HTTPS certificate is not ready” | Fix Tailscale/MagicDNS/`tailscale cert` or local CA errors, or turn HTTPS off to stay on HTTP. |
| Phone TLS error on `*.ts.net` while HTTPS is on | Usually wrong cert (local CA) or expired Tailscale cert — check Connect PWA certificate status on the desktop. |

## Adding a new phone tool

1. Import `PhoneTlsManager` and `startPhoneToolServer` from `electron/tls`.
2. Listen on your fixed port; pass `tls` from the manager when HTTPS is enabled, otherwise HTTP via `allowInsecureHttp` / HTTP mode.
3. Build URLs with `buildPhoneOrigin` / `buildPhoneAddressList` and respect `PhoneTlsManager.getPhoneHttpMode()`.
4. Keep the private-network IP allowlist on the request handler.
