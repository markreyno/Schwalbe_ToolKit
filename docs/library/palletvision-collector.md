# PalletVision Data Collector

Collect **training data**: pallet videos plus **measured** height, width, and length. The desktop extracts frames with bundled FFmpeg.

## Ports and security

- Desktop phone server: TCP **48732** (HTTP by default; see [Phone transport](phone-https.md))
- Private-network clients only (RFC1918, link-local, Tailscale)
- Device pairing token required for uploads

## Desktop setup

1. Open the tool and choose a data folder (default under your user folder).
2. Select **Local network** or **Tailscale**.
3. Scan the QR or copy the pairing link to the phone.
4. Review the pallet table; use **Open** for folders and **Edit** for metadata fixes.

## Phone usage

1. Open the pairing link on your phone.
2. Tap **Choose video** and pick an existing clip from your gallery or files (no in-page camera recording).
3. Enter measured dimensions (inches), optional notes/reference ID.
4. Tap **Save & Upload**.

## Offline queue

- The phone client queues captures in **IndexedDB** when offline.
- Uploads retry with backoff when connectivity returns.
- Do not clear site data if you have queued captures.

## Upload lock / busy state

- Only one heavy upload or desktop import runs at a time.
- If the desktop shows upload busy, wait or check the event log for stale lock release.

## Troubleshooting

**Phone cannot connect**

- Same private network or Tailscale; check firewall for port **48732**.
- Confirm “Upload server is running” on the desktop.

**Frame extraction fails**

- FFmpeg is bundled; open the pallet folder and verify `video.webm` exists.
- Check processing status on the desktop.

**Dimensions wrong**

- The tool does **not** auto-measure; workers must enter real measurements.
