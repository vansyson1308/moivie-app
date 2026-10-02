import { createCanvas } from "@napi-rs/canvas";
import { access, mkdir, readdir, readFile, writeFile } from "@toonflow/file";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { ambience, mix, music, writeWav, type Clip, type Mood } from "./audio";
import type { FilmSpec } from "./film";
import { createRenderer } from "./frame";
import { ffmpeg } from "./encode";
import { hashSeed } from "./motion";
import type { Ambience } from "./set";
import { collectLines, compile, validate, type CompiledShot, type Timeline } from "./timeline";
import { synthesize, type VoiceEngine, type VoiceResult } from "./voice";

// Mã băm toàn bộ mã nguồn bộ dựng: sửa bộ dựng thì mọi góc máy được dựng lại, không dùng nhầm bản cũ.
const sources = (await readdir(import.meta.dirname)).filter(name => name.endsWith(".ts")).sort();
export const engineVersion = createHash("sha256").update((await Promise.all(sources.map(name => readFile(join(import.meta.dirname, name), "utf8")))).join("\n")).digest("hex").slice(0, 12);
export interface Project { file: string; directory: string; name: string; spec: FilmSpec }
export interface RenderOptions { draft?: boolean; voice: VoiceEngine; python?: string; serverUrl?: string; shots?: number[]; log: (message: string) => void }

const sizes = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] } as const;

export function frameSize(spec: FilmSpec, draft = false): [number, number] {
  const [width, height] = sizes[spec.options.format ?? "landscape"];
  return draft ? [Math.round(width / 3 / 2) * 2, Math.round(height / 3 / 2) * 2] : [width, height];
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

// Khóa đệm chỉ theo nội dung và thời gian tương đối: dời cả cảnh sang chỗ khác trong phim không làm dựng lại.
function shotKey(spec: FilmSpec, timeline: Timeline, shot: CompiledShot, size: [number, number], fps: number) {
  const scene = shot.scene === undefined ? undefined : timeline.scenes[shot.scene];
  const offset = scene?.start ?? shot.start;
  const replacer = (key: string, value: unknown) => value instanceof Float32Array
    ? [value.length, Math.round(value.reduce((sum, item, index) => sum + item * (index % 97), 0) * 1000)]
    : key === "index" || key === "label" ? undefined
    : typeof value === "number" ? Math.round(value * 1000) / 1000 : value;
  const payload = JSON.stringify({
    engineVersion, size, fps, look: spec.options.look, subtitles: spec.options.subtitles,
    shot: { ...shot, start: shot.start - offset }, scene: scene && { ...scene, start: 0, lines: undefined },
    lines: timeline.lines.filter(line => line.start < shot.start + shot.duration && line.start + line.duration + 0.15 > shot.start)
      .map(line => ({ ...line, start: line.start - offset, voice: undefined })),
    characters: scene ? Object.keys(scene.initial).map(id => spec.characters[id]) : [], props: spec.props,
    next: timeline.shots[shot.index + 1]?.spec?.transition ?? (timeline.shots[shot.index + 1] ? (timeline.shots[shot.index + 1]!.card ? "card" : "") : "end"),
    previous: timeline.shots[shot.index - 1]?.card ? "card" : "",
  }, replacer);
  return createHash("sha256").update(payload).digest("hex").slice(0, 20);
}

/** Dựng các góc máy song song trên nhiều nhân CPU; góc máy không đổi thì dùng lại bản đã dựng. */
async function renderShots(project: Project, timeline: Timeline, options: RenderOptions, fps: number, size: [number, number], indexes: number[]) {
  const directory = join(project.directory, "build", options.draft ? "shotsDraft" : "shots");
  await mkdir(directory, { recursive: true });
  const files = indexes.map(index => join(directory, `${shotKey(project.spec, timeline, timeline.shots[index]!, size, fps)}.mp4`));
  const pending: number[] = [];
  for (const [position, index] of indexes.entries()) if (!await access(files[position]!).then(() => true, () => false)) pending.push(index);
  if (!pending.length) return files;
  // Góc máy dài làm trước để các luồng xong gần cùng lúc.
  pending.sort((a, b) => timeline.shots[b]!.duration - timeline.shots[a]!.duration);
  const cores = navigator.hardwareConcurrency || 2;
  const count = Math.max(1, Math.min(pending.length, Math.ceil(cores * 0.75), Number(process.env.CINEMA_WORKERS) || 8));
  const threads = Math.max(1, Math.floor(cores / count));
  const fileOf = (index: number) => files[indexes.indexOf(index)]!;
  options.log(`  ${pending.length} góc máy cần dựng · ${count} luồng song song`);
  await new Promise<void>((resolve, reject) => {
    let running = count;
    let failed = false;
    for (let worker = 0; worker < count; worker++) {
      const thread = new Worker(new URL("./shotWorker.ts", import.meta.url).href);
      const next = () => {
        const index = pending.shift();
        if (index === undefined || failed) {
          thread.terminate();
          if (--running === 0 && !failed) resolve();
          return;
        }
        thread.postMessage({ job: { index, file: fileOf(index) } });
      };
      thread.onmessage = (event: MessageEvent<{ done?: number; failed?: number; seconds?: number; error?: string }>) => {
        if (event.data.failed !== undefined) {
          failed = true;
          thread.terminate();
          reject(new Error(event.data.error));
          return;
        }
        const shot = timeline.shots[event.data.done!]!;
        options.log(`  🎬 ${shot.label} · ${shot.duration.toFixed(1)}s · ${event.data.seconds!.toFixed(1)}s dựng`);
        next();
      };
      thread.onerror = event => { failed = true; reject(new Error(event.message)); };
      thread.postMessage({ setup: { spec: project.spec, timeline, size, fps, draft: options.draft, threads } });
      next();
    }
  });
  return files;
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

/** Trộn tiếng: thoại, tiếng nền từng cảnh, nhạc nền theo từng đoạn cùng tâm trạng. */
async function renderAudio(project: Project, timeline: Timeline, voices: VoiceResult[], path: string, from = 0, to = timeline.duration) {
  const clips: Clip[] = [];
  for (const line of timeline.lines) clips.push({ samples: [voices[line.voice]!.samples], start: line.start - from, gain: 1, voice: true });
  for (const [index, scene] of timeline.scenes.entries()) {
    const kind = sceneAmbience(timeline, index);
    clips.push({ samples: ambience(kind, scene.duration, hashSeed(`${scene.setId}${index}`)), start: scene.start - from, gain: kind === "room" ? 0.15 : 0.22, fade: 0.8 });
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
  const renderer = createRenderer(project.spec, timeline, ...frameSize(project.spec));
  renderer.draw(time);
  const file = join(project.directory, "out", `still-${time.toFixed(1)}s.png`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, await renderer.canvas.encode("png"));
  return file;
}
