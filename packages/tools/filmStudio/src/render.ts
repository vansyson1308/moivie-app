import type { FfmpegCommand, FfmpegFactory, FfprobeData, ToolContext } from "@toonflow/tools-scaffold/runtime";
import type { Project, Shot } from "./project";

type Context = Pick<ToolContext, "ffmpeg" | "files">;
export interface Cue { start: number; end: number; speaker: string; text: string }

const audioFormat = "aformat=sample_rates=48000:channel_layouts=stereo";
const encode = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];
// Khoảng lặng trước câu đầu và giữa các câu thoại trong một cảnh.
const voiceLead = 0.3;
const voiceGap = 0.25;

export async function run(context: Context, signal: AbortSignal | undefined, build: (ffmpeg: FfmpegFactory) => FfmpegCommand) {
  const command = build(await context.ffmpeg(signal));
  await new Promise<void>((resolve, reject) => {
    const cancel = () => command.kill("SIGKILL");
    const finish = (error?: unknown) => {
      signal?.removeEventListener("abort", cancel);
      if (error) reject(signal?.aborted ? signal.reason : error);
      else resolve();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    command.on("start", () => { if (signal?.aborted) command.kill("SIGKILL"); });
    command.on("error", finish);
    command.on("end", () => finish());
    command.run();
  });
}

export async function probe(context: Context, path: string, signal?: AbortSignal) {
  const ffmpeg = await context.ffmpeg(signal);
  const data = await new Promise<FfprobeData>((resolve, reject) => ffmpeg.ffprobe(path, (error, result) => error ? reject(error) : resolve(result)));
  const video = data.streams.find(stream => stream.codec_type === "video");
  return {
    duration: Number(data.format.duration) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    audio: data.streams.some(stream => stream.codec_type === "audio"),
  };
}

export function frame(context: Context, video: string, output: string, seconds: number, signal?: AbortSignal) {
  return run(context, signal, ffmpeg => ffmpeg(video).inputOptions(["-ss", seconds.toFixed(3)]).outputOptions(["-frames:v", "1", "-q:v", "2"]).output(output));
}

// Khung cuối dùng để nối cảnh (như AIMovieStudio: -sseof -0.1).
export function lastFrame(context: Context, video: string, output: string, signal?: AbortSignal) {
  return run(context, signal, ffmpeg => ffmpeg(video).inputOptions(["-sseof", "-0.1"]).outputOptions(["-frames:v", "1", "-q:v", "2", "-update", "1"]).output(output));
}

// Tờ duyệt bản quay (contact sheet) 4 khung để Agent/người dùng chấm nhanh như vòng duyệt của KupkaProd.
export async function contactSheet(context: Context, video: string, output: string, signal?: AbortSignal) {
  const { duration } = await probe(context, video, signal);
  return run(context, signal, ffmpeg => ffmpeg(video)
    .outputOptions(["-vf", `fps=${(4 / Math.max(duration, 0.5)).toFixed(4)},scale=360:-2,tile=4x1:padding=4`, "-frames:v", "1", "-q:v", "3"])
    .output(output));
}

// Băm trung bình 8×8 thay cho CLIP của StoryMem: khoảng cách Hamming nhỏ nghĩa là khung gần trùng.
export async function frameHash(context: Context, image: string, signal?: AbortSignal) {
  const raw = `${image}.gray`;
  await run(context, signal, ffmpeg => ffmpeg(image).outputOptions(["-vf", "scale=8:8:flags=area,format=gray", "-f", "rawvideo", "-frames:v", "1"]).output(raw));
  try {
    const pixels = [...await context.files.readFile(raw)].slice(0, 64);
    const average = pixels.reduce((total, value) => total + value, 0) / pixels.length;
    return BigInt(`0b${pixels.map(value => value > average ? 1 : 0).join("")}`).toString(16).padStart(16, "0");
  } finally {
    await context.files.remove(raw).catch(() => {});
  }
}

export function hashDistance(a: string, b: string) {
  let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  for (; value; value >>= 1n) count += Number(value & 1n);
  return count;
}

// Ghép các câu thoại của một cảnh thành một dải tiếng (thứ tự lần lượt như chế độ "add" của LongCat-Video).
export async function voiceTrack(context: Context, shot: Shot, signal?: AbortSignal) {
  const lines = shot.dialogue.filter(line => line.audio);
  if (!lines.length) return undefined;
  const cues: Cue[] = [];
  let time = voiceLead;
  for (const line of lines) {
    cues.push({ start: time, end: time + line.audio!.duration, speaker: line.speaker, text: line.text });
    time += line.audio!.duration + voiceGap;
  }
  const path = `film/audio/${shot.id}/voice.wav`;
  await context.files.mkdir(`film/audio/${shot.id}`, true);
  await run(context, signal, ffmpeg => {
    const command = ffmpeg(lines[0]!.audio!.path);
    lines.slice(1).forEach(line => command.input(line.audio!.path));
    const delayed = cues.map((cue, index) => `[${index}:a]${audioFormat},adelay=${Math.round(cue.start * 1000)}:all=1[v${index}]`);
    const mix = lines.length > 1 ? `${cues.map((_, index) => `[v${index}]`).join("")}amix=inputs=${lines.length}:duration=longest:normalize=0[voice]` : "[v0]anull[voice]";
    return command.complexFilter([...delayed, mix].join(";")).outputOptions(["-map", "[voice]", "-c:a", "pcm_s16le"]).output(path);
  });
  return { path, duration: time - voiceGap, cues };
}

export async function sliceAudio(context: Context, input: string, output: string, start: number, duration: number, signal?: AbortSignal) {
  await run(context, signal, ffmpeg => ffmpeg(input).inputOptions(["-ss", start.toFixed(3)])
    .outputOptions(["-t", duration.toFixed(3), "-af", `${audioFormat},apad`, "-c:a", "pcm_s16le"]).output(output));
}

// Nối các đoạn của một cảnh dài; bỏ khung đầu trùng với khung cuối đoạn trước (StoryMem/LongCat bỏ phần điều kiện chồng lấn).
export async function joinSegments(context: Context, segments: string[], output: string, signal?: AbortSignal) {
  const list = `${output}.txt`;
  const directory = output.slice(0, output.lastIndexOf("/") + 1);
  const entries = segments.map((path, index) => `file '${path.slice(directory.length).replaceAll("'", "'\\''")}'${index ? "\ninpoint 0.05" : ""}`);
  await context.files.writeFile(list, `${entries.join("\n")}\n`);
  try {
    await run(context, signal, ffmpeg => ffmpeg(list).inputOptions(["-f", "concat", "-safe", "0"]).outputOptions(encode).output(output));
  } finally {
    await context.files.remove(list).catch(() => {});
  }
}

function srtTime(seconds: number) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

function wrap(text: string, width = 42) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (lines.length && `${lines.at(-1)} ${word}`.length <= width) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines.join("\n");
}

