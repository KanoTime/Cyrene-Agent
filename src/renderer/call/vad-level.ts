/**
 * Return the RMS amplitude of Web Audio time-domain samples (-1..1).
 * The ASR VAD threshold is expressed in this unit; frequency-bin byte averages
 * have a different scale and can remain high even when the microphone is quiet.
 */
export function computeRmsLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number(samples[index]) || 0;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples.length);
}
