# MotionVR — Free experimental browser VR video player

An original, self-contained, dependency-free prototype for watching browser-supported videos in a simulated VR cinema, 180° or 360° equirectangular scene, optionally split into two eyes for a generic phone VR box.

**Status: experimental, not a production/comfort-validated Android VR app.** Its head tracking depends on *actual* browser orientation readings. **It has no real eye tracking**; the crosshair is a head-gaze reference only.

## Features

- Video files via device picker. The file is accessed through a temporary `blob:` URL; no upload, server backend, or analytics.
- Direct HTTPS video resource URL (MP4/WebM etc.) where the server supports cross-origin video playback for WebGL texture use. A YouTube watch URL is not a direct media URL. DRM/streaming manifests are unsupported.
- Standard flat video in an anchored virtual cinema, 360° equirectangular, 180° equirectangular; regular 2D or side-by-side/top-bottom 3D source layouts.
- Split-screen stereo view for a cardboard-style phone headset. No optics distortion profile or lens calibration yet.
- Device orientation readings (alpha/beta/gamma) via DeviceOrientationEvent; smooth recenterable relative head orientation and touch drag fallback.
- Adjustable FOV and smoothing; fullscreen and headset modes; simple video controls.
- Designed to use HTTPS without extra permissions beyond browser orientation permission. No camera/microphone/GPS/storage APIs.

## How to use on your phone

1. Host the **three application files** (`index.html`, `style.css`, `app.js`) on any HTTPS static host (GitHub Pages, Cloudflare Pages, Netlify, etc.). `localhost` is suitable for local development. Opening `index.html` directly using file:// may not enable sensors.
2. Open in Chrome for Android. Pick a local video or paste an HTTPS URL ending in a **direct video resource** with CORS enabled. Press Play.
3. Select `Virtual cinema`, `360° equirectangular`, or `180° equirectangular` to match the video **source**. Select mono, SBS, or top/bottom to match the **source stereoscopy**.
4. Press **Enable motion sensors**. Rotate the phone and inspect the alpha/beta/gamma readings. Alpha may be unavailable or unreliable without a gyroscope/magnetometer. Head tracking is not guaranteed even if beta/gamma change.
5. While looking straight ahead, press **Recenter**. Select **Enter VR mode**, rotate the phone to landscape, put it in the VR box, adjust lenses carefully. Exit if movement feels delayed or uncomfortable.
6. If sensors aren't exposed or heading does not change, use touch controls or a native Android app with `TYPE_GEOMAGNETIC_ROTATION_VECTOR` as a next step.

## Limitations and honesty

- DeviceOrientation events are browser- and device-dependent. A browser cannot manufacture compass data that is absent from hardware or withheld by the browser. **Smooth, precise head tracking without a gyroscope is not guaranteed**. Detecting changes in `alpha` is a diagnostic hint, not proof of accurate tracking.
- No physical eye tracker can be made from an accelerometer or compass. A basic phone VR box typically blocks the phone's cameras from viewing the eyes; true eye tracking needs eye-facing camera(s) or purpose-built hardware.
- Video decoding depends on the browser. MP4/H.264/AAC is generally most compatible; MKV/AVI support is not guaranteed. Remote video textures require CORS and can fail even if a URL works in a normal player.
- No YouTube page URLs, DRM, subtitle tracks, playlist support, streaming manifests, or arbitrary webpage playback.
- The headset view has **no optical distortion correction or IPD calibration**: correct stereo geometry/comfortable viewing is not verified for a particular lens/headset. Not recommended for prolonged sessions, and stop on discomfort.
- Browser motion permissions generally require HTTPS. A local file opened with file:// is not the intended deployment method.
- This project was tested in a desktop browser with simulated events, **not** on your Android handset or a physical headset; live performance, yaw tracking and comfort remain unverified.

## Architecture / privacy

Static HTML/CSS/JS. WebGL 1 shader renders video into either a screen plane or equirectangular view. No third-party JavaScript packages, web requests initiated by the app beyond the direct video URL you supply, analytics, account, or backend. For a remote URL, your browser **does** contact that host and exposes ordinary connection metadata to it. Local file object URLs are released when replaced.

## Development

Serve with `python3 -m http.server 8000` for desktop tests on `http://localhost:8000`; use an HTTPS host on mobile.

## Source

Inspired by the general idea of sensor-reactive visuals in [shajidhasan/mobile-fluid-sim](https://github.com/shajidhasan/mobile-fluid-sim), but uses original code and does not copy that project's fluid code. Motion controls reference the browser DeviceOrientation API; no dependency on the example project.

## License

MIT. This prototype is provided AS IS, without warranty, and is not a certified VR product.

## Deployment

**Recommended:** a separate public `diluxlane/MotionVR` repository and a Vercel static project. The files are at the root. Import into Vercel with framework **Other** and **no build command**, then deploy. The `vercel.json` file sets privacy-oriented headers without disabling browser motion sensors. The default `.vercel.app` domain provides HTTPS.

Do not add third-party tracking, upload endpoints, or undocumented remote proxies. Do not advertise real eye tracking or gyroscope-equivalent tracking until hardware-validated. Do not confuse the interface's head-gaze crosshair with optical eye tracking.

## Tracking improvements and camera research

The sensor-only renderer now uses `inverse(initial) × current` for recentered relative device orientation, suppresses sub-degree jitter, filters isolated implausible heading jumps, and reports a meaningful heading excursion rather than treating a tiny compass fluctuation as proof of full yaw tracking. Real-device results remain unverified.

### Camera-assisted tracking — proposed research, not implemented

A user-authorized rear-camera optical-flow experiment could estimate *relative* orientation from features tracked across consecutive low-resolution frames. Calibrated angular displacement could be combined with gravity/compass measurements and filtered according to visual-tracking confidence, but this would not provide true eye tracking, universally accurate 360° yaw, or six-degree-of-freedom positional VR. Occluded cameras, darkness, blank walls, fast turns, limited camera frame rates and accumulated drift are significant limitations. A headset may physically cover the rear camera.

If implemented, require an explicit on/off permission gesture, capture no audio, process frames entirely locally, upload or store no imagery, stop all camera tracks on disable/page hide, and clearly label tracking as experimental. The Android geomagnetic rotation-vector API remains a more direct accelerometer-plus-magnetometer option when the device exposes it.

## Full immersive 360° (no virtual cinema screen)

MotionVR defaults to **Immersive 360°** instead of Virtual Cinema. Use an actual equirectangular 360° MP4/WebM (typically approximately 2:1 for monoscopic footage), and select **Video projection → Immersive 360° — inside the video**. Choose **Normal 2D (mono)** for a regular panoramic video; VR Box Mode duplicates the same surround view for both eyes. This is 3DoF rotational viewing, not stereo depth or physical movement through the filmed scene. Ordinary flat videos cannot be made genuinely 360° by changing modes: select **Virtual cinema — floating screen** for those. The VR shader and sensor tracking are unchanged by this default-mode improvement.

Official A-Frame public 360° test media: `https://cdn.aframe.io/360-video-boilerplate/video/city.mp4`. The asset project documents CORS-enabled serving, but compatibility should still be checked on each device.
