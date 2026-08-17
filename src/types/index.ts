export type LivenessChallengeType = 'BLINK' | 'SMILE' | 'TURN_HEAD_LEFT' | 'TURN_HEAD_RIGHT';

export type LivenessState = {
  status: 'IDLE' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  currentChallenge: LivenessChallengeType | null;
  challengesRemaining: LivenessChallengeType[];
  timeoutAt: number | null;
  message: string;
};

export type FaceLandmarkResult = {
  hasFace: boolean;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  blendshapes: Record<string, number> | null;
  yaw: number;
  pitch: number;
  roll: number;
  smilingProbability?: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
};

export type LocationData = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type FaceTemplate = {
  id: string; // E.g., user id
  embedding: number[]; // Flattened float32 array
  embeddings?: number[][]; // Optional multi-gallery embeddings for pose-diverse matching
  createdAt: number;
  isSynced: boolean;
  imageUri?: string; // Optional local SSD URI to enrolled face crop image
  lastKnownLocation?: LocationData; // Accurate GPS geotag captured during verification
};

export type AntiSpoofResult = {
  isLive: boolean;
  liveScore: number;
  scores: [number, number, number];
};

export type SyncResult = {
  synced: number; // newly inserted into the datalake
  duplicates?: number; // skipped server-side because the person already exists
  error?: string;
};
