import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as jpeg from 'jpeg-js';
import { Buffer } from 'buffer';

export class ImageProcessor {
  /**
   * Processes a camera photo: crops the face, resizes to 112x112, 
   * and converts to a Float32Array suitable for MobileFaceNet.
   */
  static async processFaceImage(
    photoUri: string, 
    photoWidth: number, 
    photoHeight: number, 
    normalizedBoundingBox: { x: number, y: number, width: number, height: number }
  ): Promise<Float32Array> {
    
    // 1. Calculate actual crop coordinates
    const minX = normalizedBoundingBox.x;
    const minY = normalizedBoundingBox.y;
    const maxX = normalizedBoundingBox.x + normalizedBoundingBox.width;
    const maxY = normalizedBoundingBox.y + normalizedBoundingBox.height;

    const marginX = normalizedBoundingBox.width * 0.2;
    const marginY = normalizedBoundingBox.height * 0.2;

    let cropX = Math.floor(Math.max(0, (minX - marginX)) * photoWidth);
    let cropY = Math.floor(Math.max(0, (minY - marginY)) * photoHeight);
    let cropWidth = Math.floor(
      Math.min(1.0, (maxX + marginX) - Math.max(0, minX - marginX)) * photoWidth
    );
    let cropHeight = Math.floor(
      Math.min(1.0, (maxY + marginY) - Math.max(0, minY - marginY)) * photoHeight
    );
    cropWidth = Math.min(cropWidth, photoWidth - cropX);
    cropHeight = Math.min(cropHeight, photoHeight - cropY);
    cropWidth = Math.max(1, cropWidth);
    cropHeight = Math.max(1, cropHeight);

    // 2. Crop and Resize to 112x112 using Expo Image Manipulator
    const context = ImageManipulator.manipulate(photoUri);
    context
      .crop({ originX: cropX, originY: cropY, width: cropWidth, height: cropHeight })
      .resize({ width: 112, height: 112 });
    const imageRef = await context.renderAsync();
    const manipResult = await imageRef.saveAsync({
      compress: 0.9,
      format: SaveFormat.JPEG,
    });
    context.release();
    imageRef.release();

    // 3. Read cropped JPEG as Base64
    const base64 = await FileSystem.readAsStringAsync(manipResult.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // 4. Decode Base64 to Buffer
    const buffer = Buffer.from(base64, 'base64');

    // 5. Decode JPEG to RGBA pixel array
    const rawImageData = jpeg.decode(buffer, { useTArray: true }); // Returns Uint8Array

    // 6. Convert RGBA to RGB Float32Array (normalized)
    const float32Data = new Float32Array(112 * 112 * 3);
    let outIdx = 0;
    
    for (let i = 0; i < rawImageData.data.length; i += 4) {
      const r = rawImageData.data[i];
      const g = rawImageData.data[i + 1];
      const b = rawImageData.data[i + 2];
      // MobileFaceNet typically expects input normalized to [-1, 1]
      float32Data[outIdx++] = (r - 127.5) / 127.5;
      float32Data[outIdx++] = (g - 127.5) / 127.5;
      float32Data[outIdx++] = (b - 127.5) / 127.5;
    }

    return float32Data;
  }
}
