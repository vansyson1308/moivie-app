import { biquad } from "./audio";
import type { Viseme } from "./character";

export interface Syllable { text: string; start: number; nucleus: number; end: number; stress: number }
export interface VisemeKey { time: number; viseme: Viseme }
export interface LipSync { syllables: Syllable[]; track: VisemeKey[] }

const frameRate = 100;

/**
 * Cường độ dải nguyên âm (300–2500 Hz) theo dB, 100 khung/giây, đã làm mượt ~40 ms.
 * Lọc dải để phụ âm xát (s, x) không tạo đỉnh giả: đỉnh còn lại gần như chỉ là hạt nhân âm tiết (cách của de Jong & Wempe).
 */
function intensity(samples: Float32Array, rate: number) {
  const band = biquad(biquad(samples, rate, 300, "high"), rate, 2500, "low");
  const hop = Math.round(rate / frameRate);
  const raw = new Float32Array(Math.ceil(band.length / hop));
  for (let frame = 0; frame < raw.length; frame++) {
    let sum = 0;
    const from = Math.max(0, frame * hop - hop);
    const to = Math.min(band.length, frame * hop + hop * 2);
    for (let index = from; index < to; index++) sum += band[index]! ** 2;
    raw[frame] = 10 * Math.log10(sum / Math.max(1, to - from) + 1e-10);
  }
  return raw.map((_, frame) => {
    let sum = 0;
    let count = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const value = raw[frame + offset];
      if (value !== undefined) { sum += value; count++; }
    }
    return sum / count;
  });
}

interface Peak { time: number; strength: number; afterGap: boolean }

/** Hạt nhân âm tiết = đỉnh cường độ vượt ngưỡng im lặng và nổi hơn hai thung lũng hai bên ít nhất 2 dB; khoảng lặng ≥ 120 ms là chỗ ngắt. */
function analyse(samples: Float32Array, rate: number) {
  const db = intensity(samples, rate);
  const sorted = [...db].sort((a, b) => a - b);
  const top = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
  const silence = top - 25;
  const voiced = Array.from(db, value => value > silence);
  const gaps: [number, number][] = [];
  let runStart = -1;
  for (let frame = 0; frame <= db.length; frame++) {
    const quiet = frame === db.length || !voiced[frame];
    if (quiet && runStart < 0) runStart = frame;
    if (!quiet && runStart >= 0) {
      if (frame - runStart >= 12 && runStart > 0) gaps.push([runStart / frameRate, frame / frameRate]);
      runStart = -1;
    }
  }
  const first = voiced.indexOf(true) / frameRate;
  const last = (voiced.lastIndexOf(true) + 1) / frameRate;
  // Giữ một cực đại khi thung lũng giữa nó và đỉnh trước thấp hơn cả hai ít nhất 2 dB; không thì chỉ giữ đỉnh cao hơn.
  const frames: number[] = [];
  for (let frame = 1; frame < db.length - 1; frame++) {
    if (!voiced[frame] || db[frame]! < db[frame - 1]! || db[frame]! <= db[frame + 1]!) continue;
    const previous = frames.at(-1);
    if (previous === undefined) { frames.push(frame); continue; }
    let valley = Infinity;
    for (let index = previous; index <= frame; index++) valley = Math.min(valley, voiced[index] ? db[index]! : -Infinity);
    if (Math.min(db[previous]!, db[frame]!) - valley >= 2 && frame - previous >= 8) frames.push(frame);
    else if (db[frame]! > db[previous]!) frames[frames.length - 1] = frame;
  }
  const peaks: Peak[] = frames.map(frame => ({ time: frame / frameRate, strength: db[frame]!, afterGap: false }));
  for (const [index, peak] of peaks.entries()) {
    const previous = peaks[index - 1];
    peak.afterGap = index === 0 || gaps.some(([from, to]) => from >= previous!.time && to <= peak.time);
    peak.strength = Math.max(0, Math.min(1, (peak.strength - silence) / 25));
  }
  return { db, gaps, peaks, first: Math.max(0, first), last: Math.max(first, last) };
}

/** Mốc thời gian dự kiến của âm tiết thứ i nếu tốc độ nói đều trên phần có tiếng (bỏ các khoảng lặng). */
function expectedTimes(count: number, first: number, last: number, gaps: [number, number][]) {
  const inner = gaps.filter(([from, to]) => from > first && to < last);
  const spoken = last - first - inner.reduce((sum, [from, to]) => sum + to - from, 0);
  return Array.from({ length: count }, (_, index) => {
    let remaining = spoken * (index + 0.5) / count;
    let time = first;
    for (const [from, to] of inner) {
      if (time + remaining <= from) break;
      remaining -= from - time;
      time = to;
    }
    return time + remaining;
  });
}

