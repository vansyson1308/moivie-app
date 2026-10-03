import { createCanvas } from "@napi-rs/canvas";
import { access, mkdir, readdir, readFile, writeFile } from "@toonflow/file";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative } from "node:path";
import { ambience, foley, mix, music, reverb, writeWav, type Clip, type FoleyKind, type Mood, type Surface } from "./audio";
import type { FilmSpec } from "./film";
import { createRenderer } from "./frame";
import { ffmpeg } from "./encode";
import { renderPlates, studioVersion } from "./stage3d";
import { hashSeed, strideOf, walkProgress } from "./motion";
import type { Ambience } from "./set";
import { collectLines, compile, elementOffset, stateAt, transitionLength, validate, type CompiledShot, type Timeline } from "./timeline";
import { synthesize, type VoiceEngine, type VoiceResult } from "./voice";

// Mã nguồn bộ dựng (gồm thư mục con như rig/) là một phần khoá đệm: sửa bộ dựng thì dựng lại.
const sources = (await readdir(import.meta.dirname, { recursive: true })).filter(name => name.endsWith(".ts")).sort();
export const engineVersion = createHash("sha256").update((await Promise.all(sources.map(name => readFile(join(import.meta.dirname, name), "utf8")))).join("\n")).digest("hex").slice(0, 12);
export interface Project { file: string; directory: string; name: string; spec: FilmSpec }
/**
 * engine "3d": cảnh dựng bằng Blender/Cycles (studioPython là Python 3.11 có bpy), bản 2D vẫn là bản nháp/animatic.
 * shard [i, n]: chỉ dựng khung 3D của phần thứ i trong n phần rồi dừng (máy dựng song song), lần chạy không shard ghép phim.
 */
export interface RenderOptions {
  draft?: boolean; voice: VoiceEngine; python?: string; serverUrl?: string; shots?: number[]; log: (message: string) => void;
  engine?: "2d" | "3d"; studioPython?: string; shard?: [number, number];
}

// Khổ rạp: scope 2,39:1 và flat 1,85:1 trên bề ngang 1920 (DCI dùng 2048, tỉ lệ giữ nguyên); chiều cao làm chẵn cho yuv420p.
const sizes = { landscape: [1920, 1080], scope: [1920, 804], flat: [1920, 1038], portrait: [1080, 1920], square: [1080, 1080] } as const;

export function frameSize(spec: FilmSpec, draft = false): [number, number] {
  const [width, height] = sizes[spec.options.format ?? "landscape"];
  const scale = draft ? 1 / 3 : spec.options.resolution === "4k" ? 2 : 1;
  return [Math.round(width * scale / 2) * 2, Math.round(height * scale / 2) * 2];
}

export async function prepare(project: Project, options: Pick<RenderOptions, "voice" | "python" | "serverUrl" | "log">) {
  const problems = validate(project.spec);
  if (problems.length) throw new Error(`Kịch bản có lỗi:\n- ${problems.join("\n- ")}`);
  const voices = await synthesize(collectLines(project.spec), {
    engine: options.voice, cacheDirectory: join(project.directory, "build", "voice"), python: options.python, serverUrl: options.serverUrl, log: options.log,
  });
  return { timeline: compile(project.spec, voices), voices };
}

export async function checkFfmpeg() {
  try { await ffmpeg(["-version"]); }
  catch { throw new Error("Không tìm thấy FFmpeg. Cài FFmpeg vào PATH hoặc đặt biến FFMPEG_PATH trỏ tới tệp chạy ffmpeg."); }
}

/**
 * Lát nội dung ảnh hưởng tới hình của một góc máy trong khoảng [from, to] (giây, tuyệt đối): trạng thái mỗi nhân vật lúc đầu
 * góc máy, các động tác/lời nói/di chuyển vật thể chạm vào khoảng đó (lùi thêm 1,6 s cho quán tính tóc áo sau khi dừng bước).
 * Mọi mốc thời gian tính tương đối theo đầu cảnh: dời cảnh hay sửa nhịp ở góc máy khác không làm góc máy này dựng lại.
 */
