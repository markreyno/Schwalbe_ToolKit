# Freight Pictures

Collect **one picture per pallet** from a phone over your private network. Original file bytes are preserved (including HEIC).

## Ports and security

- Desktop HTTPS server: TCP **48731** (see [Phone HTTPS](phone-https.md))
- Accepts clients on RFC1918, link-local, and Tailscale ranges only
- Public internet clients are rejected

## Desktop setup

1. Open **Freight Pictures** and choose a parent storage folder.
2. Keep the toolkit open and the PC awake.
3. Create a shipment (company + date shipped) or use the **master link** for phone-side shipment selection.
4. For each open shipment, choose **Subfolder for phone uploads**: pick an existing subfolder, type a new one, or **None** for the shipment folder root. Tap **Apply subfolder** before scanning the QR.
5. Choose **Local network** or **Tailscale** for the QR/link.
6. Pick the correct desktop network address if the PC has multiple adapters.

## Phone usage

1. Scan the shipment QR, master QR, or paste the link.
2. **Edit** company/date on the header, or use **Back / New shipment** to start a new shipment without a new QR.
3. The page shows **Saving to:** with the desktop subfolder choice (read-only on the phone).
4. Add up to **26 pictures** per upload batch.
5. Enter the pallet count, check the confirmation box, then tap **Upload All**.
6. Confirm on **Ready to upload?** with **Upload** or **Cancel**.
7. During upload use **Back** or **Cancel upload** as needed.
8. Tap the **Home** arrow (top-left) to return to the Connect PWA hub. If an upload is in progress, confirm or cancel first.
9. The footer shows the app version (e.g. v1.6.4) so you can confirm which build loaded.

## Upload batch lock (1 minute)

- An active upload batch reserves the uploader for **one minute** after the last request.
- **Cancel upload** on the phone stops the transfer, removes partial files, and releases the lock immediately.
- If the phone disconnects, the lock expires after the timeout so another device can continue.

## Cancel / delete behavior

- **Cancel upload** aborts in-flight files and cleans partial saves on the desktop. If this batch used a new empty subfolder, it may be removed when empty.
- Completed pictures from prior batches stay in the folder; cancel does not delete finished files from earlier uploads.
- Reupload on the desktop generates a new link; existing pictures are not shown on the phone.

## Network troubleshooting

- Allow the toolkit on **Windows Firewall** (private network).
- Guest Wi‑Fi that blocks device-to-device traffic will fail; use LAN or Tailscale.
- Cross-subnet/VLAN works when routing allows private traffic between subnets.
- If QR fails, copy/paste the link or type `https://<desktop-host>:48731/` manually.

## Tailscale

Install Tailscale on PC and phone, same tailnet, then switch network mode to Tailscale on the desktop Freight page.