/**
 * Căn âm tiết chữ với hạt nhân âm tiết trong giọng bằng quy hoạch động kiểu căn chuỗi:
 * khớp (âm tiết, đỉnh), bỏ đỉnh (tiếng thở, âm tiết bị tách), bỏ âm tiết (hai âm tiết nuốt vào một đỉnh).
 * Dấu câu neo vào khoảng lặng; vị trí dự kiến theo tốc độ đều giữ cho phép căn không trôi.
 */
function align(words: { text: string; phraseStart: boolean }[], peaks: Peak[], expected: number[], spread: number) {
  const n = words.length;
  const m = peaks.length;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
  const move = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  cost[0]![0] = 0;
  const skipSyllable = 1.4;
  const matchCost = (i: number, j: number) => {
    const peak = peaks[j]!;
    const word = words[i]!;
    let value = ((peak.time - expected[i]!) / spread) ** 2 - 0.6 * peak.strength;
    if (i > 0 && word.phraseStart) value += peak.afterGap ? -1.5 : 0.6;
    else if (i > 0 && peak.afterGap) value += 1.2;
    return value;
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const here = cost[i]![j]!;
      if (here === Infinity) continue;
      if (i < n && j < m && here + matchCost(i, j) < cost[i + 1]![j + 1]!) { cost[i + 1]![j + 1] = here + matchCost(i, j); move[i + 1]![j + 1] = 1; }
      if (j < m && here + 0.3 + 0.9 * peaks[j]!.strength < cost[i]![j + 1]!) { cost[i]![j + 1] = here + 0.3 + 0.9 * peaks[j]!.strength; move[i]![j + 1] = 2; }
      if (i < n && here + skipSyllable < cost[i + 1]![j]!) { cost[i + 1]![j] = here + skipSyllable; move[i + 1]![j] = 3; }
    }
  }
  const matched: (number | undefined)[] = new Array(n);
  let [i, j] = [n, m];
  while (i > 0 || j > 0) {
    const step = move[i]![j];
    if (step === 1) { matched[i - 1] = j - 1; i--; j--; } else if (step === 2) j--; else i--;
  }
  return matched;
}

const toneMarks = /[̣̀́̃̉]/g;
const initials = ["ngh", "ng", "nh", "ch", "gh", "gi", "kh", "ph", "th", "tr", "qu", "b", "c", "d", "đ", "g", "h", "k", "l", "m", "n", "p", "r", "s", "t", "v", "x"];
const finals = ["ng", "nh", "ch", "c", "m", "n", "p", "t"];
const vowelLetters = "aăâeêioôơuưy";

/** Ánh xạ âm vị tiếng Việt sang khẩu hình Preston Blair. Phụ âm gốc lưỡi/thanh hầu (c, k, g, ng, h, kh) không có hình môi riêng: để trống, miệng giữ theo nguyên âm. */
const initialShape: Record<string, Viseme | undefined> = {
  m: "A", b: "A", p: "A", ph: "G", v: "G", l: "H", n: "B", d: "B", đ: "B", t: "B", th: "B", tr: "B", ch: "B", x: "B", s: "B", r: "B", gi: "B", nh: "B", qu: "F",
};
const vowelShape: Record<string, Viseme> = { a: "D", ă: "D", â: "C", ơ: "C", e: "C", ê: "C", i: "B", y: "B", ư: "B", o: "E", ô: "E", u: "F" };

interface Phones { initial?: Viseme; medial: boolean; vowels: Viseme[]; final?: Viseme }

export function phones(word: string): Phones {
  const plain = word.toLowerCase().normalize("NFD").replace(toneMarks, "").normalize("NFC").replace(/[^a-zăâêôơưđ]/g, "");
  let initial = initials.find(item => plain.startsWith(item)) ?? "";
  // "gi" chỉ là phụ âm đầu khi theo sau là nguyên âm khác (gì = g + i).
  if (initial === "gi" && !vowelLetters.includes(plain[2] ?? "")) initial = "g";
  const rest = plain.slice(initial.length);
  const final = finals.find(item => rest.endsWith(item) && vowelLetters.includes(rest[rest.length - item.length - 1] ?? "")) ?? "";
  let cluster = rest.slice(0, rest.length - final.length);
  // Âm đệm o/u (hoa, khoẻ, thuỷ, huệ, quân): môi tròn lướt nhanh trước nguyên âm chính.
  const medial = initial === "qu" || /^(o[aăe]|u[yêâơ])/.test(cluster);
  if (medial && initial !== "qu") cluster = cluster.slice(1);
  const vowels: Viseme[] = [];
  for (const [index, letter] of [...cluster].entries()) {
    const shape = vowelShape[letter];
    if (!shape) continue;
    // Bán nguyên âm cuối (ai, ao, au, oi, eo, iu…) giữ vai trò âm cuối.
    const glide = index === cluster.length - 1 && index > 0 && "iyou".includes(letter) && !final;
    if (!glide && vowels.at(-1) !== shape) vowels.push(shape);
  }
  const last = cluster.at(-1) ?? "";
  const glide = !final && cluster.length > 1 && "iyou".includes(last) ? (last === "i" || last === "y" ? "B" : "F") : undefined;
  const rounded = /[oôu]$/.test(cluster);
  const finalShape: Viseme | undefined = final === "m" || final === "p" || ((final === "ng" || final === "c") && rounded)
    ? "A"
    : final === "n" || final === "t" || final === "nh" || final === "ch" ? "B" : glide;
  return { initial: initialShape[initial], medial, vowels: vowels.length ? vowels : ["C"], final: finalShape };
}

