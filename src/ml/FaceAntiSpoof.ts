import { Platform } from 'react-native';
import { loadTensorflowModel, TensorflowModelDelegate } from 'react-native-fast-tflite';
import { config } from '../utils/config';
import { AntiSpoofResult } from '../types';
import { resolveTfliteAsset } from './ModelAsset';

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

    const delegates: TensorflowModelDelegate[] = Platform.OS === 'ios' ? ['core-ml'] : ['nnapi'];
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

    // --- TEMP DIAGNOSTIC (remove after tuning) ---
    let bmin = Infinity, bmax = -Infinity, bsum = 0;
    for (let i = 0; i < faceBuffer.length; i++) {
      const v = faceBuffer[i];
      if (v < bmin) bmin = v;
      if (v > bmax) bmax = v;
      bsum += v;
    }
    const argmax = probs.indexOf(Math.max(...Array.from(probs)));
    console.log(
      `[AntiSpoof] buf len=${faceBuffer.length} min=${bmin.toFixed(3)} max=${bmax.toFixed(3)} mean=${(bsum / faceBuffer.length).toFixed(3)} | ` +
      `logits=[${Array.from(logits).map((v) => v.toFixed(2)).join(', ')}] ` +
      `probs=[${Array.from(probs).map((v) => v.toFixed(3)).join(', ')}] argmax=${argmax}`
    );
    // --- END DIAGNOSTIC ---

    const liveIndex = config.antiSpoof.liveClassIndex;
    const liveScore = probs[liveIndex];
    const isLive = liveScore >= config.antiSpoof.liveScoreThreshold;

    return {
      isLive,
      liveScore,
      scores: [probs[0], probs[1], probs[2]],
    };
  }
}