// Dựng từng cảnh về cùng khung hình/fps, trộn thoại lên âm thanh gốc, rồi nối thành phim và gắn phụ đề tiếng Việt.
export async function assemble(context: Context, project: Project, options: { output: string; music?: string; musicVolume: number }, signal?: AbortSignal) {
  const shots = project.shots;
  const first = await probe(context, shots[0]!.takes[shots[0]!.selectedTake! - 1]!.path, signal);
  const width = Math.max(2, Math.round(first.width / 2) * 2);
  const height = Math.max(2, Math.round(first.height / 2) * 2);
  await context.files.mkdir("film/render", true);
  const renders: string[] = [];
  const cues: Cue[] = [];
  let offset = 0;
  for (const [index, shot] of shots.entries()) {
    const take = shot.takes[shot.selectedTake! - 1]!.path;
    const media = await probe(context, take, signal);
    const voice = await voiceTrack(context, shot, signal);
    const duration = Math.max(media.duration, voice ? voice.duration + 0.3 : 0);
    const output = `film/render/${String(index + 1).padStart(3, "0")}-${shot.id}.mp4`;
    const filters = [
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,format=yuv420p,tpad=stop_mode=clone:stop_duration=${(duration - media.duration + 0.1).toFixed(3)}[video]`,
      media.audio ? `[0:a]${audioFormat},volume=${voice ? 0.35 : 1},apad[base]` : `anullsrc=r=48000:cl=stereo[base]`,
      voice ? `[1:a]${audioFormat},apad[voice];[base][voice]amix=inputs=2:duration=first:normalize=0[audio]` : "[base]anull[audio]",
    ];
    await run(context, signal, ffmpeg => {
      const command = ffmpeg(take);
      if (voice) command.input(voice.path);
      return command.complexFilter(filters.join(";")).outputOptions(["-map", "[video]", "-map", "[audio]", "-t", duration.toFixed(3), ...encode]).output(output);
    });
    renders.push(output);
    for (const cue of voice?.cues ?? []) cues.push({ ...cue, start: cue.start + offset, end: cue.end + offset });
    offset += (await probe(context, output, signal)).duration;
  }

  if (options.output.includes("/")) await context.files.mkdir(options.output.slice(0, options.output.lastIndexOf("/")), true);
  const subtitles = cues.length ? `${options.output.replace(/\.[^./]+$/, "")}.srt` : undefined;
  if (subtitles) await context.files.writeFile(subtitles, cues.map((cue, index) => `${index + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${wrap(cue.text)}\n`).join("\n"));
  const list = "film/render/list.txt";
  await context.files.writeFile(list, `${renders.map(path => `file '${path.slice("film/render/".length)}'`).join("\n")}\n`);
  // ACT: các đoạn đã cùng mã hóa nên nối bằng concat demuxer -c copy; chỉ mã hóa lại âm thanh khi có nhạc nền.
  await run(context, signal, ffmpeg => {
    const command = ffmpeg(list).inputOptions(["-f", "concat", "-safe", "0"]);
    if (subtitles) command.input(subtitles);
    if (options.music) command.input(options.music).inputOptions(["-stream_loop", "-1"]);
    const music = subtitles ? 2 : 1;
    const audio = options.music
      ? ["-filter_complex", `[${music}:a]${audioFormat},volume=${options.musicVolume}[music];[0:a][music]amix=inputs=2:duration=first:normalize=0[audio]`, "-map", "[audio]", "-c:a", "aac", "-b:a", "192k"]
      : ["-map", "0:a", "-c:a", "copy"];
    const text = subtitles ? ["-map", "1:s", "-c:s", "mov_text", "-metadata:s:s:0", "language=vie"] : [];
    return command.outputOptions(["-map", "0:v", "-c:v", "copy", ...audio, ...text, "-movflags", "+faststart"]).output(options.output);
  });
  return { video: options.output, subtitles, duration: offset, shots: renders.length };
}
