# Connect PWA

**Connect PWA** gives phones a single home-screen hub that links to **Freight Pictures** (port **48731**) and **PalletVision Data Collector** (port **48732**). The hub runs on its own server on port **48734**.

## What it does

- Desktop page shows a QR code and copyable link to the phone hub
- Phone hub is an installable Progressive Web App (manifest + service worker)
- Status indicator shows whether desktop tool servers are reachable from the hub
- Tracks recently connected phones (IP, user agent, last seen)
- Optional **Tailscale HTTPS** via `tailscale cert` (non-blocking; see limitations below)

## Step-by-step (desktop)

1. Open **Connect PWA** from the tool hub.
2. Choose **Local network** or **Tailscale** (same idea as other phone tools).
3. If needed, pick the correct **Desktop network address** or enter a **Manual IP fallback** (private RFC1918, link-local, or Tailscale only).
4. Scan the QR code or copy the link to the phone (opens **`/install`**).
5. Keep the toolkit open on the desktop.

## Step-by-step (phone)

1. Scan the desktop **Connect PWA** QR code or open the link. It goes to **`/install`** (not the hub directly).
2. Follow the install page:
   - **Android (Chrome):** use **Install app** when offered, or the browser install prompt.
   - **iPhone (Safari):** **Share → Add to Home Screen**, then open **Schwalbe ToolKit** from the home screen icon.
3. Open the installed app (or continue in the browser via the link on the install page).
4. On the **warehouse hub** (`/`), confirm the status line when possible and tap a tool tile for **Freight Pictures** or **PalletVision**.
5. Use the **Home** arrow (top-left) on tool pages to return to the hub.

The hub (`/`) never shows install prompts. Install instructions live only on **`/install`**.

### iOS limitation

Safari opens scanned HTTPS links in the **browser**, not inside an installed web app. After install, workers should open **Schwalbe ToolKit from the home screen**; the install page shows this when it detects a prior install. Scanning the QR again in Safari will not switch to the installed app.

### Android link capturing

The web app manifest sets `handle_links: preferred` and `launch_handler.client_mode: navigate-existing` so HTTPS links in scope (including `/install`) can open the installed PWA when Chrome supports link capturing.

## Network modes

### Local network

- Hub URL uses your LAN IPv4 addresses (10.x, 172.16–31.x, 192.168.x).
- Allow Schwalbe ToolKit through **Windows Firewall** on private networks.
- No router port forwarding is required.

### Tailscale

1. Install Tailscale on PC and phone and sign in to the same tailnet.
2. Switch network mode to **Tailscale** on the desktop Connect PWA page.
3. QR/link use your MagicDNS name or Tailscale IP (100.64.0.0/10).
4. Optionally, the desktop may obtain a TLS certificate with `tailscale cert` for HTTPS on port **48735** (see desktop page when available).

## HTTPS (required)

All hub and tool links use **HTTPS on port 48734** (same port as before; the old separate Tailscale port **48735** is removed). See [Phone HTTPS](phone-https.md) for trusting the desktop CA (local network) or Tailscale MagicDNS setup.

With HTTPS, Connect PWA gets a **secure context**: the service worker and browser-driven install work after the phone trusts the certificate (local) or uses Tailscale’s public cert.

## Troubleshooting

**Phone cannot open the hub**

- Same Wi‑Fi or routed private network as the PC, or use Tailscale.
- Try manual IP fallback with the PC’s correct LAN address.
- Check Windows Firewall for ports **48734**, **48731**, and **48732**.

**Status shows tools not responding**

- Open **Freight Pictures** or **PalletVision** on the desktop once so their servers start.
- Keep the toolkit running; closing it stops all upload servers.

**Freight asks for a key**

- Open the hub tile for Freight, or use the **master link** from the Freight Pictures desktop page if you need a specific shipment.

**Public IP rejected**

- All three servers only accept clients from private ranges (RFC1918, 169.254.x.x, Tailscale 100.64.0.0/10 and fd7a:115c:a1e0::/48). Public IPs receive HTTP 403.
