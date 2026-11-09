# QA notes — November 8, 2026

## Checks completed

- `node --check app.js`: passed.
- Chromium desktop smoke test using the page HTML/CSS/JS: passed without JavaScript page errors.
- Desktop test MP4 `loadedmetadata` reported 640×360 and playback advanced: passed.
- Synthetic device orientation event updated the alpha/beta UI: passed.
- Projection and source stereo selectors updated the view mode label: passed.
- Mobile-sized Chromium view at 390 CSS px: no horizontal overflow.
- WebGL-unavailable handling: flat-video fallback and disabled VR entry button work.

## Could not test in this environment

- Container Chromium cannot create a WebGL context (the renderer falls back), so **actual VR shader output and stereo optics rendering remain unverified**.
- Real Android phone orientation events, real magnetometer-based heading, gyro-free yaw responsiveness, frame timing, VR-box fit and comfort were NOT tested.
- Remote HTTPS CORS video and the device's actual decoder compatibility were NOT tested.

## Phone test checklist

1. Serve on HTTPS. Open in Chrome on your Android handset.
2. Ensure the main canvas renders a dark blue environment (not a WebGL error).
3. Load a local MP4. Verify that a virtual screen appears and video plays smoothly.
4. Enable motion; rotate the handset in yaw and pitch and compare alpha, beta, gamma readings.
5. Choose 360° projection only for a 360° source. Ensure the view follows orientation; recenter.
6. Choose source stereo arrangement correctly, enter split-screen, verify both halves render.
7. Try headset for a short period; stop immediately if nausea, dizziness, drift or double vision occurs.
8. Test that direct remote URLs without CORS show a clear error rather than attempting a secret bypass.

**Not production-approved:** fully validated headset playback requires real-device testing and optical calibration. No real eye tracking is implemented.

## 2026-11-09 Tracking stabilization

- Corrected sensor rotation composition from `current * inverse(initial)` to `inverse(initial) * current`.
- Prevented absolute/relative coordinate-frame mismatches across browser sensor source switches.
- Added a small stationary-jitter threshold and isolated large heading-jump rejection.
- Heading diagnostics now require a meaningful excursion; tiny alpha noise does not imply working 360-degree turning.
- Added Node.js quaternion math tests in `tests/tracking.test.cjs`.
- **Phone yaw, camera optical flow, WebGL output and headset comfort are still unverified.** Camera tracking is research only.
