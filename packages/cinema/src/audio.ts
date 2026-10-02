import { readFile, writeFile } from "@toonflow/file";
import { random } from "./motion";
import type { Ambience } from "./set";

export const sampleRate = 48000;
export type Mood = "calm" | "sad" | "tense" | "hopeful" | "playful" | "epic" | "none";

export interface Pcm { rate: number; samples: Float32Array }

export async function readWav(path: string): Promise<Pcm> {
  const data = await readFile(path);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 12;
  let channels = 1;
  let rate = sampleRate;
  let bits = 16;
  let format = 1;
  while (offset + 8 <= data.byteLength) {
    const id = data.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      format = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      rate = view.getUint32(offset + 12, true);
      bits = view.getUint16(offset + 22, true);
    }
    if (id === "data") {
      const length = Math.min(size, data.byteLength - offset - 8);
      const frames = Math.floor(length / (bits / 8) / channels);
      const samples = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++) {
          const position = offset + 8 + (frame * channels + channel) * (bits / 8);
          sum += format === 3 ? view.getFloat32(position, true) : bits === 16 ? view.getInt16(position, true) / 32768 : view.getInt32(position, true) / 2147483648;
        }
        samples[frame] = sum / channels;
      }
      return { rate, samples };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`Tệp WAV không có dữ liệu âm thanh: ${path}`);
}

export async function writeWav(path: string, channels: Float32Array[], rate = sampleRate) {
  const frames = channels[0]!.length;
  const buffer = Buffer.alloc(44 + frames * channels.length * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + frames * channels.length * 2, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels.length, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * channels.length * 2, 28);
  buffer.writeUInt16LE(channels.length * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(frames * channels.length * 2, 40);
  for (let frame = 0; frame < frames; frame++) {
    channels.forEach((channel, index) => {
      buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, channel[frame]!)) * 32767), 44 + (frame * channels.length + index) * 2);
    });
  }
  await writeFile(path, buffer);
}

export function resample(pcm: Pcm, rate = sampleRate) {
  if (pcm.rate === rate) return pcm.samples;
  const ratio = pcm.rate / rate;
  const output = new Float32Array(Math.floor(pcm.samples.length / ratio));
  for (let index = 0; index < output.length; index++) {
    const position = index * ratio;
    const base = Math.floor(position);
    const fraction = position - base;
    output[index] = (pcm.samples[base] ?? 0) * (1 - fraction) + (pcm.samples[base + 1] ?? 0) * fraction;
  }
  return output;
}