/** Khẩu hình đặt tại các mốc trong một âm tiết, theo thói quen của người làm hoạt hình: phụ âm môi khép trước, nguyên âm hiện sớm hơn đỉnh năng lượng. */
function syllableKeys(syllable: Syllable): VisemeKey[] {
  const { start, nucleus, end } = syllable;
  const word = phones(syllable.text);
  const keys: VisemeKey[] = [];
  const vowelAt = nucleus - 0.035;
  if (word.initial === "A") keys.push({ time: Math.max(start - 0.03, vowelAt - 0.11), viseme: "A" });
  else if (word.initial) keys.push({ time: Math.max(start, vowelAt - 0.09), viseme: word.initial });
  if (word.medial && word.initial !== "F") keys.push({ time: vowelAt - 0.05, viseme: "F" });
  keys.push({ time: vowelAt, viseme: word.vowels[0]! });
  if (word.vowels[1]) keys.push({ time: nucleus + (end - nucleus) * 0.35, viseme: word.vowels[1] });
  if (word.final) keys.push({ time: nucleus + Math.max(0.07, (end - nucleus) * 0.62), viseme: word.final });
  return keys;
}

/** Độ ưu tiên khi hai khẩu hình quá sát nhau: môi khép (m, b, p) là chi tiết khán giả nhận ra lệch tiếng rõ nhất, phải giữ. */
const priority: Record<Viseme, number> = { A: 4, G: 3, F: 3, D: 2, E: 2, C: 2, H: 1, B: 1, X: 0 };

/** Làm mượt kiểu Rhubarb: mỗi khẩu hình giữ ≥ 70 ms (môi khép ≥ 50 ms, luôn trùm ít nhất một khung 24 hình/giây), bỏ khẩu hình kém quan trọng hơn khi quá sát, chèn khẩu hình trung gian giữa mở rộng và khép môi. */
function smoothTrack(keys: VisemeKey[]) {
  keys.sort((a, b) => a.time - b.time);
  const track: VisemeKey[] = [];
  for (const key of keys) if (track.at(-1)?.viseme !== key.viseme) track.push({ ...key });
  const minimum = (key: VisemeKey) => key.viseme === "A" ? 0.05 : 0.07;
  for (let changed = true; changed;) {
    changed = false;
    for (let index = 0; index < track.length - 1; index++) {
      const [key, next] = [track[index]!, track[index + 1]!];
      if (next.time - key.time >= minimum(key)) continue;
      // Bỏ khẩu hình ít quan trọng hơn; khẩu hình còn lại chiếm trọn khoảng thời gian của cả hai.
      if (priority[next.viseme] > priority[key.viseme]) {
        next.time = key.time;
        track.splice(index, 1);
      } else {
        track.splice(index + 1, 1);
      }
      if (track[index - 1]?.viseme === track[index]?.viseme) track.splice(index, 1);
      changed = true;
      break;
    }
  }
  const tweened: VisemeKey[] = [];
  for (const [index, key] of track.entries()) {
    const previous = track[index - 1];
    const following = track[index + 1];
    if (previous?.viseme === "D" && key.viseme === "A" && key.time - previous.time > 0.12) tweened.push({ time: key.time - 0.04, viseme: "C" });
    tweened.push(key);
    if (previous?.viseme === "A" && key.viseme === "D" && (following?.time ?? Infinity) - key.time > 0.12) {
      tweened.push({ time: key.time + 0.04, viseme: "D" });
      key.viseme = "C";
    }
  }
  return tweened;
}

