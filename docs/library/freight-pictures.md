# Freight Pictures

Collect **one picture per pallet** from a phone over your private network. Original file bytes are preserved (including HEIC).

## Ports and security

- Desktop phone server: TCP **48731** (HTTPS by default; see [Phone transport](phone-https.md))
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

1. Scan the shipment QR, master QR, or open **Freight Pictures** from the Connect hub (no `?key=` in the URL).
2. The **New shipment** page is the default home view: enter company and date, then **Start shipment**. Use the small **Home** arrow to return to the toolkit hub. There is no Cancel on this form.
3. Use **Back / New shipment** from an open shipment to start another shipment without a new QR. Company and date on an open shipment are set on the **desktop** only.
4. The page shows **Saving to:** with the desktop subfolder choice (read-only on the phone).
5. Add up to **26 pictures** per upload batch.
6. Enter the pallet count, check the confirmation box, then tap **Upload All** to start uploading immediately (no second confirmation screen).
7. During upload use **Back** or **Cancel upload** as needed. The progress bar shows percent complete. While pictures are uploading you will see guidance about background upload on Android Chrome (installed PWA).
8. Tap the **Home** arrow (top-left) to return to the Connect PWA hub. If an upload is in progress, confirm or cancel first.
9. The footer shows the app version (e.g. v1.6.8) so you can confirm which build loaded.

Stale or empty saved upload queues from an older app version are cleared automatically when you open Freight without a shipment link. A real in-progress upload may finish in the background without leaving the New shipment page.

## Resumable uploads

1. When you tap **Upload All**, the phone copies **original** pictures plus shipment metadata into **IndexedDB** before any network upload starts.
2. Pictures upload **one at a time** from the phone page, or **all remaining files via Background Fetch** when Freight is opened from the **installed Connect PWA** (see [Background upload](freight-background-upload.md)). The desktop shows whether the active batch uses **background**, **service worker**, or **phone page** upload.
3. If you leave the page, lose Wi‑Fi, or turn the screen off, the queue stays on the phone. Reopen **Freight Pictures** (shipment link, master link, or Connect hub) to see **Resuming upload: X of Y pictures**.
4. Desktop shows **Upload in progress (X of Y)** until the batch finishes.

**HTTPS only:** Phone Freight requires a working desktop certificate. There is no HTTP fallback on port 48731. Background Fetch (Android Chrome) needs HTTPS and a trusted cert. IndexedDB resume still works if you reopen the shipment link after an interruption.

## Upload batch lock (1 minute)

- An active upload batch refreshes a **one minute** lock on each request so two phones do not fight the same shipment mid-upload.
- **Cancel upload** on the phone stops the transfer, removes partial files, clears the phone queue, and releases the lock immediately.
- If the phone disconnects with pictures still uploading, the **partial batch stays** on the desktop (not deleted when the lock expires). Reopen Freight Pictures on the phone to resume. The lock expiring only matters for starting a **new** batch after everything was already uploaded but not finished—see resumable uploads above.

## Cancel / delete behavior

- **Cancel upload** aborts in-flight files and cleans partial saves on the desktop. If this batch used a new empty subfolder, it may be removed when empty.
- Completed pictures from prior batches stay in the folder; cancel does not delete finished files from earlier uploads.
- Reupload on the desktop generates a new link; existing pictures are not shown on the phone.

## Network troubleshooting

- Allow the toolkit on **Windows Firewall** (private network).
- Guest Wi‑Fi that blocks device-to-device traffic will fail; use LAN or Tailscale.
- Cross-subnet/VLAN works when routing allows private traffic between subnets.
- If QR fails, copy/paste the **https://** link from the desktop or open Freight from the Connect hub after HTTPS is ready.

## Tailscale

Install Tailscale on PC and phone, same tailnet, then switch network mode to Tailscale on the desktop Freight page.