/** Đường bao năng lượng giọng (0..1) để nhép miệng, lấy mẫu `rate` lần mỗi giây. */
export function envelope(samples: Float32Array, sourceRate: number, rate = 50) {
  const window = Math.floor(sourceRate / rate);
  const values = new Float32Array(Math.ceil(samples.length / window));
  let peak = 1e-6;
  for (let index = 0; index < values.length; index++) {
    let sum = 0;
    for (let offset = 0; offset < window; offset++) sum += (samples[index * window + offset] ?? 0) ** 2;
    values[index] = Math.sqrt(sum / window);
    peak = Math.max(peak, values[index]!);
  }
  for (let index = 0; index < values.length; index++) {
    const level = values[index]! / peak;
    values[index] = level < 0.12 ? 0 : Math.min(1, (level - 0.12) / 0.6);
  }
  return values;
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const progressions: Record<Exclude<Mood, "none">, { root: number; chords: [number, "maj" | "min"][]; bpm: number; bright: number }> = {
  calm: { root: 57, chords: [[0, "maj"], [7, "maj"], [9, "min"], [5, "maj"]], bpm: 72, bright: 0.6 },
  sad: { root: 57, chords: [[0, "min"], [8, "maj"], [3, "maj"], [10, "maj"]], bpm: 62, bright: 0.4 },
  tense: { root: 52, chords: [[0, "min"], [1, "maj"], [0, "min"], [6, "maj"]], bpm: 88, bright: 0.3 },
  hopeful: { root: 60, chords: [[0, "maj"], [9, "min"], [5, "maj"], [7, "maj"]], bpm: 80, bright: 0.8 },
  playful: { root: 62, chords: [[0, "maj"], [5, "maj"], [7, "maj"], [0, "maj"]], bpm: 104, bright: 0.9 },
  epic: { root: 50, chords: [[0, "min"], [8, "maj"], [10, "maj"], [7, "maj"]], bpm: 76, bright: 0.5 },
};

/** Nhạc nền tự sinh: pad hợp âm, arpeggio gảy, bè trầm. Không dùng mẫu âm thanh, không vướng bản quyền. */
export function music(mood: Mood, seconds: number, seed = 1): Float32Array[] {
  const left = new Float32Array(Math.ceil(seconds * sampleRate));
  const right = new Float32Array(left.length);
  if (mood === "none") return [left, right];
  const { root, chords, bpm, bright } = progressions[mood];
  const beat = 60 / bpm;
  const bar = beat * 4;
  const rand = random(seed);
  const tone = (start: number, duration: number, frequency: number, gain: number, attack: number, decay: number, pan: number, harmonics: number[]) => {
    const from = Math.floor(start * sampleRate);
    const length = Math.min(Math.floor(duration * sampleRate), left.length - from);
    for (let index = 0; index < length; index++) {
      const time = index / sampleRate;
      const env = Math.min(1, time / attack) * Math.exp(-time / decay) * Math.min(1, (duration - time) / 0.08);
      let value = 0;
      harmonics.forEach((weight, harmonic) => { value += weight * Math.sin(2 * Math.PI * frequency * (harmonic + 1) * time); });
      const sample = value * env * gain;
      left[from + index]! += sample * (1 - pan) ;
      right[from + index]! += sample * (1 + pan);
    }
  };
  for (let time = 0, index = 0; time < seconds; time += bar, index++) {
    const [degree, quality] = chords[index % chords.length]!;
    const notes = [0, quality === "maj" ? 4 : 3, 7, 12].map(step => root + degree + step);
    for (const [order, note] of notes.entries()) tone(time, bar + 0.6, hz(note), 0.045, 0.6, 6, (order - 1.5) * 0.25, [1, 0.25 * bright, 0.08]);
    tone(time, bar, hz(root + degree - 12), 0.09, 0.02, 1.4, 0, [1, 0.3]);
    if (mood !== "tense") {
      for (let step = 0; step < 8; step++) {
        if (rand() > 0.55 + bright * 0.35) continue;
        const note = notes[(step + index) % notes.length]! + 12;
        tone(time + step * beat / 2, beat * 1.5, hz(note), 0.035 * bright + 0.01, 0.005, 0.5, rand() - 0.5, [1, 0.4, 0.15]);
      }
    } else {
      for (let step = 0; step < 16; step++) tone(time + step * beat / 4, beat / 4, hz(root - 12), 0.03, 0.005, 0.12, 0, [1, 0.6]);
    }
  }
  // Phản hồi nhẹ (echo) cho không gian rộng.
  const delay = Math.floor(beat * 0.75 * sampleRate);
  for (let index = delay; index < left.length; index++) {
    left[index]! += right[index - delay]! * 0.22;
    right[index]! += left[index - delay]! * 0.22;
  }
  return [left, right];
}

/** Tiếng nền môi trường tạo từ nhiễu lọc: sông, gió, mưa, đêm, biển, rừng, chợ, phòng kín. */
export function ambience(kind: Ambience, seconds: number, seed = 7): Float32Array[] {
  const left = new Float32Array(Math.ceil(seconds * sampleRate));
  const right = new Float32Array(left.length);
  if (kind === "none") return [left, right];
  const rand = random(seed);
  const settings: Record<Exclude<Ambience, "none">, { low: number; gain: number; brown: boolean; swell: number }> = {
    river: { low: 0.06, gain: 0.5, brown: false, swell: 0.3 }, wind: { low: 0.02, gain: 0.8, brown: true, swell: 0.7 },
    rain: { low: 0.35, gain: 0.25, brown: false, swell: 0.1 }, night: { low: 0.03, gain: 0.25, brown: true, swell: 0.2 },
    sea: { low: 0.04, gain: 0.9, brown: true, swell: 0.9 }, forest: { low: 0.05, gain: 0.3, brown: true, swell: 0.4 },
    market: { low: 0.12, gain: 0.35, brown: false, swell: 0.3 }, room: { low: 0.01, gain: 0.12, brown: true, swell: 0.05 },
  };
  const { low, gain, brown, swell } = settings[kind];
  for (const channel of [left, right]) {
    let state = 0;
    let filtered = 0;
    for (let index = 0; index < channel.length; index++) {
      const white = rand() * 2 - 1;
      state = brown ? Math.max(-1, Math.min(1, state + white * 0.02)) : white;
      filtered += (state - filtered) * low;
      const time = index / sampleRate;
      const slow = 1 - swell * 0.5 * (1 + Math.sin(time * (kind === "sea" ? 0.9 : 0.35) + (channel === left ? 0 : 1.3)));
      channel[index] = filtered * gain * slow * (brown ? 3 : 1);
    }
  }
  // Tiếng côn trùng cho cảnh đêm và rừng.
  if (kind === "night" || kind === "forest") {
    for (let chirp = 0; chirp < seconds * 1.5; chirp++) {
      const start = Math.floor(rand() * left.length);
      const frequency = kind === "night" ? 4200 + rand() * 600 : 2500 + rand() * 1500;
      for (let index = 0; index < sampleRate * 0.12 && start + index < left.length; index++) {
        const value = Math.sin(2 * Math.PI * frequency * index / sampleRate) * Math.sin(Math.PI * index / (sampleRate * 0.12)) * 0.015 * (Math.sin(index / 180) > 0 ? 1 : 0.2);
        left[start + index]! += value;
        right[start + index]! += value * 0.7;
      }
    }
  }
  return [left, right];
}

export interface Clip { samples: Float32Array[]; start: number; gain: number; fade?: number; voice?: boolean }

/** Trộn mọi lớp tiếng: thoại ở giữa, nhạc tự hạ khi có thoại (sidechain), chuẩn hóa âm lượng đỉnh. */
export function mix(clips: Clip[], seconds: number): Float32Array[] {
  const length = Math.ceil(seconds * sampleRate);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const voiceLevel = new Float32Array(Math.ceil(length / 480));
  for (const clip of clips.filter(item => item.voice)) {
    const from = Math.floor(clip.start * sampleRate);
    clip.samples[0]!.forEach((value, index) => {
      const block = Math.floor((from + index) / 480);
      if (block < voiceLevel.length) voiceLevel[block] = Math.max(voiceLevel[block]!, Math.abs(value));
    });
  }
  // Làm mượt mức thoại để nhạc hạ xuống/hồi lên êm (khoảng 0,3 giây).
  let follower = 0;
  for (let index = 0; index < voiceLevel.length; index++) {
    follower = Math.max(voiceLevel[index]! > 0.02 ? 1 : 0, follower * 0.97);
    voiceLevel[index] = follower;
  }
  for (const clip of clips) {
    const from = Math.floor(clip.start * sampleRate);
    const frames = clip.samples[0]!.length;
    const fade = Math.floor((clip.fade ?? 0) * sampleRate);
    for (let index = 0; index < frames && from + index < length; index++) {
      if (from + index < 0) continue;
      let gain = clip.gain;
      if (fade) gain *= Math.min(1, index / fade, (frames - index) / fade);
      if (!clip.voice) gain *= 1 - 0.55 * voiceLevel[Math.floor((from + index) / 480)]!;
      left[from + index]! += clip.samples[0]![index]! * gain;
      right[from + index]! += (clip.samples[1] ?? clip.samples[0]!)[index]! * gain;
    }
  }
  let peak = 1e-6;
  for (let index = 0; index < length; index++) peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  const scale = Math.min(4, 0.89 / peak);
  for (let index = 0; index < length; index++) {
    left[index]! *= scale;
    right[index]! *= scale;
  }
  return [left, right];
}
