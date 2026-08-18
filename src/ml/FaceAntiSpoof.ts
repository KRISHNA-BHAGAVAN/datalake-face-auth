import { Platform } from 'react-native';
import { loadTensorflowModel, TensorflowModelDelegate } from 'react-native-fast-tflite';
import { config } from '../utils/config';
import { AntiSpoofResult } from '../types';
import { resolveTfliteAsset } from './ModelAsset';
import { logger } from '../utils/logger';

let antiSpoofModel: Awaited<ReturnType<typeof loadTensorflowModel>> | null = null;

function softmax(logits: Float32Array): Float32Array {
  const max = Math.max(...logits);
  const exps = Float32Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((acc, v) => acc + v, 0);
  return Float32Array.from(exps, (v) => v / sum);
}

export class FaceAntiSpoof {
  static async init(): Promise<void> {
    if (antiSpoofModel) return;

    const delegates: TensorflowModelDelegate[] =
      Platform.OS === 'ios'
        ? ['core-ml']
        : Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 27
        ? ['nnapi']
        : [];
    const modelSource = await resolveTfliteAsset(require('../../assets/models/minifasnet_v2.tflite'));
    antiSpoofModel = await loadTensorflowModel(
      modelSource,
      delegates
    );
  }

  static async classify(faceBuffer: Float32Array): Promise<AntiSpoofResult> {
    if (!antiSpoofModel) {
      throw new Error('FaceAntiSpoof model is not initialized');
    }

    const output = await antiSpoofModel.run([faceBuffer.buffer as ArrayBuffer]);
    const logits = new Float32Array(output[0]);
    const probs = softmax(logits);

    const liveIndex = config.antiSpoof.liveClassIndex;
    const liveScore = probs[liveIndex];
    // A face is live if index 1 (Live) is the argmax class or probability is >= 0.35
    const isLive = (liveScore > probs[0] && liveScore > probs[2]) || liveScore >= 0.35;

    if (config.debug.logAntiSpoof) {
      // Scans the whole input buffer, so it stays behind the flag — this runs on
      // the critical path of a sub-second budget.
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      for (let i = 0; i < faceBuffer.length; i++) {
        const v = faceBuffer[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      logger.log(
        `[AntiSpoof] input len=${faceBuffer.length} min=${min.toFixed(1)} ` +
          `max=${max.toFixed(1)} mean=${(sum / faceBuffer.length).toFixed(1)} ` +
          `(expect BGR in 0..255) | probs=[${Array.from(probs)
            .map((v) => v.toFixed(3))
            .join(', ')}] live=${liveScore.toFixed(3)}`
      );
    }

    return {
      isLive,
      liveScore,
      scores: [probs[0], probs[1], probs[2]],
    };
  }
}
