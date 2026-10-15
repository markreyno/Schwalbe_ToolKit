# PalletVision Data Collector

The **PalletVision Data Collector** is a tool for collecting training data for the PalletVision model. Workers record videos of pallets from multiple angles using their phones and enter actual measured dimensions. The desktop application receives these videos, extracts representative frames, and stores everything in a structured format ready for annotation and model training.

## Overview

**PalletVision Data Collector** enables efficient collection of pallet training data:

- **Mobile video capture**: Workers use their phone cameras to record pallet videos
- **Measured dimensions**: Workers enter actual measured height, width, and length in inches
- **Automatic frame extraction**: Desktop app extracts 10-20 representative frames from each video
- **Structured storage**: Everything stored in folders with metadata.json
- **Network flexibility**: Works over local network or Tailscale
- **Offline queue**: Phone client queues uploads locally when network is unavailable

## Architecture

- **Desktop HTTP server** on port 48732
- **Mobile web client** accessed via QR code
- **Device pairing** via token exchange
- **Multipart streaming uploads** (no memory limits)
- **FFmpeg-based frame extraction** (bundled, cross-platform)
- **RFC1918 + Tailscale IP filtering** for security

## Setup

1. Open the **PalletVision Data Collector** tool from the hub
2. Choose a storage folder (default: `C:\PalletVision\data`)
3. Select network mode:
   - **Local network**: Phone and desktop on same private network
   - **Tailscale**: Install Tailscale on both devices, sign in to same tailnet
4. Scan QR code or copy link to phone
5. Start collecting data

## Usage

### On Phone:

1. Open the pairing link
2. Tap "Start New Pallet"
3. Record video of pallet (10-20 seconds, walk around it)
4. Enter measured dimensions in inches
5. Add optional notes and reference ID
6. Tap "Save & Upload"

### On Desktop:

- View collected pallets in the table
- Click "Open" to view folder with video and frames
- Click "Edit" to update measurements, device, notes, or mark as reviewed
- Processing status shows extraction progress

## Data Format

Each pallet is stored in a numbered folder:

```
C:\PalletVision\data\
└── pallet_0001\
    ├── video.webm
    ├── metadata.json
    └── frames\
        ├── frame_0001.jpg
        ├── frame_0002.jpg
        └── ...
```

### metadata.json Fields

Required fields:
- `pallet_id`: Unique pallet identifier (e.g. "pallet_0001")
- `height_inches`: Measured height (number)
- `width_inches`: Measured width (number)
- `length_inches`: Measured length (number)
- `device`: Capture device (e.g. "iPhone", "Android")
- `frames_extracted`: Count of extracted frames (number)
- `annotations_reviewed`: Whether annotations have been reviewed (boolean)

Additional fields:
- `capture_id`: Unique capture identifier
- `captured_at`: ISO 8601 timestamp
- `notes`: Optional notes
- `reference_id`: Optional barcode/reference ID
- `video_file`: Video filename
- `processing_status`: "pending", "extracting", "complete", or "failed"
- `schema_version`: Metadata schema version

## Editing Pallets

Click "Edit" on any pallet to update:
- Height, width, length (must be positive numbers)
- Device (required field)
- Notes
- Annotations reviewed checkbox

Changes are written back to metadata.json immediately.

## Network Security

- Only accepts connections from private IP ranges (RFC1918)
- Tailscale CGNAT range (100.64.0.0/10) supported
- Public IPs are rejected
- Device authentication required for all uploads

## Troubleshooting

**Phone can't connect:**
- Ensure phone and desktop on same private network
- Try Tailscale mode if subnets are separated
- Check that desktop shows "Upload server is running"

**Frame extraction fails:**
- FFmpeg is bundled and should work out-of-the-box
- Check processing status in desktop UI
- Open pallet folder to verify video file exists

**Upload stuck:**
- Phone client retries automatically with backoff
- Check network connectivity
- Re-pair device if token expired
