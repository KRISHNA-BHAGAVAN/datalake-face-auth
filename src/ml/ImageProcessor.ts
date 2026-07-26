import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Buffer } from 'buffer';
import { config } from '../utils/config';

type NormalizedBox = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

/** Preprocessed face tensor plus quality stats from the crop. */
export type FaceTensor = {
  input: Float32Array;
  sharpness: number; // variance-of-Laplacian (higher = sharper)
  brightness: number; // mean luma 0..255
  aligned: boolean; // true if eye-landmark alignment was applied
};

export class ImageProcessor {
  /**
   * Builds the MobileFaceNet input: 112x112, RGB, normalized to [-1, 1].
   *
   * With eye landmarks we apply the full ArcFace similarity transform — scale,
   * translation AND in-plane rotation — so both eyes land exactly on the
   * canonical positions and the face comes out upright. That is the geometry
   * every MobileFaceNet training image had, and it is the single biggest
   * accuracy lever in the pipeline. Measured with `benchmark/run_alignment_ab.py`
   * against the previous rotation-free crop:
   *
   *   LFW     accuracy 95.90% -> 96.91%,  genuine-reject rate 7.96% -> 5.97%
   *   Indian  accuracy 82.52% -> 91.44%,  genuine-reject rate 34.87% -> 16.71%
   *
   * with the impostor-accept rate unchanged. Leaving roll in the image meant a
   * tilted probe was compared against an upright template, so part of the cosine
   * distance was head tilt rather than identity.
   *
   * Falls back to a square margin crop when landmarks are missing.
   */
  static async processFaceImage(
    photoUri: string,
    photoWidth: number,
    photoHeight: number,
    normalizedBoundingBox: NormalizedBox,
    eyes?: { left: Point; right: Point } | null
  ): Promise<FaceTensor> {
    const transform = eyes
      ? ImageProcessor.computeAlignTransform(eyes.left, eyes.right)
      : null;

    if (transform) {
      return ImageProcessor.warpAlignedFace(photoUri, photoWidth, photoHeight, transform);
    }

    const crop = ImageProcessor.computeMarginCrop(
      normalizedBoundingBox,
      photoWidth,
      photoHeight,
      0.15
    );
    const pixels = await ImageProcessor.cropResizeDecode(
      photoUri,
      crop,
      config.alignment.outputSize
    );
    return ImageProcessor.toMobileFaceNetInput(pixels, false);
  }

  /**
   * Crops the face for MiniFASNet: 80x80, box expanded by cropScale.
   * MiniFASNet (Silent-Face) is fed BGR pixels in the raw [0,255] range (NO /255).
   */
  static async processAntiSpoofImage(
    photoUri: string,
    photoWidth: number,
    photoHeight: number,
    normalizedBoundingBox: NormalizedBox
  ): Promise<Float32Array> {
    const crop = ImageProcessor.computeAntiSpoofCrop(
      normalizedBoundingBox,
      photoWidth,
      photoHeight,
      config.antiSpoof.cropScale
    );
    const pixels = await ImageProcessor.cropResizeDecode(photoUri, crop, config.antiSpoof.inputSize);
    return ImageProcessor.toMiniFasInput(pixels);
  }

  /**
   * Fallback crop when eye landmarks are unavailable.
   *
   * Deliberately SQUARE, and shifted in-bounds rather than truncated. The
   * eye-aligned path always yields a square window, so a rectangular fallback
   * used to hand MobileFaceNet a vertically squashed face — meaning a template
   * enrolled through the aligned path and a probe that fell back to this one
   * disagreed on face shape, not identity. Same geometry in both paths keeps the
   * embeddings comparable.
   */
  private static computeMarginCrop(
    box: NormalizedBox,
    photoWidth: number,
    photoHeight: number,
    marginRatio: number
  ) {
    const boxW = box.width * photoWidth;
    const boxH = box.height * photoHeight;
    const centerX = (box.x + box.width / 2) * photoWidth;
    const centerY = (box.y + box.height / 2) * photoHeight;

    const side = Math.max(boxW, boxH) * (1 + 2 * marginRatio);
    return ImageProcessor.fitWindow(
      centerX - side / 2,
      centerY - side / 2,
      side,
      side,
      photoWidth,
      photoHeight
    );
  }

