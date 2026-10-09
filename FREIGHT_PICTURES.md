# Freight Pictures

Open Freight Pictures in the toolkit and choose a parent storage folder. Keep the toolkit open and the desktop awake. The server uses TCP port 48731 and accepts connections from any device on private networks (RFC1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16). This includes devices on adjacent subnets or VLANs within your site LAN. Allow the toolkit on your private network in Windows Firewall if needed; no router port forwarding is required.

Create a shipment using company and date shipped. Shipments are stored as Company_YYYY-MM-DD; duplicate names receive a numeric suffix. The permanent master QR/link lets a phone create or select an open shipment. Use the network address selector if the computer has multiple adapters or if devices on other subnets cannot reach the default address.

On the phone, collect one picture per pallet (up to 26 pictures per upload batch), enter the matching pallet count, confirm, and select Upload All. Uploads preserve original file bytes, including HEIC. Each photo is verified against its SHA-256 checksum after saving. The shipment closes only after all files are verified. Failed uploads can be retried while keeping the phone page open. A batch reserves the uploader for ten minutes after its last request.

Completed shipments can be reopened using Reupload on the desktop. A new link is generated; Reupload All adds pictures without replacing the originals. Existing pictures are not exposed to the phone.

Shipment settings and link tokens are stored in the toolkit user-data folder. Pictures remain in the selected storage folder. Closing the toolkit stops the server. Unfinished shipments and the master link are restored on restart, but an interrupted in-memory upload batch must be started again; already saved files remain in the folder. Desktop network address changes require rescanning a current QR code.

**Cross-subnet access:** Devices on different subnets or VLANs can connect as long as they are on private networks and routing is configured between them. If automatic network discovery fails or QR scanning doesn't work, manually copy and paste the upload link, or type the server IP address directly into the mobile browser. The server restricts access to RFC1918 private IP ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x) to prevent exposure to the public internet.

Validation: `npm run build` and `npx playwright test tests/freight.spec.ts tests/desktop.spec.ts`. The mobile test uses installed Microsoft Edge. Actual iPhone/Android camera behavior and office-network firewall rules should be tested on site.

Uploads check image signatures and basic container structure against the filename extension before saving. This blocks renamed non-image files and common truncated containers; it is not malware scanning or full image decoding. Original bytes remain unchanged.


The phone prepares checksums in a background worker when pictures are selected. Uploads begin as each checksum becomes available while later pictures continue preparing, with per-picture transfer percentages. The server requires the picture checksum before accepting each file and still verifies saved originals before completing the shipment.