function slice(spec: FilmSpec, timeline: Timeline, shot: CompiledShot, from: number, to: number) {
  if (shot.scene === undefined) return { card: shot.card, duration: shot.duration, at: [from - shot.start, to - shot.start] };
  const scene = timeline.scenes[shot.scene]!;
  const [a, b] = [Math.min(from, shot.start) - scene.start, to - scene.start];
  const touches = (start: number, duration: number, before = 0) => start <= b && start + duration >= a - before;
  return {
    spec: shot.spec, start: shot.start - scene.start, duration: shot.duration, window: [a, b], setId: scene.setId, set: scene.set, props: spec.props,
    cast: Object.keys(scene.initial).map(id => ({
      id, character: spec.characters[id], state: stateAt(scene, id, a),
      actions: scene.actions[id]!.filter(action => touches(action.start, action.duration, 1.6)),
      speech: scene.speech[id]!.filter(line => touches(line.start, line.duration)),
    })),
    lines: scene.lines.filter(line => touches(line.start, line.duration + 0.15)).map(line => ({ ...line, voice: undefined })),
    moves: scene.moves.filter(move => touches(move.start, move.duration)),
    offsets: (scene.set.elements ?? []).filter(element => element.id).map(element => elementOffset(scene, element.id!, a)),
  };
}

/** plates: thư mục khung 3D của đoạn (bản dựng --engine 3d). */
export interface Segment { shot: number; start: number; frames: number; file: string; plates?: string }

/**
 * Mỗi góc máy là một hoặc hai đoạn: phần đầu chồng hình với góc máy trước (hòa hình, gạt, iris) và phần thân chỉ phụ thuộc
 * chính nó. Sửa góc máy trước chỉ dựng lại phần chuyển cảnh, không dựng lại cả góc máy sau.
 */
function segmentsOf(spec: FilmSpec, timeline: Timeline, shot: CompiledShot, size: [number, number], fps: number, directory: string, engine: string): Segment[] {
  const replacer = (key: string, value: unknown) => value instanceof Float32Array
    ? [value.length, Math.round(value.reduce((sum, item, index) => sum + item * (index % 97), 0) * 1000)]
    : key === "index" || key === "label" ? undefined
    : typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
  const previous = timeline.shots[shot.index - 1];
  const next = timeline.shots[shot.index + 1];
  const kind = shot.spec?.transition;
  const total = Math.round(shot.duration * fps);
  const overlap = previous && (kind === "dissolve" || kind === "wipe" || kind === "iris") ? Math.min(total, Math.round(transitionLength(shot) * fps)) : 0;
  const base = {
    engineVersion, size, fps, look: spec.options.look, subtitles: spec.options.subtitles,
    ...engine !== "2d" ? { engine, studioVersion } : {},
    shot: slice(spec, timeline, shot, shot.start, shot.start + shot.duration),
    previous: previous?.card ? "card" : "",
    next: next ? next.card ? "card" : `${next.spec?.transition ?? ""}:${transitionLength(next)}` : "end",
  };
  const segment = (from: number, frames: number, blend?: unknown): Segment => {
    const key = createHash("sha256").update(JSON.stringify({ ...base, from, frames, blend }, replacer)).digest("hex").slice(0, 20);
    return { shot: shot.index, start: shot.start + from / fps, frames, file: join(directory, `${key}.mp4`) };
  };
  if (!overlap) return [segment(0, total)];
  const head = segment(0, overlap, slice(spec, timeline, previous!, previous!.start, shot.start + overlap / fps));
  return overlap < total ? [head, segment(overlap, total - overlap)] : [head];
}

