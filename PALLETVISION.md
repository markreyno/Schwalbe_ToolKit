# PalletVision Data Collector

Open PalletVision in the toolkit and choose a data storage folder. Keep the toolkit open and the desktop awake. The server uses TCP port 48732 and accepts connections from any device on private networks (RFC1918: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) or Tailscale (100.64.0.0/10).

**Purpose:** Collect high-quality pallet training data by recording walkaround videos and entering actual measured dimensions. This is a **data collection tool only** - it does not measure dimensions automatically or perform object detection.

**Network modes:**
- **Local network:** Uses your LAN IP addresses (default). Works across subnets and VLANs on the same site as long as routing is configured.
- **Tailscale:** Uses your Tailscale VPN address. Works from anywhere on your tailnet, including over the internet, without exposing the service publicly.

**Tailscale setup:**
1. Install Tailscale on the PC running the toolkit: https://tailscale.com/download
2. Install Tailscale on your phone (iOS or Android)
3. Sign in to the same Tailscale account (tailnet) on both devices
4. In the toolkit, switch Network mode to "Tailscale"
5. The QR code and link will use your Tailscale address

## Workflow

1. On the desktop, choose a data storage folder (default: `C:\PalletVision\data`)
2. Scan the QR code on your phone or manually copy the pairing link
3. On the phone:
   - Tap **New Pallet** to start
   - Record a 10-20 second video walking around the pallet
   - Review the video and retake if needed
   - Enter **measured height, width, and length in inches**
   - Height = floor to highest point, including pallet base
   - Width and length default to 40×48 inches but are always editable
   - Add optional notes and reference/barcode ID
   - Tap **Save & Upload**
4. The phone saves locally first, then uploads when connected
5. Desktop stores the video and extracts ~10-20 representative frames
6. Repeat for the next pallet

## Data storage structure

```
C:\PalletVision\data\
├── pallet_0001\
│   ├── video.mp4
│   ├── metadata.json
│   └── frames\
│       ├── frame_0001.jpg
│       ├── frame_0002.jpg
│       └── ...
├── pallet_0002\
│   └── ...
```

Example `metadata.json`:

```json
{
  "schema_version": 1,
  "pallet_id": "pallet_0001",
  "capture_id": "cap_1729012345_a1b2c3",
  "captured_at": "2026-10-15T16:30:00Z",
  "height_inches": 74.5,
  "width_inches": 40.0,
  "length_inches": 48.0,
  "height_includes_base": true,
  "notes": "Standard warehouse pallet",
  "reference_id": "PALLET-12345",
  "video_file": "video.mp4",
  "device_token": "abc12345",
  "annotation_status": "unlabeled",
  "processing_status": "complete",
  "frames_extracted": 15
}
```

## Phone features

- **Video recording:** Uses native camera with MediaRecorder or file input
- **Playback and retake:** Review before proceeding
- **Dimension validation:** Rejects missing, zero, or negative values
- **Local queue:** Saves to IndexedDB with Pending/Uploading/Uploaded/Failed status
- **Automatic retry:** Failed uploads retry with exponential backoff
- **Persistent storage:** Local copy kept until desktop confirms storage
- **Recent captures list:** View upload history and status

## Desktop features

- **Configurable root folder** with default `C:\PalletVision\data`
- **One folder per pallet** with unique pallet ID (pallet_0001, pallet_0002, etc.)
- **Original video preservation** in MP4 format
- **Automatic frame extraction** using FFmpeg (10-20 frames per video)
- **Metadata storage** with all capture details
- **Idempotent uploads** by capture ID (retries don't create duplicates)
- **Streaming uploads** to temp file, atomic commit on success
- **Size and type limits** enforced
- **Path sanitization** for security
- **Processing status tracking** (pending/extracting/complete/failed)
- **Open folder button** for each pallet

## Security

✅ **Private network only:** Connections from public internet IPs are blocked  
✅ **Device pairing:** Each phone gets a unique authentication token  
✅ **RFC1918 + Tailscale filtering:** Accepts only private network ranges  
✅ **Origin validation:** Maintains CSRF protection  
✅ **Path sanitization:** Prevents directory traversal attacks  

## Important distinctions

- **This tool does NOT measure dimensions** - workers must measure and enter actual values
- **This tool does NOT train YOLO models** - it collects raw training data
- **This tool does NOT generate bounding boxes** - images require manual annotation later
- Measured dimensions are **ground-truth values** for training, not automated measurements
- Videos and frames are stored for future annotation and model training

## Frame extraction

The desktop automatically extracts frames using FFmpeg:
1. Samples frames at intervals (every 5th frame)
2. Scales to 640px width while maintaining aspect ratio
3. Saves as high-quality JPEG files
4. Targets approximately 15 frames per video
5. Updates processing status when complete

## Validation

Build and test: `npm run build` and `npx playwright test tests/palletvision.spec.ts`

The mobile interface should be tested with actual phones on the network. Test scenarios:
- Record and upload a video
- Validation of missing/invalid dimensions
- Retry failed uploads
- Cross-subnet connectivity
- Tailscale mode (if available)
- Frame extraction completion

## Next steps

After collecting pallets:
1. Annotate frames manually using tools like CVAT or LabelImg
2. Create bounding boxes for `pallet_load` and `pallet_base` classes
3. Export annotations in YOLO format
4. Train a YOLO model on the annotated dataset
5. Use measured dimensions for height estimation research

**Cross-subnet access:** Devices on different subnets or VLANs can connect as long as they are on private networks and routing is configured between them. If automatic network discovery fails or QR scanning doesn't work, manually copy and paste the upload link, or type the server IP address directly into the mobile browser. The server restricts access to RFC1918 private IP ranges and Tailscale CGNAT ranges to prevent exposure to the public internet.
