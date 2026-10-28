# Connect PWA

**Connect PWA** gives phones a single home-screen hub that links to **Freight Pictures** (port **48731**) and **PalletVision Data Collector** (port **48732**). The hub runs on its own server on port **48734**.

## What it does

- Desktop page shows a QR code and copyable link to the phone hub
- Optional installable Progressive Web App (manifest + service worker) when **HTTPS** is enabled
- Status indicator shows whether desktop tool servers are reachable from the hub
- Tracks recently connected phones (IP, user agent, last seen)
- **Tailscale** or **local network** modes (**HTTPS** by default on port **48734**; HTTP fallback if the certificate is not ready)

## Step-by-step (desktop)

1. Open **Connect PWA** from the tool hub.
2. Choose **Local network** or **Tailscale** (same idea as other phone tools).
3. If needed, pick the correct **Desktop network address** or enter a **Manual IP fallback** (private RFC1918, link-local, or Tailscale only).
4. Scan the QR code or copy the link to the phone (opens **`/install`**).
5. Keep the toolkit open on the desktop.

## Step-by-step (phone)

1. Scan the desktop **Connect PWA** QR code or open the link. It goes to **`/install`** (not the hub directly).
2. **HTTPS (default):** trust the Tailscale cert (tailnet) or install the desktop CA (local LAN), then use the install page (Android install prompt or iOS **Add to Home Screen**).
3. **HTTP fallback:** if the desktop shows a certificate error, links use HTTP until fixed; uploads still work. Use **Continue in browser** on the install page if needed.
4. On the **warehouse hub** (`/`), confirm the status line when possible and tap a tool tile for **Freight Pictures** or **PalletVision**.
5. Use the **Home** arrow (top-left) on tool pages to return to the hub.

The hub (`/`) never shows install prompts. Install instructions live only on **`/install`**.

### iOS limitation

Safari opens scanned links in the **browser**, not inside an installed web app. After install (HTTPS), workers should open **Schwalbe ToolKit from the home screen**.

### Android link capturing

When HTTPS is enabled, the manifest can open in-scope links in the installed PWA where Chrome supports link capturing.

## Network modes

### Local network

- Hub URL uses your LAN IPv4 addresses (10.x, 172.16–31.x, 192.168.x).
- Allow Schwalbe ToolKit through **Windows Firewall** on private networks.

### Tailscale

1. Install Tailscale on PC and phone and sign in to the same tailnet.
2. Switch network mode to **Tailscale** on the desktop Connect PWA page.
3. QR/link use your MagicDNS name (or Tailscale IP in HTTP mode).

## HTTP vs HTTPS

| | HTTP (default) | HTTPS (optional) |
|--|----------------|------------------|
| Uploads / hub in browser | Yes | Yes (after trust) |
| PWA install / offline (service worker) | No | Yes |
| Picker Water push in installed PWA | No | Yes |

See [Phone transport](phone-https.md) for certificate setup when HTTPS is enabled.

## Troubleshooting

**Phone cannot open the hub**

- Same Wi‑Fi or Tailscale as the PC.
- Try manual IP fallback with the PC’s correct LAN address.
- Check Windows Firewall for ports **48734**, **48731**, and **48732**.

**Status shows tools not responding**

- Open Freight Pictures and PalletVision on the desktop and ensure each tool’s phone server is running (storage folder chosen where required).