/** Dựng các đoạn song song trên nhiều nhân CPU; đoạn không đổi thì dùng lại bản đã dựng. */
async function renderShots(project: Project, timeline: Timeline, options: RenderOptions, fps: number, size: [number, number], indexes: number[]) {
  const engine = options.engine ?? "2d";
  // Bản 3D: khoá đệm gồm cả phông trời vẽ sẵn (đổi tranh thì dựng lại).
  const matteDirectory = join(project.directory, "matte");
  const mattes = await readdir(matteDirectory).catch(() => [] as string[]);
  const matte = createHash("sha256").update((await Promise.all(mattes.sort().map(name => readFile(join(matteDirectory, name))))).map(data => createHash("sha256").update(data).digest("hex")).join()).digest("hex").slice(0, 12);
  const directory = join(project.directory, "build", `${options.draft ? "shotsDraft" : "shots"}${engine === "3d" ? "3d" : ""}`);
  await mkdir(directory, { recursive: true });
  const segments = indexes.flatMap(index => segmentsOf(project.spec, timeline, timeline.shots[index]!, size, fps, directory, engine === "3d" ? `3d:${matte}` : engine));
  const pending: Segment[] = [];
  for (const segment of segments) {
    if (!await access(segment.file).then(() => true, () => false) && !pending.some(item => item.file === segment.file)) pending.push(segment);
  }
  if (engine === "3d") {
    // Khung 3D dựng trước (mỗi tiến trình Blender đã dùng hết nhân CPU), sau đó các luồng chỉ còn ghép lớp và mã hoá.
    const plates = join(project.directory, "build", "plates");
    const [part, parts] = options.shard ?? [0, 1];
    for (const [index, segment] of pending.entries()) {
      segment.plates = join(plates, basename(segment.file, ".mp4"));
      if (index % parts !== part) continue;
      const shot = timeline.shots[segment.shot]!;
      options.log(`  🧊 ${shot.label} · ${segment.frames} khung${options.shard ? ` · phần ${part + 1}/${parts}` : ""}`);
      await renderPlates(project.spec, timeline, segment, segment.plates, {
        size, fps, draft: options.draft, python: options.studioPython ?? "python3", cardDirectory: join(plates, "cards"), matteDirectory, log: options.log,
      });
    }
    if (options.shard) return [];
  }
  if (!pending.length) return segments.map(segment => segment.file);
  // Đoạn dài làm trước để các luồng xong gần cùng lúc.
  pending.sort((a, b) => b.frames - a.frames);
  const cores = navigator.hardwareConcurrency || 2;
  const count = Math.max(1, Math.min(pending.length, Math.ceil(cores * 0.75), Number(process.env.CINEMA_WORKERS) || 8));
  const threads = Math.max(1, Math.floor(cores / count));
  options.log(`  ${pending.length} đoạn cần dựng · ${count} luồng song song`);
  await new Promise<void>((resolve, reject) => {
    let running = count;
    let failed = false;
    for (let worker = 0; worker < count; worker++) {
      const thread = new Worker(new URL("./shotWorker.ts", import.meta.url).href);
      let current: Segment | undefined;
      const next = () => {
        current = pending.shift();
        if (!current || failed) {
          thread.terminate();
          if (--running === 0 && !failed) resolve();
          return;
        }
        thread.postMessage({ job: current });
      };
      thread.onmessage = (event: MessageEvent<{ done?: boolean; error?: string; seconds?: number }>) => {
        if (event.data.error !== undefined) {
          failed = true;
          thread.terminate();
          reject(new Error(event.data.error));
          return;
        }
        const shot = timeline.shots[current!.shot]!;
        const part = current!.frames === Math.round(shot.duration * fps) ? "" : current!.start === shot.start ? " · đoạn chuyển cảnh" : " · phần thân";
        options.log(`  🎬 ${shot.label}${part} · ${(current!.frames / fps).toFixed(1)}s · ${event.data.seconds!.toFixed(1)}s dựng`);
        next();
      };
      thread.onerror = event => { failed = true; reject(new Error(event.message)); };
      thread.postMessage({ setup: { spec: project.spec, timeline, size, fps, draft: options.draft, threads } });
      next();
    }
  });
  return segments.map(segment => segment.file);
}

function sceneAmbience(timeline: Timeline, index: number): Ambience {
  const set = timeline.scenes[index]!.set;
  if (set.ambience) return set.ambience;
  if (set.weather === "rain") return "rain";
  if (set.interior) return "room";
  if ((set.elements ?? []).some(element => element.type === "river" || element.type === "boat")) return "river";
  if ((set.elements ?? []).some(element => element.type === "sea")) return "sea";
  if (set.time === "night") return "night";
  return "wind";
}

/**
 * Tiếng động khớp hình: lấy mốc từ chính dòng thời gian diễn xuất (gót chạm đất theo pha bước, nhịp chèo, lúc tiếp đất,
 * lúc cử động áo quần, trao thư), chất liệu bước chân theo mặt nền của bối cảnh.
 */
