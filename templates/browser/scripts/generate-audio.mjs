// Original, deterministic sine tones; no recordings, samples or third-party assets.
import { writeFileSync, mkdirSync } from 'node:fs';
const directory = new URL('../src/assets/audio/', import.meta.url);
mkdirSync(directory, { recursive: true });
const rate = 22050;
const recipes = {
  collect: [[880, 0.1]],
  complete: [
    [660, 0.12],
    [880, 0.12],
    [1100, 0.12],
  ],
  timeout: [
    [330, 0.12],
    [220, 0.18],
  ],
};
for (const [name, notes] of Object.entries(recipes)) {
  const samples = notes.flatMap(([frequency, seconds]) => {
    const length = Math.round(rate * seconds);
    return Array.from({ length }, (_, index) => {
      const fade = Math.min(1, index / (rate * 0.008), (length - 1 - index) / (rate * 0.025));
      return Math.round(Math.sin((2 * Math.PI * frequency * index) / rate) * fade * 0.18 * 32767);
    });
  });
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => bytes.writeInt16LE(sample, 44 + index * 2));
  writeFileSync(new URL(`${name}.wav`, directory), bytes);
}
