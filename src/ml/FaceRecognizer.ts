import { Platform } from 'react-native';
import { loadTensorflowModel, TensorflowModelDelegate } from 'react-native-fast-tflite';
import { resolveTfliteAsset } from './ModelAsset';
import { logger } from '../utils/logger';

// We load the model as a singleton so it's only loaded once in memory
let faceNetModel: any = null;

export class FaceRecognizer {
  /**
   * Initializes the MobileFaceNet TFLite model.
   * Call this on app startup or before verification flow.
   */
  static async init(): Promise<void> {
    if (faceNetModel) return; // already loaded

    try {
      const delegates: TensorflowModelDelegate[] =
        Platform.OS === 'ios'
          ? ['core-ml']
          : Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 27
          ? ['nnapi']
          : [];
      const modelSource = await resolveTfliteAsset(require('../../assets/models/mobilefacenet.tflite'));
      faceNetModel = await loadTensorflowModel(
        modelSource,
        delegates
      );
      logger.log('FaceRecognizer model loaded successfully!');
    } catch (e) {
      logger.error('Failed to load FaceRecognizer model', e);
      throw e;
    }
  }

  /**
   * Generates a 1D embedding (float array) from a cropped face buffer.
   * The buffer must be resized and normalized exactly as MobileFaceNet expects
   * (usually 112x112, RGB, Float32).
   */
  static async getEmbedding(faceBuffer: Float32Array): Promise<number[]> {
    if (!faceNetModel) {
      throw new Error('FaceRecognizer model is not initialized');
    }

    try {
      // run() takes an ArrayBuffer array input and returns an ArrayBuffer array output
      const output = await faceNetModel.run([faceBuffer.buffer]);
      
      // Output is an ArrayBuffer, we wrap it in a Float32Array to read the floats
      const embeddingArray = new Float32Array(output[0]);
      
      // Convert TypedArray to standard JS number array
      const result: number[] = new Array(embeddingArray.length);
      for (let i = 0; i < embeddingArray.length; i++) {
        result[i] = embeddingArray[i];
      }
      return result;
    } catch (e) {
      logger.error('FaceRecognizer failed to generate embedding', e);
      throw e;
    }
  }
}