function foleyEvents(timeline: Timeline) {
  const events: { time: number; kind: FoleyKind; surface: Surface; id: string; gain: number }[] = [];
  for (const scene of timeline.scenes) {
    const surface: Surface = scene.set.interior ? (scene.set.ground === "tile" || scene.set.ground === "stone" ? scene.set.ground : "wood") : scene.set.ground ?? "dirt";
    for (const [id, actions] of Object.entries(scene.actions)) {
      const character = timeline.characters[id]!;
      // Người đứng trên thuyền: bước chân là sàn gỗ.
      const floor = scene.initial[id]!.ride ? "wood" : surface;
      for (const action of actions) {
        const at = (local: number, kind: FoleyKind, gain = 1) => events.push({ time: scene.start + local, kind, surface: floor, id, gain });
        if (action.name === "walk" || action.name === "run") {
          const stride = strideOf(character, action.name === "run");
          const distance = Math.abs((action.params.to ?? action.from.x) - action.from.x);
          let next = 0.5;
          for (let local = action.start; local <= action.start + action.duration; local += 0.005) {
            const phase = walkProgress(action, local).travel * distance / stride;
            if (phase >= next) {
              at(local, "step", action.name === "run" ? 1.2 : character.age === "child" ? 0.6 : 0.85);
              next += 1;
            }
          }
          at(action.start + action.duration - 0.05, "step", 0.6);
        }
        if (action.name === "row") {
          // Nhịp chèo trong poseAt là sin(2,6·t): mái chèo xuống nước ở đỉnh mỗi chu kỳ.
          const period = Math.PI * 2 / 2.6;
          for (let k = Math.ceil((action.start * 2.6 - Math.PI / 2) / (Math.PI * 2)); ; k++) {
            const local = (Math.PI / 2 + k * Math.PI * 2) / 2.6;
            if (local > action.start + action.duration) break;
            if (local >= action.start + period * 0.3) at(local, "splash", 0.9);
          }
        }
        if (action.name === "jump") {
          at(action.start + action.duration * 0.25, "step", 0.8);
          at(action.start + action.duration * 0.8, "thud", 1);
        }
        if (["sit", "stand", "kneel", "bow", "embrace", "handToChest", "shrug", "pickUp", "putDown", "turn", "point", "wave", "cry"].includes(action.name)) at(action.start + 0.05, "rustle", 0.6);
        if ((action.name === "give" || action.name === "receive") && action.params.prop) at(action.start + action.duration * 0.55, "paper", 0.7);
      }
    }
  }
  return events;
}

/**
 * Trộn tiếng: thoại (pan theo vị trí người nói trên màn hình, vang theo không gian), tiếng động, tiếng nền từng cảnh
 * nối cầu giữa các cảnh, nhạc nền theo từng đoạn cùng tâm trạng.
 */
async function renderAudio(project: Project, timeline: Timeline, voices: VoiceResult[], path: string, from = 0, to = timeline.duration) {
  const clips: Clip[] = [];
  // Bộ dựng tí hon chỉ để hỏi vị trí nhân vật trong khung hình (cùng máy quay với hình thật).
  const locator = createRenderer(project.spec, timeline, 64, 36);
  const sceneAt = (time: number) => timeline.scenes.find(scene => time >= scene.start && time < scene.start + scene.duration);
  for (const line of timeline.lines) {
    const samples = voices[line.voice]!.samples;
    const pan = line.speaker === "narrator" ? 0 : (locator.locate(line.speaker, line.start + line.duration / 2) ?? 0) * 0.35;
    clips.push({ samples: [samples], start: line.start - from, gain: 1, voice: true, pan });
    const scene = sceneAt(line.start);
    if (!scene || line.speaker === "narrator") continue;
    // Vang theo không gian: phòng kín rõ, ngoài trời chỉ thoáng chút phản xạ.
    const [wetLeft, wetRight] = reverb(samples, scene.set.interior ? 0.35 : 0.1, hashSeed(line.text));
    clips.push({ samples: [wetLeft!, wetRight!], start: line.start - from, gain: scene.set.interior ? 0.22 : 0.07, duck: false });
  }
  for (const [index, event] of foleyEvents(timeline).entries()) {
    const pan = (locator.locate(event.id, event.time) ?? 0) * 0.6;
    clips.push({ samples: [foley(event.kind, event.surface, index * 7919 + 13)], start: event.time - from, gain: 0.2 * event.gain, pan, duck: false });
  }
  for (const [index, scene] of timeline.scenes.entries()) {
    const kind = sceneAmbience(timeline, index);
    // Cầu âm thanh (J/L cut): tiếng nền cảnh sau vào trước khi cắt hình 1 giây, tiếng cảnh trước còn vọng 1 giây sau đó.
    clips.push({ samples: ambience(kind, scene.duration + 2, hashSeed(`${scene.setId}${index}`)), start: scene.start - 1 - from, gain: kind === "room" ? 0.15 : 0.22, fade: 1.2 });
  }
  const segments = [
    ...timeline.scenes.map(scene => ({ start: scene.start, duration: scene.duration, mood: scene.music })),
    ...timeline.cards.map(card => ({ start: card.start, duration: card.duration, mood: card.music })),
  ].sort((a, b) => a.start - b.start);
  const runs: { start: number; duration: number; mood: Mood }[] = [];
  for (const segment of segments) {
    const last = runs.at(-1);
    if (last && last.mood === segment.mood) last.duration = segment.start + segment.duration - last.start;
    else runs.push({ ...segment });
  }
  for (const [index, run] of runs.entries()) {
    if (run.mood === "none") continue;
    clips.push({ samples: music(run.mood, run.duration + 1.5, hashSeed(`${project.spec.options.title}${index}`)), start: run.start - from, gain: 0.3, fade: 1.6 });
  }
  await writeWav(path, mix(clips, to - from));
}

