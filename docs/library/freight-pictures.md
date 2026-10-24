# Freight Pictures

Collect **one picture per pallet** from a phone over your private network. Original file bytes are preserved (including HEIC).

## Ports and security

- Desktop HTTP server: TCP **48731**
- Accepts clients on RFC1918, link-local, and Tailscale ranges only
- Public internet clients are rejected

## Desktop setup

1. Open **Freight Pictures** and choose a parent storage folder.
2. Keep the toolkit open and the PC awake.
3. Create a shipment (company + date shipped) or use the **master link** for phone-side shipment selection.
4. Choose **Local network** or **Tailscale** for the QR/link.
5. Pick the correct desktop network address if the PC has multiple adapters.

## Phone usage

1. Scan the shipment QR, master QR, or paste the link.
2. Add up to **26 pictures** per upload batch.
3. Enter the pallet count, check the confirmation box, then tap **Upload All**.
4. On the folder confirmation step, review or edit **Folder name** (defaults to the shipment folder name so pictures land in the shipment directory). Use a different name to save this batch in a **subfolder inside that shipment folder** on the desktop. Tap **Upload** to start or **Cancel** to return without uploading.
5. Wait for checksum verification on the desktop before the shipment completes.

## Upload batch lock (1 minute)

- An active upload batch reserves the uploader for **one minute** after the last request.
- **Cancel upload** on the phone stops the transfer, removes partial files, and releases the lock immediately.
- If the phone disconnects, the lock expires after the timeout so another device can continue.

## Cancel / delete / queue behavior

- **Cancel upload** aborts in-flight files and cleans partial saves on the desktop.
- Completed pictures stay in the folder; cancel does not delete finished files.
- Reupload on the desktop generates a new link; existing pictures are not shown on the phone.

## Network troubleshooting

- Allow the toolkit on **Windows Firewall** (private network).
- Guest Wi‑Fi that blocks device-to-device traffic will fail; use LAN or Tailscale.
- Cross-subnet/VLAN works when routing allows private traffic between subnets.
- If QR fails, copy/paste the link or type `http://<desktop-ip>:48731/` manually.

## Tailscale

Install Tailscale on PC and phone, same tailnet, then switch network mode to Tailscale on the desktop Freight page.
