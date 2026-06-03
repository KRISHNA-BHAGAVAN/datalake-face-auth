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
   * Crops the face for MobileFaceNet: 112x112, normalized to [-1, 1].
   *
   * When eye landmarks are supplied, the crop is geometrically normalized so the
   * eyes land on ArcFace's canonical positions (scale + translation). This matches
   * the alignment MobileFaceNet was trained on and is the single biggest accuracy
   * lever. Falls back to a margin crop when landmarks are missing or the aligned
   * window would fall outside the image.
   */
  static async processFaceImage(
    photoUri: string,
    photoWidth: number,
    photoHeight: number,
    normalizedBoundingBox: NormalizedBox,
    eyes?: { left: Point; right: Point } | null
  ): Promise<FaceTensor> {
    const aligned = eyes
      ? ImageProcessor.computeAlignedCrop(eyes.left, eyes.right, photoWidth, photoHeight)
      : null;
    const crop = aligned ?? ImageProcessor.computeMarginCrop(normalizedBoundingBox, photoWidth, photoHeight, 0.2);
    const pixels = await ImageProcessor.cropResizeDecode(photoUri, crop, config.alignment.outputSize);
    return ImageProcessor.toMobileFaceNetInput(pixels, aligned != null);
  }

  /**
   * Crops the face for MiniFASNet: 80x80, center-expanded by cropScale.
   * MiniFASNet (Silent-Face) is fed BGR pixels in the raw [0,255] range (NO /255).
   */
  static async processAntiSpoofImage(
    photoUri: string,
    photoWidth: number,
    photoHeight: number,
    normalizedBoundingBox: NormalizedBox
  ): Promise<Float32Array> {
    const crop = ImageProcessor.computeCenterScaleCrop(
      normalizedBoundingBox,
      photoWidth,
      photoHeight,
      config.antiSpoof.cropScale
    );
    const pixels = await ImageProcessor.cropResizeDecode(photoUri, crop, config.antiSpoof.inputSize);
    return ImageProcessor.toMiniFasInput(pixels);
  }

  private static computeMarginCrop(
    box: NormalizedBox,
    photoWidth: number,
    photoHeight: number,
    marginRatio: number
  ) {
    const minX = box.x;
    const minY = box.y;
    const maxX = box.x + box.width;
    const maxY = box.y + box.height;
    const marginX = box.width * marginRatio;
    const marginY = box.height * marginRatio;

    let cropX = Math.floor(Math.max(0, minX - marginX) * photoWidth);
    let cropY = Math.floor(Math.max(0, minY - marginY) * photoHeight);
    let cropWidth = Math.floor(
      (Math.min(1.0, maxX + marginX) - Math.max(0, minX - marginX)) * photoWidth
    );
    let cropHeight = Math.floor(
      (Math.min(1.0, maxY + marginY) - Math.max(0, minY - marginY)) * photoHeight
    );

    return ImageProcessor.clampCrop(cropX, cropY, cropWidth, cropHeight, photoWidth, photoHeight);
  }

  /**
   * Square crop that maps the eye midpoint + interocular distance onto ArcFace's
   * canonical eye positions. Uses only the midpoint and distance, so it is robust
   * to ML Kit's left/right eye labeling. Returns null if the window leaves the
   * image (caller falls back to a margin crop). Roll is not corrected here.
   */
  private static computeAlignedCrop(
    leftEye: Point,
    rightEye: Point,
    photoWidth: number,
    photoHeight: number
  ): { cropX: number; cropY: number; cropWidth: number; cropHeight: number } | null {
    const { leftEye: cl, rightEye: cr, outputSize } = config.alignment;
    const canonInter = Math.hypot(cr.x - cl.x, cr.y - cl.y);
    const canonMid = { x: (cl.x + cr.x) / 2, y: (cl.y + cr.y) / 2 };

    const srcInter = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    if (srcInter < 1) return null;
    const srcMid = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };

    // crop side in source px so the output (outputSize) has canonical interocular distance
    const side = (outputSize * srcInter) / canonInter;
    const scale = side / outputSize; // source px per output px
    const originX = srcMid.x - canonMid.x * scale;
    const originY = srcMid.y - canonMid.y * scale;

    const cropX = Math.round(originX);
    const cropY = Math.round(originY);
    const cropSide = Math.round(side);

    if (cropX < 0 || cropY < 0 || cropX + cropSide > photoWidth || cropY + cropSide > photoHeight) {
      return null;
    }
    return { cropX, cropY, cropWidth: cropSide, cropHeight: cropSide };
  }

  private static computeCenterScaleCrop(
    box: NormalizedBox,
    photoWidth: number,
    photoHeight: number,
    scale: number
  ) {
    const centerX = (box.x + box.width / 2) * photoWidth;
    const centerY = (box.y + box.height / 2) * photoHeight;
    const cropWidth = box.width * photoWidth * scale;
    const cropHeight = box.height * photoHeight * scale;
    const cropX = centerX - cropWidth / 2;
    const cropY = centerY - cropHeight / 2;

    return ImageProcessor.clampCrop(
      Math.floor(cropX),
      Math.floor(cropY),
      Math.floor(cropWidth),
      Math.floor(cropHeight),
      photoWidth,
      photoHeight
    );
  }

  private static clampCrop(
    cropX: number,
    cropY: number,
    cropWidth: number,
    cropHeight: number,
    photoWidth: number,
    photoHeight: number
  ) {
    cropX = Math.max(0, cropX);
    cropY = Math.max(0, cropY);
    cropWidth = Math.min(cropWidth, photoWidth - cropX);
    cropHeight = Math.min(cropHeight, photoHeight - cropY);
    cropWidth = Math.max(1, cropWidth);
    cropHeight = Math.max(1, cropHeight);
    return { cropX, cropY, cropWidth, cropHeight };
  }

  private static async cropResizeDecode(
    photoUri: string,
    crop: { cropX: number; cropY: number; cropWidth: number; cropHeight: number },
    size: number
  ): Promise<jpeg.RawImageData<Uint8Array>> {
    const context = ImageManipulator.manipulate(photoUri);
    context
      .crop({
        originX: crop.cropX,
        originY: crop.cropY,
        width: crop.cropWidth,
        height: crop.cropHeight,
      })
      .resize({ width: size, height: size });
    const imageRef = await context.renderAsync();
    const manipResult = await imageRef.saveAsync({
      compress: 0.9,
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
