export type LivenessChallengeType = 'BLINK' | 'SMILE' | 'TURN_HEAD_LEFT' | 'TURN_HEAD_RIGHT';

export type LivenessState = {
  status: 'IDLE' | 'IN_PROGRESS' | 'PASSED' | 'FAILED';
  currentChallenge: LivenessChallengeType | null;
  challengesRemaining: LivenessChallengeType[];
  justPassedChallenge?: LivenessChallengeType;
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

export type FaceTemplate = {
  id: string; // E.g., user id
  embedding: number[]; // Primary flattened float32 array
  embeddings?: number[][]; // Multi-pose template vectors (e.g., [frontal, left, right])
  createdAt: number;
  isSynced: boolean;
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
