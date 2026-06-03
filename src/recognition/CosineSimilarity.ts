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