/** Tách lời thành âm tiết (mỗi chữ tiếng Việt là một âm tiết) và đánh dấu chữ mở đầu cụm sau dấu câu. */
function wordsOf(text: string) {
  const words: { text: string; phraseStart: boolean }[] = [];
  let pause = true;
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const core = token.replace(/[^\p{L}\p{N}]/gu, "");
    if (core) words.push({ text: core, phraseStart: pause });
    pause = /[,.;:!?…—–-]$/.test(token) || /^[([“"]/.test(token);
  }
  return words;
}

/**
 * Căn khẩu hình theo âm tiết thật của giọng đọc: tìm hạt nhân âm tiết trong tín hiệu, căn với chữ bằng quy hoạch động,
 * đặt khẩu hình Preston Blair theo phụ âm đầu, nguyên âm, âm cuối của từng âm tiết rồi làm mượt.
 * Giọng câm (toàn số 0) hoặc tín hiệu không đủ đỉnh thì chia đều theo nhịp đọc.
 */
export function lipSync(text: string, samples: Float32Array, rate: number): LipSync {
  const words = wordsOf(text);
  const duration = samples.length / rate;
  if (!words.length) return { syllables: [], track: [{ time: 0, viseme: "X" }] };
  const { peaks, gaps, first, last } = analyse(samples, rate);
  const hasVoice = peaks.length >= Math.max(1, words.length * 0.3);
  const [from, to] = hasVoice ? [first, last] : [0.05, Math.max(0.1, duration - 0.3)];
  const expected = expectedTimes(words.length, from, to, hasVoice ? gaps : []);
  const matched = hasVoice ? align(words, peaks, expected, Math.max(0.3, (to - from) * 0.12)) : [];
  const nuclei = words.map((_, index) => matched[index] === undefined ? undefined : peaks[matched[index]!]!.time);
  // Âm tiết không khớp đỉnh: nội suy giữa hai âm tiết đã khớp gần nhất, giữ đúng thứ tự.
  for (let index = 0; index < words.length; index++) {
    if (nuclei[index] !== undefined) continue;
    const before = nuclei.slice(0, index).findLastIndex(value => value !== undefined);
    const after = nuclei.findIndex((value, position) => position > index && value !== undefined);
    const a = before >= 0 ? nuclei[before]! : from;
    const b = after >= 0 ? nuclei[after]! : to;
    const [ia, ib] = [before >= 0 ? before : -0.5, after >= 0 ? after : words.length - 0.5];
    nuclei[index] = before < 0 && after < 0 ? expected[index]! : a + (b - a) * (index - ia) / (ib - ia);
  }
  for (let index = 1; index < nuclei.length; index++) nuclei[index] = Math.max(nuclei[index]!, nuclei[index - 1]! + 0.06);
  const inGap = (a: number, b: number) => gaps.find(([start, end]) => start >= a && end <= b);
  const strengths = words.map((_, index) => matched[index] === undefined ? 0.3 : peaks[matched[index]!]!.strength);
  const syllables: Syllable[] = words.map((word, index) => {
    const nucleus = nuclei[index]!;
    const previous = nuclei[index - 1];
    const next = nuclei[index + 1];
    const gapBefore = previous === undefined ? undefined : inGap(previous, nucleus);
    const gapAfter = next === undefined ? undefined : inGap(nucleus, next);
    const start = previous === undefined ? Math.max(from - 0.04, nucleus - 0.22) : gapBefore ? Math.max(gapBefore[1] - 0.04, nucleus - 0.22) : (previous + nucleus) / 2;
    const end = next === undefined ? Math.min(to + 0.04, nucleus + 0.3) : gapAfter ? Math.min(gapAfter[0] + 0.03, nucleus + 0.3) : (nucleus + next) / 2;
    return { text: word.text, start, nucleus, end, stress: strengths[index]! };
  });
  const keys: VisemeKey[] = [{ time: 0, viseme: "X" }];
  for (const [index, syllable] of syllables.entries()) {
    keys.push(...syllableKeys(syllable));
    const next = syllables[index + 1];
    if (!next || next.start - syllable.end > 0.18) keys.push({ time: syllable.end + 0.02, viseme: "X" });
  }
  // Hình đi trước tiếng khoảng một khung: mắt người cảm nhận khớp hơn khi khẩu hình hơi sớm.
  const track = smoothTrack(keys).map(key => ({ time: Math.max(0, key.time - 0.03), viseme: key.viseme }));
  return { syllables, track };
}

/** Khẩu hình tại thời điểm t (tính từ đầu câu). */
export function visemeAt(track: VisemeKey[], t: number): Viseme {
  let low = 0;
  let high = track.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (track[middle]!.time <= t) low = middle;
    else high = middle - 1;
  }
  return track[low]?.time !== undefined && track[low]!.time <= t ? track[low]!.viseme : "X";
}
