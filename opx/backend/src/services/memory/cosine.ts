// Cosine similarity — the whole of the "semantic" in semantic memory.
//
// Two pieces of text are "similar" when their embedding vectors point in the
// same direction. Cosine similarity measures exactly that: the cosine of the
// angle between two vectors, in [-1, 1], where 1 means identical direction.
// Magnitude is ignored, which is what we want — a long note and a short one
// about the same thing should still match.

/** Dot product of two equal-length vectors. */
export function dot(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/** Euclidean length (L2 norm) of a vector. */
export function norm(a: readonly number[]): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 for a zero-length or mismatched
 * vector rather than NaN, so a bad embedding can never poison a ranking.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const denom = norm(a) * norm(b);
  if (denom === 0) return 0;
  return dot(a, b) / denom;
}
