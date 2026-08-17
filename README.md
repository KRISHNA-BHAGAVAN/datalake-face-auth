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
- **Ultra Fast** — ML Kit fast-mode face detection (<15ms per frame at 30 FPS); capture-to-decision latency under 1 second.
- **High-Performance SQLite Store** — Binary `Float32Array` BLOB storage (`expo-sqlite`) for sub-10ms zero-parse vector loading.
- **Zero-Latency GPS Geotagging** — Asynchronous non-blocking GPS geotag worker (`last_known_location`) with 0ms added verification delay.
- **Accuracy-oriented** — ArcFace-style eye alignment, frame quality gating, and 3-photo multi-frame
  enrollment averaging; re-enrollment de-duplication keeps the gallery clean.
- **Sync & purge** — upload unsynced templates & face images to AWS (DynamoDB + S3), then delete locally.
- **Cross-platform** — single Expo/React Native codebase; NNAPI (Android) / Core ML (iOS) delegates.

---

## Tech stack

| Layer | Technology |
|---|---|
| App | React Native 0.85 · React 19 · Expo SDK 56 · Expo Router |
| Camera | `react-native-vision-camera` (0.78 MP / 768x1024 speed resolution + photo capture) |
| Face detection | Google ML Kit (`react-native-vision-camera-face-detector`, `@react-native-ml-kit/face-detection`) in fast mode (<15ms/frame) |
| Inference | `react-native-fast-tflite` (TensorFlow Lite) |
| Recognition model | MobileFaceNet (`assets/models/mobilefacenet.tflite`, ~5.2 MB) |
| Anti-spoof model | MiniFASNet V2 (`assets/models/minifasnet_v2.tflite`, ~1.75 MB) |
| Vector database | `expo-sqlite` (SQLite binary `Float32Array` BLOB store with WAL mode) |
| Location engine | `expo-location` (non-blocking background GPS geotag worker) |

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

> **No AWS required.** Enroll, verify, liveness, and anti-spoof all run **100% on-device**.
> Skip step 2 entirely and the app works fully offline — no `.env`, no errors. AWS sync is a
> purely additive feature; with it unconfigured the "Sync to AWS" button simply shows a notice.
> You do, however, need a **native dev build** — the native modules (VisionCamera, TFLite, ML Kit)
> are **not** available in Expo Go.

```bash
# 1. Install dependencies
npm install

# 2. (Optional — skip for offline-only) configure AWS sync
cp .env.example .env

# 3. Build & run a native dev client (Expo Go will NOT work)
npm run android      # or: npm run ios

# 4. Start Metro against the dev client
npm start
```

### EAS build (alternative — no local Android Studio/Xcode setup needed)

EAS is Expo's build service. The commands below use `npx eas-cli@latest`, which always runs the
newest CLI without a global install. First time only, log in (a free Expo account):

```bash
npx eas-cli@latest login
```

Two build profiles are defined in [`eas.json`](./eas.json):

| Profile | What you get | When to use |
|---|---|---|
| `development` | A **dev client** — install on device, then run `npm start` and the app connects to Metro. Supports live reload / debugging. | Day-to-day development. |
| `preview` | A **standalone installable app** (Android APK). Runs on its own — **no Metro, no laptop needed**. | Sharing a demo / testing on any device. |

**Cloud build** (Expo builds it on their servers, gives you a download link):

```bash
# Development client
npx eas-cli@latest build --profile development --platform android   # or: --platform ios

# Standalone preview build (shareable APK)
npx eas-cli@latest build --profile preview --platform android       # or: --platform ios
```

**Local build** (builds on your own machine — needs Android SDK + JDK for Android, Xcode for iOS;
add `--local`):

```bash
# Development client, built locally
npx eas-cli@latest build --profile development --platform android --local

# Standalone preview APK, built locally
npx eas-cli@latest build --profile preview --platform android --local
```

After a **development** build: install it, then run `npm start`.
After a **preview** build: just install the APK and open it — nothing else to run.

> Tip: `--platform all` builds Android and iOS together. iOS device builds require an Apple
> Developer account; Android does not.

See [`docs/vision-camera-rebuild.md`](./docs/vision-camera-rebuild.md) for the native rebuild and
on-device verification checklist.

---

## Configuration

AWS sync is **optional** and driven by environment variables (Expo loads `EXPO_PUBLIC_*` at build
time). With these unset the app is fully offline; tapping **Sync to AWS** just shows a notice and no
data leaves the device — enrollment, verification, and all local data are unaffected.

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_FACE_SYNC_API_URL` | Lambda Function URL accepting `POST { templates: [...] }` |
| `EXPO_PUBLIC_FACE_SYNC_API_KEY` | `x-api-key` header (set the matching `SYNC_API_KEY` on the Lambda) |

The sync backend (server-side biometric de-duplication, so re-enrolled people never create
duplicate rows) lives in [`aws/lambda/`](./aws/lambda/) — see its README to deploy.

Tunable thresholds (liveness, anti-spoof, recognition, quality, alignment) live in
[`src/utils/config.ts`](./src/utils/config.ts).

---

## How it works

1. **Liveness (live frame stream).** ML Kit detects faces in fast mode (<15ms per frame at 30 FPS) on native camera frames; a deterministic state machine drives blink / smile / head-turn challenges with timeouts and a real-face validity gate.
2. **0.78 MP Capture Burst.** When liveness passes, the app captures 3 distinct real photo frames at 768×1024 speed resolution with minimal latency.
3. **Quality gate.** Each frame is screened on pose, face size, sharpness, and brightness.
4. **Align + preprocess.** Eye-landmark alignment to the ArcFace canonical geometry → 112×112 crop.
5. **Anti-spoof.** MiniFASNet V2 classifies live vs photo/screen (once per flow).
6. **Recognize + match.** MobileFaceNet embedding → cosine similarity against local templates
   (threshold 0.48, calibrated on LFW — see [`benchmark/`](./benchmark/)). Enrollment averages 3 distinct photo frames into one template and de-duplicates repeats locally.
7. **Sync, then purge.** `SyncManager.sync()` uploads embeddings to AWS, where the Lambda
   de-duplicates against the datalake so re-enrolled people never create duplicate rows; local
   copies are kept (marked synced) until you explicitly **Purge Local** them — two separate actions.

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
  sync/           SyncManager (AWS sync + on-demand local purge)
  theme/          design tokens
  utils/          config (tunable thresholds)
assets/models/    mobilefacenet.tflite, minifasnet_v2.tflite
aws/lambda/       sync backend (server-side dedup) — deploy-only, not part of the app build
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