  /**
   * Places a window inside the image by SHIFTING it, preserving its size (and so
   * its aspect ratio). Only shrinks when the window genuinely exceeds the image.
   */
  private static fitWindow(
    left: number,
    top: number,
    width: number,
    height: number,
    photoWidth: number,
    photoHeight: number
  ) {
    const w = Math.min(width, photoWidth);
    const h = Math.min(height, photoHeight);
    const x = Math.min(Math.max(0, left), photoWidth - w);
    const y = Math.min(Math.max(0, top), photoHeight - h);
    return {
      cropX: Math.round(x),
      cropY: Math.round(y),
      cropWidth: Math.max(1, Math.round(w)),
      cropHeight: Math.max(1, Math.round(h)),
    };
  }

  /**
   * The ArcFace similarity transform mapping source pixels onto the canonical
   * 112x112 face:
   *
   *     [ a  -b  tx ]
   *     [ b   a  ty ]     a = s·cosθ,  b = s·sinθ
   *
   * Two eye correspondences determine a similarity transform exactly, so this is
   * closed-form. Returns null when the eyes are degenerate.
   */
  private static computeAlignTransform(
    eyeA: Point,
    eyeB: Point
  ): { a: number; b: number; tx: number; ty: number } | null {
    // Order by IMAGE x, never by the detector's label. ML Kit (like MediaPipe)
    // names eyes subject-relative, so `leftEye` sits on the right-hand side of a
    // front-camera picture. A signed transform fed the labels directly rotates the
    // face 180 degrees and every embedding collapses toward one vector — measured
    // at AUC 0.91 -> 0.72 with a 89% impostor-accept rate. The canonical target
    // puts its "left" eye at the smaller x, so match on geometry.
    const [p1, p2] = eyeA.x <= eyeB.x ? [eyeA, eyeB] : [eyeB, eyeA];

    const { leftEye: cl, rightEye: cr } = config.alignment;
    const dpx = p2.x - p1.x;
    const dpy = p2.y - p1.y;
    const srcInter = Math.hypot(dpx, dpy);
    if (!Number.isFinite(srcInter) || srcInter < 1) return null;

    const dqx = cr.x - cl.x;
    const dqy = cr.y - cl.y;
    const scale = Math.hypot(dqx, dqy) / srcInter;
    const theta = Math.atan2(dqy, dqx) - Math.atan2(dpy, dpx);

    const a = scale * Math.cos(theta);
    const b = scale * Math.sin(theta);
    return {
      a,
      b,
      tx: cl.x - (a * p1.x - b * p1.y),
      ty: cl.y - (b * p1.x + a * p1.y),
    };
  }

