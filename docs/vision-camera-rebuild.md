# VisionCamera frame-stream refactor — rebuild & verify

Liveness now runs on the real-time VisionCamera frame stream (native ML Kit via
`react-native-vision-camera-face-detector`). The heavy work (anti-spoof + recognition
embeddings) runs once, in a short photo burst the moment liveness passes. This removes
the old 1.2s `takePictureAsync` loop and the pure-JS `jpeg-js` decode on every frame.

## What changed

- **Added deps:** `react-native-vision-camera` (5.0.11), `react-native-vision-camera-face-detector` (2.0.1). No worklets install — reanimated 4 already provides `react-native-worklets` 0.8.3, which VisionCamera v5 (Nitro) auto-uses.
- **New:** `src/hooks/useFaceAuthVision.ts` — frame-stream liveness + one-shot recognition burst.
- **Rewired:** `src/components/CameraFlow.tsx` now renders VisionCamera `<Camera>` with a face-detector output + photo output. All overlays unchanged.
- **`app.json`:** added `newArchEnabled: true` (VisionCamera v5 + Nitro require the new architecture). Camera permission still comes from the existing `expo-camera` config plugin.
- **Legacy kept (dead, for rollback):** `src/hooks/useFaceAuth.ts`, `src/camera/CameraPreview.tsx` (expo-camera + `@react-native-ml-kit/face-detection`). Remove once the new path is verified on-device.

## Rebuild (required — new native modules, Expo Go will NOT work)

```sh
# deps already installed via: npx expo install react-native-vision-camera react-native-vision-camera-face-detector

# Option A — local native build (fastest iteration, needs Android Studio / Xcode)
npx expo run:android      # or: npx expo run:ios

# Option B — EAS dev-client build (eas.json already present)
eas build --profile development --platform android   # and/or ios
# install the resulting build on the device, then:
npx expo start --dev-client
```

A plain JS reload is not enough — the native VisionCamera/Nitro modules must be compiled in.

## Verify on device (could not be tested in this environment)

1. **Turn-direction sign.** Enroll uses SMILE → TURN_HEAD_LEFT → TURN_HEAD_RIGHT. If left/right
   are swapped on the front camera, negate yaw in `useFaceAuthVision.ts` `onFacesDetected`:
   `yaw: -f.yawAngle * DEG2RAD`.
2. **Blink.** Verify uses BLINK; confirm the open→closed transition fires (thresholds in
   `config.liveness.blinkOpenBaseline` / `blinkClosedThreshold`).
3. **Capture burst.** Confirm `capturePhotoToFile` returns a path that `Image.getSize` +
   `ImageProcessor` accept (the code prepends `file://`). Tune `recognition.verifyEmbeddings`
   (3) / `enrollEmbeddings` (5) if the burst feels slow.
4. **Anti-spoof.** Runs on the captured burst frames; confirm real faces pass and a
   photo/screen is rejected. Threshold: `config.antiSpoof.liveScoreThreshold`.
5. **Quality gate** thresholds (`config.quality`) — loosen if real faces get rejected.

## Rollback

Point `CameraFlow.tsx` back to the legacy hook:
`import { useFaceAuth } from '../hooks/useFaceAuth'` and restore the `CameraPreview` render.
The legacy expo-camera path is unchanged on `main` / earlier commits.
