# Datalake Face Auth

Offline, on-device **facial recognition + liveness detection** for React Native (Expo SDK 56).
Built for **Hackathon 7** — secure authentication of field personnel in zero-network zones, designed
to integrate into the existing Datalake 3.0 app on **Android and iOS**.

Everything runs locally: face detection, liveness challenges, anti-spoofing, recognition, and
matching. No image or biometric ever leaves the device during enrollment or verification. When
connectivity returns, only numeric embeddings are optionally synced to AWS and the local copies are
purged.

> Full design write-up and evaluation-criteria mapping: [`solution.md`](./solution.md).

---

## Features

- **Fully offline** — no network calls in the auth path.
- **Liveness / anti-spoofing** — active blink / smile / head-turn challenges + a passive MiniFASNet
  CNN backstop against photo and screen-replay attacks.
- **Lightweight edge AI** — ~7 MB of active models (MobileFaceNet + MiniFASNet V2), well under the
  20 MB budget.
- **Fast** — liveness on the native frame stream; verification = one aligned embedding + a cosine
  match, tuned for a sub-second decision.
- **Accuracy-oriented** — ArcFace-style eye alignment, frame quality gating, and multi-frame
  enrollment averaging; re-enrollment de-duplication keeps the gallery clean.
- **Sync & purge** — upload unsynced templates (embeddings only) to AWS, then delete locally.
- **Cross-platform** — single Expo/React Native codebase; NNAPI (Android) / Core ML (iOS) delegates.

---

## Tech stack

| Layer | Technology |
|---|---|
| App | React Native 0.85 · React 19 · Expo SDK 56 · Expo Router |
| Camera | `react-native-vision-camera` (native frame stream + photo capture) |
| Face detection | Google ML Kit (`react-native-vision-camera-face-detector`, `@react-native-ml-kit/face-detection`) |
| Inference | `react-native-fast-tflite` (TensorFlow Lite) |
| Recognition model | MobileFaceNet (`assets/models/mobilefacenet.tflite`, ~5.2 MB) |
| Anti-spoof model | MiniFASNet V2 (`assets/models/minifasnet_v2.tflite`, ~1.75 MB) |
| Secure storage | `expo-secure-store` (OS keystore-backed) |

---

## Requirements

- Node.js 18+ and npm
- A **development build** (custom dev client) — the native modules (VisionCamera, TFLite, ML Kit)
  are **not** available in Expo Go.
- Android Studio (Android) and/or Xcode (iOS) for local native builds, or an EAS account for cloud
  builds.
- Target devices: Android 8.0+ / iOS 12+, 3 GB RAM, no GPU required.

---

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. (Optional) configure AWS sync — copy and fill in
cp .env.example .env

# 3. Build & run a native dev client (Expo Go will NOT work)
npm run android      # or: npm run ios

# 4. Start Metro against the dev client
npm start
```

### EAS cloud build (alternative)

```bash
eas build --profile development --platform android   # and/or ios
# install the build on device, then:
npm start
```

See [`docs/vision-camera-rebuild.md`](./docs/vision-camera-rebuild.md) for the native rebuild and
on-device verification checklist.

---

## Configuration

AWS sync is optional and driven by environment variables (Expo loads `EXPO_PUBLIC_*` at build time).
With these unset, the app is fully offline and `SyncManager` is a no-op that preserves local data.

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_FACE_SYNC_API_URL` | API Gateway / Lambda endpoint accepting `POST { templates: [...] }` |
| `EXPO_PUBLIC_FACE_SYNC_API_KEY` | Optional `x-api-key` header |

Tunable thresholds (liveness, anti-spoof, recognition, quality, alignment) live in
[`src/utils/config.ts`](./src/utils/config.ts).

---

## How it works

1. **Liveness (live frame stream).** ML Kit detects faces on native camera frames; a deterministic
   state machine drives blink / smile / head-turn challenges with timeouts and a real-face validity
   gate. No heavy inference per frame.
2. **Capture burst.** When liveness passes, the app captures a short burst of stills.
3. **Quality gate.** Each frame is screened on pose, face size, sharpness, and brightness.
4. **Align + preprocess.** Eye-landmark alignment to the ArcFace canonical geometry → 112×112 crop.
5. **Anti-spoof.** MiniFASNet V2 classifies live vs photo/screen (once per flow).
6. **Recognize + match.** MobileFaceNet embedding → cosine similarity against local templates
   (threshold 0.65). Enrollment averages several frames into one template and de-duplicates repeats.
7. **Sync & purge.** `SyncManager.syncAndPurge()` uploads embeddings to AWS and deletes local copies.

---

## Project structure

```
src/
  app/           Expo Router screens (index, enroll, verify, about)
  components/     CameraFlow + overlays + UI kit
  hooks/          useFaceAuthVision (active), useFaceAuth (legacy/rollback)
  liveness/       LivenessStateMachine, useLiveness
  ml/             FaceRecognizer, FaceAntiSpoof, ImageProcessor
  recognition/    FrameQuality, CosineSimilarity
  storage/        OfflineStore (SecureStore)
  sync/           SyncManager (AWS sync & purge)
  theme/          design tokens
  utils/          config (tunable thresholds)
assets/models/    mobilefacenet.tflite, minifasnet_v2.tflite
docs/             vision-camera-rebuild.md
solution.md       design + evaluation write-up
```

---

## Scripts

| Command | Action |
|---|---|
| `npm start` | Start Metro (use with a dev client) |
| `npm run android` | Build & run the Android dev client |
| `npm run ios` | Build & run the iOS dev client |
| `npm run web` | Start the web target |
| `npm run lint` | Lint with Expo ESLint |

---

## License

MIT — see [`LICENSE`](./LICENSE). Bundled models and libraries (MobileFaceNet, MiniFASNet,
ML Kit, VisionCamera, TensorFlow Lite, Expo) are open-source under their respective permissive
licenses.
</content>
