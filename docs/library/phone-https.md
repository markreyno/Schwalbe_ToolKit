# Phone HTTPS (all tools)

Freight Pictures (**48731**), PalletVision Data Collector (**48732**), and Connect PWA (**48734**) serve **HTTPS only** on those ports. QR codes, Connect PWA tiles, and copyable links always use `https://`.

## One-time phone setup

### Local network mode

1. On the desktop, open any phone tool page and note the **CA fingerprint** and **Trust this desktop** QR (plain HTTP on port **48730** — CA download only).
2. On the phone, scan the trust QR or open `http://<desktop-ip>:48730/` on the same LAN.
3. Install the CA:
   - **iPhone:** download the `.mobileconfig` profile, install it, then **Settings → General → About → Certificate Trust Settings** → enable full trust for the Schwalbe ToolKit CA. Confirm the fingerprint matches the desktop.
   - **Android:** download `ca.crt`, then **Settings → Security → Install certificate** (or Encryption & credentials). Confirm the fingerprint matches.
4. Open the tool `https://` link or Connect PWA hub. Re-scan QR codes if an old home-screen icon still points at `http://` (tool ports serve HTTPS only).

The desktop creates a **per-install local root CA** in user data; the private key never leaves the PC. Server certificates include SANs for current LAN IPs and the PC hostname, and are regenerated when addresses change.

### Tailscale mode

1. Install Tailscale on PC and phone (same tailnet). Enable **MagicDNS**.
2. On the desktop, switch the tool to **Tailscale** network mode.
3. The toolkit runs `tailscale cert <magicdns-name>` for a publicly trusted certificate. Phone links use the **MagicDNS hostname** (not the Tailscale IP — the cert will not match an IP).
4. No local CA install is required on the phone.

Certificates are renewed automatically before expiry when possible.

## Troubleshooting

| Issue | What to do |
|--------|------------|
| Desktop shows “HTTPS certificate is not ready” | Fix Tailscale/MagicDNS or local CA errors shown on the page. Do not use HTTP unless you explicitly enable the insecure toggle (not recommended). |
| Phone warns about certificate | Local mode: complete CA trust steps and verify fingerprint. Tailscale: open the MagicDNS URL, not the 100.x IP. |
| Old home-screen icon uses HTTP | Remove the old icon and scan the new `https://` QR. Tool ports redirect HTTP→HTTPS when TLS is enabled. |
| Connect PWA offline/install | Requires HTTPS (secure context). After trusting the CA (local) or using Tailscale HTTPS, service worker registration works. |

## Adding a new phone tool

1. Import `PhoneTlsManager` and `startPhoneToolServer` from `electron/tls`.
2. Listen on your fixed port with the shared manager’s TLS material (same pattern as Freight/PalletVision/Connect PWA).
3. Build all phone URLs with `buildPhoneOrigin` / `buildPhoneAddressList` from `electron/tls/phoneUrls.ts` so QRs and APIs stay on HTTPS.
4. Keep the private-network IP allowlist on the request handler; apply `applyPhoneSecurityHeaders` via the shared server wrapper.

## Insecure HTTP (troubleshooting only)

An **Allow insecure HTTP (not recommended)** toggle on the desktop disables TLS requirement and serves plain HTTP on tool ports. Default is **off**. Use only for short-term diagnosis.