  /**
   * Applies the alignment transform by inverse-warping into the 112x112 output.
   *
   * `expo-image-manipulator` can only crop, scale and rotate about the image
   * centre, which cannot express a rotation about the eye midpoint. So the native
   * layer just delivers pixels — the source region covering the rotated output
   * window — and the resampling happens here, in JS, over 112x112 = 12,544
   * bilinear samples. That keeps the geometry identical to the `cv2.warpAffine`
   * used in the benchmark rather than depending on the platform's rotation
   * conventions. `benchmark/verify_warp_parity.py` checks the two agree
   * (mean embedding cosine 0.994, min 0.967).
   *
   * Sample coordinates are clamped to the buffer, which reproduces OpenCV's
   * BORDER_REPLICATE — the mode the benchmark validated — so a face at the very
   * edge of the frame degrades gracefully instead of failing.
   */
  private static async warpAlignedFace(
    photoUri: string,
    photoWidth: number,
    photoHeight: number,
    t: { a: number; b: number; tx: number; ty: number }
  ): Promise<FaceTensor> {
    const out = config.alignment.outputSize;
    const det = t.a * t.a + t.b * t.b;

    /** Inverse transform: canonical output px -> source px. */
    const toSource = (u: number, v: number) => {
      const uu = u - t.tx;
      const vv = v - t.ty;
      return { x: (t.a * uu + t.b * vv) / det, y: (-t.b * uu + t.a * vv) / det };
    };

    // Axis-aligned source region covering the rotated output square.
    const corners = [toSource(0, 0), toSource(out, 0), toSource(out, out), toSource(0, out)];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.x > maxX) maxX = c.x;
      if (c.y > maxY) maxY = c.y;
    }

    // INTERSECT the needed region with the image — never shift it. Shifting would
    // slide the face away from the canonical eye positions, which is the one thing
    // this whole transform exists to fix; a large face near the frame edge came out
    // translated and its embedding diverged badly (measured min cosine 0.35 vs the
    // reference warp). Intersecting instead means the sample clamp below replicates
    // at the true image border, exactly like OpenCV's BORDER_REPLICATE.
    const regionX = Math.max(0, Math.floor(minX));
    const regionY = Math.max(0, Math.floor(minY));
    const region = {
      cropX: regionX,
      cropY: regionY,
      cropWidth: Math.max(1, Math.min(Math.ceil(maxX), photoWidth) - regionX),
      cropHeight: Math.max(1, Math.min(Math.ceil(maxY), photoHeight) - regionY),
    };

    // Decode at roughly one buffer pixel per output pixel: enough detail to
    // resample without paying for a full-resolution JPEG decode in JS. Each axis
    // is sized independently, so the intersected region is not distorted.
    const scale = Math.sqrt(det); // output px per source px
    const clampWork = (px: number) =>
      Math.max(out, Math.min(ImageProcessor.MAX_WARP_BUFFER, Math.ceil(px * scale)));
    const workW = clampWork(region.cropWidth);
    const workH = clampWork(region.cropHeight);

    const pixels = await ImageProcessor.cropResizeDecode(
      photoUri,
      region,
      { width: workW, height: workH },
      1.0
    );
    const src = pixels.data;
    const srcW = pixels.width;
    const srcH = pixels.height;
    // Separate factors undo the non-uniform resize above.
    const bufPerSrcX = srcW / region.cropWidth;
    const bufPerSrcY = srcH / region.cropHeight;

    const rgba = new Uint8Array(out * out * 4);
    let o = 0;
    for (let v = 0; v < out; v++) {
      for (let u = 0; u < out; u++) {
        const s = toSource(u + 0.5, v + 0.5);
        // into working-buffer coords
        let bx = (s.x - region.cropX) * bufPerSrcX - 0.5;
        let by = (s.y - region.cropY) * bufPerSrcY - 0.5;
        if (bx < 0) bx = 0;
        else if (bx > srcW - 1) bx = srcW - 1;
        if (by < 0) by = 0;
        else if (by > srcH - 1) by = srcH - 1;

        const x0 = Math.floor(bx);
        const y0 = Math.floor(by);
        const x1 = x0 + 1 < srcW ? x0 + 1 : x0;
        const y1 = y0 + 1 < srcH ? y0 + 1 : y0;
        const fx = bx - x0;
        const fy = by - y0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        const i00 = (y0 * srcW + x0) * 4;
        const i10 = (y0 * srcW + x1) * 4;
        const i01 = (y1 * srcW + x0) * 4;
        const i11 = (y1 * srcW + x1) * 4;

        for (let ch = 0; ch < 3; ch++) {
          rgba[o + ch] =
            src[i00 + ch] * w00 +
            src[i10 + ch] * w10 +
            src[i01 + ch] * w01 +
            src[i11 + ch] * w11;
        }
        rgba[o + 3] = 255;
        o += 4;
      }
    }

    return ImageProcessor.toMobileFaceNetInput({ width: out, height: out, data: rgba }, true);
  }

  /** Cap on the JS-side working buffer for the warp (pixels per side). */
  private static readonly MAX_WARP_BUFFER = 256;

  /**
   * Exact port of Silent-Face's `generate_patches._get_new_box` — the crop
   * MiniFASNet was trained on.
   *
   * Two details matter and both were previously wrong:
   *
   *  1. The scale is clamped to what the image can actually supply
   *     (`min((h-1)/boxH, (w-1)/boxW, scale)`), so the window never needs to be
   *     shrunk afterwards.
   *  2. When the window still falls outside the frame it is SHIFTED back
   *     in-bounds at full size — never truncated.
   *
   * Truncating (the old `clampCrop` path) changed both the aspect ratio and the
   * face-to-background ratio inside the 80x80 input. MiniFASNet reads exactly
   * that background margin to spot screen bezels and print edges, so a squashed
   * crop pushed genuine faces toward the spoof classes. The error grew as the
   * user moved closer — at the guide-oval distance a 9:16 photo was squashed
   * from aspect 0.80 to 0.565, which roughly doubled the false-reject rate.
   * See `benchmark/run_antispoof_crop_ab.py` for the measurement.
   */
  private static computeAntiSpoofCrop(
    box: NormalizedBox,
    photoWidth: number,
    photoHeight: number,
    scale: number
  ) {
    const boxX = box.x * photoWidth;
    const boxY = box.y * photoHeight;
    const boxW = box.width * photoWidth;
    const boxH = box.height * photoHeight;

    const effScale = Math.min(
      (photoHeight - 1) / boxH,
      (photoWidth - 1) / boxW,
      scale
    );

    const newW = boxW * effScale;
    const newH = boxH * effScale;
    const centerX = boxX + boxW / 2;
    const centerY = boxY + boxH / 2;

    let left = centerX - newW / 2;
    let top = centerY - newH / 2;
    let right = centerX + newW / 2;
    let bottom = centerY + newH / 2;

    // Shift, preserving size. Order matches upstream.
    if (left < 0) {
      right -= left;
      left = 0;
    }
    if (top < 0) {
      bottom -= top;
      top = 0;
    }
    if (right > photoWidth - 1) {
      left -= right - photoWidth + 1;
      right = photoWidth - 1;
    }
    if (bottom > photoHeight - 1) {
      top -= bottom - photoHeight + 1;
      bottom = photoHeight - 1;
    }

    // Upstream slices with int() on each edge, so width is the difference of the
    // truncated bounds — not the truncation of the difference.
    const cropX = Math.trunc(left);
    const cropY = Math.trunc(top);
    return {
      cropX,
      cropY,
      cropWidth: Math.max(1, Math.trunc(right) - cropX),
      cropHeight: Math.max(1, Math.trunc(bottom) - cropY),
    };
  }

  private static async cropResizeDecode(
    photoUri: string,
    crop: { cropX: number; cropY: number; cropWidth: number; cropHeight: number },
    size: number | { width: number; height: number },
    /** JPEG quality. The warp path re-samples the result, so it wants minimal loss. */
    compress = 0.9
  ): Promise<jpeg.RawImageData<Uint8Array>> {
    const target = typeof size === 'number' ? { width: size, height: size } : size;
    const context = ImageManipulator.manipulate(photoUri);
    context
      .crop({
        originX: crop.cropX,
        originY: crop.cropY,
        width: crop.cropWidth,
        height: crop.cropHeight,
      })
      .resize(target);
    const imageRef = await context.renderAsync();
    const manipResult = await imageRef.saveAsync({
      compress,
      format: SaveFormat.JPEG,
    });
    context.release();
    imageRef.release();

    const base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return jpeg.decode(Buffer.from(base64, 'base64'), { useTArray: true });
  }

  private static toMobileFaceNetInput(
    rawImageData: jpeg.RawImageData<Uint8Array>,
    aligned: boolean
  ): FaceTensor {
    const { width, height, data } = rawImageData;
    const pixelCount = width * height;
    const float32Data = new Float32Array(pixelCount * 3);
    const luma = new Float32Array(pixelCount);

    let outIdx = 0;
    let lumaSum = 0;
    for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      float32Data[outIdx++] = (r - 127.5) / 127.5;
      float32Data[outIdx++] = (g - 127.5) / 127.5;
      float32Data[outIdx++] = (b - 127.5) / 127.5;
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      luma[p] = y;
      lumaSum += y;
    }
    const brightness = lumaSum / pixelCount;

    // Variance of the Laplacian over the luma channel — a standard sharpness/blur metric.
    let lapSum = 0;
    let lapSqSum = 0;
    let n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const c = y * width + x;
        const lap = 4 * luma[c] - luma[c - 1] - luma[c + 1] - luma[c - width] - luma[c + width];
        lapSum += lap;
        lapSqSum += lap * lap;
        n++;
      }
    }
    const mean = n > 0 ? lapSum / n : 0;
    const sharpness = n > 0 ? lapSqSum / n - mean * mean : 0;

    return { input: float32Data, sharpness, brightness, aligned };
  }

  private static toMiniFasInput(rawImageData: jpeg.RawImageData<Uint8Array>): Float32Array {
    // MiniFASNet (Silent-Face) was trained on cv2 BGR pixels in the raw [0,255] range:
    // upstream to_tensor has `img.float().div(255)` commented out, so the input is NOT
    // normalized, and cv2 supplies BGR. jpeg-js gives us RGBA, so swap to B,G,R and keep 0-255.
    // Feeding RGB or [0,1] makes the model output a constant "spoof" class.
    const size = config.antiSpoof.inputSize;
    const float32Data = new Float32Array(size * size * 3);
    let outIdx = 0;
    for (let i = 0; i < rawImageData.data.length; i += 4) {
      float32Data[outIdx++] = rawImageData.data[i + 2]; // B
      float32Data[outIdx++] = rawImageData.data[i + 1]; // G
      float32Data[outIdx++] = rawImageData.data[i];     // R
    }
    return float32Data;
  }
}
