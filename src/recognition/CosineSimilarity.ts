/**
 * Computes cosine similarity between two 1D float arrays.
 * Value ranges from -1 (opposite) to 1 (identical).
 * 
 * @param v1 First embedding vector
 * @param v2 Second embedding vector
 * @returns Cosine similarity score
 */
export function computeCosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) {
    throw new Error('Vector dimensions must match');
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < v1.length; i++) {
    const a = v1[i];
    const b = v2[i];
    dotProduct += a * b;
    norm1 += a * a;
    norm2 += b * b;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Computes weighted cosine similarity.
 * Emphasizes periocular and invariant facial features over outer headwear / lower facial hair.
 */
export function computeWeightedCosineSimilarity(
  v1: number[],
  v2: number[],
  weights?: number[]
): number {
  if (v1.length !== v2.length) {
    throw new Error('Vector dimensions must match');
  }

  if (!weights || weights.length !== v1.length) {
    return computeCosineSimilarity(v1, v2);
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < v1.length; i++) {
    const w = weights[i];
    const a = v1[i] * w;
    const b = v2[i] * w;
    dotProduct += a * b;
    norm1 += a * a;
    norm2 += b * b;
  }

  if (norm1 === 0 || norm2 === 0) return 0;
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

/**
 * Cached periocular weights for 512d or 128d vectors.
 * Upper facial / periocular channels (first 50%) are weighted 1.3x relative to outer boundary channels.
 */
const weightsCache = new Map<number, number[]>();

export function getPeriocularWeights(dim: number): number[] {
  if (weightsCache.has(dim)) {
    return weightsCache.get(dim)!;
  }

  const weights = new Array(dim);
  const half = Math.floor(dim / 2);
  for (let i = 0; i < dim; i++) {
    // In ArcFace / MobileFaceNet, early-to-mid channels encode invariant periocular & ocular features.
    weights[i] = i < half ? 1.35 : 0.85;
  }
  weightsCache.set(dim, weights);
  return weights;
}

/**
 * Averages multiple embeddings to create a more robust template.
 */
export function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  
  const length = embeddings[0].length;
  const result = new Array(length).fill(0);

  for (const emb of embeddings) {
    for (let i = 0; i < length; i++) {
      result[i] += emb[i];
    }
  }

  // Normalize by length
  for (let i = 0; i < length; i++) {
    result[i] /= embeddings.length;
  }

  // Normalize to unit vector for cosine similarity optimization
  let norm = 0;
  for (let i = 0; i < length; i++) {
    norm += result[i] * result[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < length; i++) {
      result[i] /= norm;
    }
  }

  return result;
}
