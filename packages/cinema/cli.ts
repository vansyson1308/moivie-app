#!/usr/bin/env bun
import { access, mkdir } from "@toonflow/file";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Film } from "./src/film";
import { prepare, renderFilm, renderSheets, renderStill, type Project } from "./src/render";
import { vieneuVoices } from "./src/vieneuVoices";
import type { VoiceEngine } from "./src/voice";

const usage = `Toonflow Cinema — dựng phim hoạt hình hoàn toàn trên máy, không cần API key.

  bun run cinema check  <film.ts>                 kiểm tra kịch bản, in danh sách góc máy và thời lượng
  bun run cinema sheet  <film.ts> [--shots 0-5]    trang duyệt storyboard (3 khung mỗi góc máy) → out/sheet-*.png
  bun run cinema still  <film.ts> --at 12.5        xuất một khung hình đầy đủ độ phân giải
  bun run cinema render <film.ts> [--draft] [--shots 3,5-7]
                                                  dựng phim (hoặc chỉ các góc máy chọn) → out/*.mp4 + .srt
  bun run cinema setup                            cài VieNeu-TTS vào packages/cinema/.venv (một lần, ~1 GB)
  bun run cinema voices                           liệt kê giọng VieNeu

  --voice vieneu|silent   giọng đọc (mặc định vieneu nếu đã cài, không thì silent để dựng nháp)
  --python <đường dẫn>    Python có cài vieneu (hoặc đặt CINEMA_PYTHON); VIENEU_URL để dùng máy chủ VieNeu`;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const log = (message: string) => console.log(message);
const venv = resolve(import.meta.dirname, ".venv");
const venvPython = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const exists = (path: string) => access(path).then(() => true, () => false);

function parseShots(value?: string) {
  if (!value) return undefined;
  return value.split(",").flatMap(part => {
    const [from, to] = part.split("-").map(Number);
    return to === undefined ? [from!] : Array.from({ length: to - from! + 1 }, (_, index) => from! + index);
  });
}

async function loadProject(file?: string): Promise<Project> {
  if (!file) throw new Error("Thiếu đường dẫn film.ts");
  const path = resolve(file);
  const module = await import(pathToFileURL(path).href) as { default?: Film };
  if (!module.default?.spec) throw new Error(`${file} phải export default kết quả của createFilm(...)`);
  return { file: path, directory: dirname(path), name: basename(dirname(path)), spec: module.default.spec };
}

async function voiceOptions() {
  const python = flag("python") ?? process.env.CINEMA_PYTHON ?? (await exists(venvPython) ? venvPython : undefined);
  const serverUrl = process.env.VIENEU_URL;
  let voice = (flag("voice") as VoiceEngine | undefined) ?? (python || serverUrl ? "vieneu" : "silent");
  if (voice === "vieneu" && !python && !serverUrl) {
    log("⚠ Chưa cài VieNeu-TTS (chạy `bun run cinema setup`). Dựng tạm với giọng câm.");
    voice = "silent";
  }
  if (!flag("voice") && voice === "silent") log("ℹ Đang dùng giọng câm (nháp): thời lượng ước lượng, miệng vẫn nhép theo âm tiết.");
  return { voice, python: python ?? "python3", serverUrl, log };
}

async function main() {
  if (command === "voices") {
    for (const [name, note] of vieneuVoices) log(`${name.padEnd(16)} ${note}`);
    return;
  }
  if (command === "setup") {
    if (!await exists(venvPython)) {
      log(`Tạo môi trường Python tại ${venv}…`);
      const created = Bun.spawnSync([process.platform === "win32" ? "python" : "python3", "-m", "venv", venv], { stdout: "inherit", stderr: "inherit" });
      if (created.exitCode) throw new Error("Không tạo được môi trường Python (cần Python 3.10+).");
    }
    // ACT: onnxruntime ≥ 1.23 từ chối tệp mô hình trong cache Hugging Face (lỗi "External data path escapes model directory"); ghim bản cũ đến khi VieNeu sửa.
    const installed = Bun.spawnSync([venvPython, "-m", "pip", "install", "vieneu", "onnxruntime<1.23"], { stdout: "inherit", stderr: "inherit" });
    if (installed.exitCode) throw new Error("Cài VieNeu-TTS thất bại.");
    const probe = join(venv, "probe.wav");
    log("Tải mô hình giọng lần đầu (~1 GB) và thử đọc một câu…");
    const tested = Bun.spawnSync([venvPython, resolve(import.meta.dirname, "voice/vieneuBatch.py")], {
      stdin: new TextEncoder().encode(JSON.stringify({ items: [{ text: "Xin chào, tôi là giọng đọc của xưởng phim.", voice: "Hải Đăng", out: probe }] })),
      stdout: "inherit", stderr: "inherit",
    });
    if (tested.exitCode) throw new Error("VieNeu-TTS đã cài nhưng chưa đọc được. Xem lỗi phía trên.");
    log(`✅ Sẵn sàng. Câu thử: ${probe}`);
    return;
  }
  const project = await loadProject(args[1]);
  const options = await voiceOptions();
  const shots = parseShots(flag("shots"));
  if (command === "check") {
    const { timeline } = await prepare(project, options);
    const known = new Set<string>(vieneuVoices.map(([name]) => name));
    const voices = [...Object.values(project.spec.characters).map(character => character.voice), project.spec.options.narrator].filter(Boolean) as string[];
    for (const voice of voices) if (!known.has(voice)) log(`⚠ Giọng "${voice}" không có trong danh sách VieNeu (bun run cinema voices)`);
    log(`${project.spec.options.title}: ${timeline.scenes.length} cảnh · ${timeline.shots.length} góc máy · ${timeline.lines.length} câu · ${timeline.duration.toFixed(1)}s`);
    for (const shot of timeline.shots) {
      const lines = timeline.lines.filter(line => line.start >= shot.start && line.start < shot.start + shot.duration);
      log(`#${String(shot.index).padEnd(3)} ${shot.start.toFixed(1).padStart(6)}s +${shot.duration.toFixed(1).padStart(4)}s  ${shot.label.split(" · ").slice(1).join(" · ")}`);
      for (const line of lines) log(`        ${line.speaker}: ${line.text}`);
    }
    return;
  }
  if (command === "sheet") {
    const { pages } = await renderSheets(project, { ...options, shots });
    for (const page of pages) log(page);
    return;
  }
  if (command === "still") {
    log(await renderStill(project, { ...options, shots }, Number(flag("at") ?? 0)));
    return;
  }
  if (command === "render") {
    await mkdir(join(project.directory, "out"), { recursive: true });
    const result = await renderFilm(project, { ...options, draft: has("draft"), shots });
    log(`✅ ${result.video}`);
    if (result.subtitles) log(`   ${result.subtitles}`);
    log(`   ${result.report.duration}s · ${result.report.shots} góc máy · dựng trong ${result.report.renderSeconds}s`);
    return;
  }
  log(usage);
}

main().catch(error => {
  console.error(`✖ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