function srt(timeline: Timeline) {
  const stamp = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    const pad = (value: number, length = 2) => String(value).padStart(length, "0");
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return timeline.lines.map((line, index) => `${index + 1}\n${stamp(line.start)} --> ${stamp(line.start + line.duration)}\n${line.text}\n`).join("\n");
}

export async function renderFilm(project: Project, options: RenderOptions) {
  await checkFfmpeg();
  const started = performance.now();
  const { timeline, voices } = await prepare(project, options);
  // ACT: bản nháp vẫn 24 hình/giây (chỉ giảm độ phân giải) để mốc cắt khớp lưới khung, hình–tiếng không trôi.
  const fps = 24;
  const size = frameSize(project.spec, options.draft);
  const indexes = options.shots?.length ? options.shots.filter(index => timeline.shots[index]) : timeline.shots.map(shot => shot.index);
  options.log(`Dựng ${indexes.length}/${timeline.shots.length} góc máy · ${size.join("×")} · ${fps} hình/giây · phim dài ${timeline.duration.toFixed(1)}s`);
  const files = await renderShots(project, timeline, options, fps, size, indexes);
  const out = join(project.directory, "out");
  const build = join(project.directory, "build");
  await mkdir(out, { recursive: true });
  const partial = options.shots?.length;
  const name = partial ? `${project.name}-xem-thu` : options.draft ? `${project.name}-nhap` : project.name;
  const list = join(build, "concat.txt");
  await writeFile(list, files.map(file => `file '${relative(build, file).replaceAll("\\", "/").replaceAll("'", "'\\''")}'`).join("\n"));
  const audio = join(build, "audio.wav");
  const from = timeline.shots[indexes[0]!]!.start;
  const to = partial ? from + indexes.reduce((sum, index) => sum + timeline.shots[index]!.duration, 0) : timeline.duration;
  if (partial) {
    // Bản xem thử: ghép tiếng theo đúng các góc máy được chọn.
    const whole = join(build, "audioFull.wav");
    await renderAudio(project, timeline, voices, whole);
    const parts: string[] = [];
    for (const index of indexes) {
      const shot = timeline.shots[index]!;
      const part = join(build, `audioPart${index}.wav`);
      await ffmpeg(["-ss", shot.start.toFixed(3), "-t", shot.duration.toFixed(3), "-i", whole, part]);
      parts.push(part);
    }
    await writeFile(join(build, "audioParts.txt"), parts.map(part => `file '${relative(build, part).replaceAll("\\", "/")}'`).join("\n"));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", join(build, "audioParts.txt"), audio]);
  } else {
    await renderAudio(project, timeline, voices, audio, from, to);
  }
  const video = join(out, `${name}.mp4`);
  await ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", "-movflags", "+faststart", video,
  ]);
  const subtitles = join(out, `${name}.srt`);
  if (!partial) await writeFile(subtitles, srt(timeline));
  // Tự kiểm: số khung thực tế phải bằng thời lượng × fps, nếu lệch thì hình và tiếng sẽ trôi nhau.
  const probe = Bun.spawnSync([process.env.FFPROBE_PATH || "ffprobe", "-v", "error", "-select_streams", "v", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", video]);
  const frames = Number(probe.stdout.toString().trim());
  const expected = indexes.reduce((sum, index) => sum + Math.round(timeline.shots[index]!.duration * fps), 0);
  if (frames && frames !== expected) options.log(`⚠ Số khung ${frames} khác dự kiến ${expected}: hình và tiếng có thể lệch nhau`);
  const report = {
    title: project.spec.options.title, video: relative(project.directory, video), duration: Number(to - from).toFixed(2), fps, size, frames, expectedFrames: expected,
    shots: indexes.length, lines: timeline.lines.length, voice: options.voice, renderSeconds: ((performance.now() - started) / 1000).toFixed(1), engineVersion,
  };
  await writeFile(join(out, `${name}-report.json`), JSON.stringify(report, null, 2));
  return { video, subtitles: partial ? undefined : subtitles, report, timeline };
}

/** Máy dựng song song: chỉ dựng khung 3D của phần options.shard trong thư mục build/plates (không ghép phim). */
export async function renderShard(project: Project, options: RenderOptions & { shard: [number, number] }) {
  const { timeline } = await prepare(project, options);
  const indexes = options.shots?.length ? options.shots.filter(index => timeline.shots[index]) : timeline.shots.map(shot => shot.index);
  await renderShots(project, timeline, { ...options, engine: "3d" }, 24, frameSize(project.spec, options.draft), indexes);
  return timeline;
}

/** Trang duyệt storyboard: mỗi góc máy 3 khung (đầu, giữa, cuối) để agent và người dùng soát bố cục, diễn xuất, máy quay. */
export async function renderSheets(project: Project, options: Omit<RenderOptions, "draft">) {
  const { timeline } = await prepare(project, options);
  const [width, height] = frameSize(project.spec, true);
  const renderer = createRenderer(project.spec, timeline, width, height);
  const rows = 5;
  const label = 260;
  const out = join(project.directory, "out");
  await mkdir(out, { recursive: true });
  const pages: string[] = [];
  const shots = options.shots?.length ? options.shots.map(index => timeline.shots[index]!).filter(Boolean) : timeline.shots;
  for (let page = 0; page * rows < shots.length; page++) {
    const slice = shots.slice(page * rows, page * rows + rows);
    const sheet = createCanvas(label + width * 3 + 40, slice.length * (height + 20) + 20);
    const ctx = sheet.getContext("2d");
    ctx.fillStyle = "#1b1917";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (const [row, shot] of slice.entries()) {
      const y = 20 + row * (height + 20);
      ctx.fillStyle = "#f3e3c3";
      ctx.font = "20px Cinema";
      ctx.fillText(`#${shot.index}`, 16, y + 28);
      ctx.font = "14px Cinema";
      ctx.fillStyle = "#cfc6b8";
      const words = shot.label.split(" · ").slice(1);
      words.forEach((word, index) => ctx.fillText(word, 16, y + 54 + index * 20, label - 24));
      ctx.fillText(`${shot.start.toFixed(1)}s +${shot.duration.toFixed(1)}s`, 16, y + 54 + words.length * 20, label - 24);
      for (const [column, at] of [0.08, 0.5, 0.92].entries()) {
        renderer.draw(shot.start + shot.duration * at);
        ctx.drawImage(renderer.canvas, label + column * (width + 10), y);
      }
    }
    const file = join(out, `sheet-${String(page + 1).padStart(2, "0")}.png`);
    await writeFile(file, await sheet.encode("png"));
    pages.push(file);
  }
  return { pages, timeline };
}

export async function renderStill(project: Project, options: Omit<RenderOptions, "draft">, time: number) {
  const { timeline } = await prepare(project, options);
  const renderer = createRenderer(project.spec, timeline, ...frameSize(project.spec), { motionBlur: true });
  renderer.draw(time);
  const file = join(project.directory, "out", `still-${time.toFixed(1)}s.png`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await renderer.canvas.encode("png"));
  return file;
}
