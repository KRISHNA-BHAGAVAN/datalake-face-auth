import { config } from '../utils/config';

/**
 * Cheap, pixel-free quality gate from ML Kit face geometry. Used to skip poor
 * frames (too small / off-angle) before the expensive embedding step so they
 * don't pollute the averaged template. Brightness + sharpness (pixel-based) are
 * checked separately in ImageProcessor.
 */
export type QualityVerdict = { ok: true } | { ok: false; reason: string };

interface FaceGeometry {
  frame: { width: number };
  rotationX: number; // pitch (degrees)
  rotationY: number; // yaw (degrees)
}

export const FrameQuality = {
  assessGeometry(face: FaceGeometry, imageWidth: number): QualityVerdict {
    const q = config.quality;

    const widthRatio = face.frame.width / imageWidth;
    if (widthRatio < q.minFaceWidthRatio) {
      return { ok: false, reason: 'Move closer' };
    }
    if (Math.abs(face.rotationY) > q.maxYawDeg) {
      return { ok: false, reason: 'Face the camera' };
    }
    if (Math.abs(face.rotationX) > q.maxPitchDeg) {
      return { ok: false, reason: 'Keep your head level' };
    }
    return { ok: true };
  },

  /** Pixel-based gate using stats computed during preprocessing. */
  assessPixels(sharpness: number, brightness: number): QualityVerdict {
    const q = config.quality;
    if (brightness < q.minBrightness) return { ok: false, reason: 'Too dark' };
    if (brightness > q.maxBrightness) return { ok: false, reason: 'Too bright' };
    if (sharpness < q.minSharpness) return { ok: false, reason: 'Hold steady' };
    return { ok: true };
  },
};
