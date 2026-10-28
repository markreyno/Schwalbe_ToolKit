# Phone transport (HTTPS default)

Freight Pictures (**48731**), PalletVision Data Collector (**48732**), and Connect PWA (**48734**) use **HTTPS by default** on those ports. QR codes, hub tiles, copy links, and the home arrow use `https://` unless the desktop is in **HTTP fallback** (certificate not ready) or you turn off **Use HTTPS for phone tools**.

## Default: HTTPS

- Secure context on the phone: **service worker**, **Install app** (`/install`), Picker Water **push** (installed app), and Freight **Background Fetch** (Android Chrome) when available.
- **Tailscale MagicDNS** (`*.ts.net`): the toolkit obtains a **Tailscale certificate** (`tailscale cert <name>`) and serves it for `*.ts.net` hostnames on **all three ports**, even when a tool is in **Local network** mode. LAN IP links use the **local desktop CA** leaf (SNI selects the right cert).
- **Local network** mode: install the desktop CA once via the trust page on port **48730** (`http://<desktop>:48730/`).

On Windows the app looks for `tailscale.exe` at `C:\Program Files\Tailscale\tailscale.exe` and on PATH. MagicDNS name comes from `tailscale status --json` (`Self.DNSName`, trailing dot stripped).

## HTTP fallback (never leave the phone broken)

If HTTPS is enabled but **no certificate** can be loaded (Tailscale cert failure and local CA failure), the desktop:

1. Shows the **exact error** and fix steps on Connect PWA, Freight, and PalletVision (enable **HTTPS Certificates** + MagicDNS in Tailscale admin, sign in, `tailscale cert <name>`).
2. Serves **HTTP** on 48731–48734 and labels links **HTTP fallback** until a certificate works.
3. **Automatically switches back to HTTPS** when a certificate is obtained (retry every few minutes, daily renewal check, **Retry certificate** button).

Uncheck **Use HTTPS for phone tools** on Connect PWA to stay on plain HTTP intentionally.

## Tailscale checklist (Mark-style setup)

1. Tailscale admin → **DNS** → enable **MagicDNS** and **HTTPS Certificates**.
2. PC and phone on the same tailnet, signed in.
3. Desktop Connect PWA → **Tailscale** network mode; confirm hostname like `…sh.tailbbbe79.ts.net`.
4. Scan the hub QR (`https://…:48734/install` or hub URL).
5. If the desktop shows a cert error, click **Retry certificate** after fixing Tailscale.

Certificates renew automatically when within **30 days** of expiry.

## Troubleshooting

| Issue | What to do |
|--------|------------|
| Phone TLS error on `*.ts.net` | Confirm HTTPS Certificates in Tailscale admin; **Retry certificate**; links must use MagicDNS name, not raw 100.x IP. |
| Local LAN HTTPS error | Open `http://<desktop-ip>:48730/` and install the CA; confirm fingerprint on desktop. |
| Uploads work on HTTP fallback only | Fix Tailscale cert or local CA; toolkit upgrades links when HTTPS is ready. |
| Want plain HTTP always | Uncheck **Use HTTPS for phone tools** on Connect PWA. |

## Adding a new phone tool

1. Import `PhoneTlsManager` and `startPhoneToolServer` from `electron/tls`.
2. Call `refreshServerTls` on restart; pass `tls` from the manager and `allowInsecureHttp: tlsManager.getPhoneHttpMode()`.
3. Build URLs with `buildPhoneOrigin` / `tlsManager.buildToolBaseUrl`.
4. Keep the private-network IP allowlist on the request handler.
