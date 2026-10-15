# PalletVision Frame Extraction Dependencies

## FFmpeg on Windows

The PalletVision frame extraction currently relies on FFmpeg being available in the system PATH. 

### Current Status
- **Linux/Mac**: FFmpeg typically available via package managers
- **Windows**: Must be bundled or installed separately

### Windows Deployment Options

1. **Bundle ffmpeg-static (Recommended)**
   - Install `ffmpeg-static` npm package
   - Provides cross-platform FFmpeg binary
   - No external dependencies required
   ```bash
   npm install ffmpeg-static
   ```

2. **Python OpenCV Fallback**
   - The toolkit already bundles Python
   - Install opencv-python in the bundled environment
   - Provides frame extraction without FFmpeg
   ```bash
   pip install opencv-python
   ```

3. **System FFmpeg**
   - Instruct users to install FFmpeg manually
   - Less user-friendly but smallest package size
   - Add to installer/setup docs

### Implementation Notes

The current implementation in `electron/palletvisionServer.ts` calls `ffmpeg` directly via `execFile`. To use bundled FFmpeg:

```typescript
import ffmpegStatic from 'ffmpeg-static';
// Replace 'ffmpeg' with ffmpegStatic in execFile calls
await promisify(execFile)(ffmpegStatic, ffmpegArgs, { timeout: 60000 });
```

Or use Python OpenCV:
```python
import cv2
vidcap = cv2.VideoCapture('video.webm')
# Extract frames...
```

### Testing
- Linux/Mac: FFmpeg available system-wide
- Windows: Requires bundled solution before release
