#!/usr/bin/env bun
import { plugin } from "bun";
import { access, mkdir, readFile } from "@toonflow/file";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Film } from "./src/film";
import { prepare, renderFilm, renderShard, renderSheets, renderStill, type Project } from "./src/render";
import { paintMattes } from "./src/matte";
import { vieneuVoices } from "./src/vieneuVoices";
import type { VoiceEngine } from "./src/voice";

const usage = `Toonflow Cinema — dựng phim hoạt hình hoàn toàn trên máy, không cần API key.

  bun run cinema check  <film.ts>                 kiểm tra kịch bản, in danh sách góc máy và thời lượng
  bun run cinema sheet  <film.ts> [--shots 0-5]    trang duyệt storyboard (3 khung mỗi góc máy) → out/sheet-*.png
  bun run cinema still  <film.ts> --at 12.5        xuất một khung hình đầy đủ độ phân giải
  bun run cinema render <film.ts> [--draft] [--shots 3,5-7] [--engine 3d] [--shard 2/20]
                                                  dựng phim (hoặc chỉ các góc máy chọn) → out/*.mp4 + .srt
  bun run cinema setup                            cài VieNeu-TTS vào packages/cinema/.venv (một lần, ~1 GB)
  bun run cinema setup --3d                       cài Blender (module bpy, Python 3.11) vào packages/cinema/.venv3d (~400 MB)
  bun run cinema voices                           liệt kê giọng VieNeu
  bun run cinema matte  <film.ts>                 vẽ phông trời cho bản 3D bằng Cloudflare Workers AI → matte/<bối cảnh>.jpg
                                                  (cần CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN; chỉ chạy một lần, commit ảnh cùng phim)

  --voice vieneu|silent   giọng đọc (mặc định vieneu nếu đã cài, không thì silent để dựng nháp)
  --python <đường dẫn>    Python có cài vieneu (hoặc đặt CINEMA_PYTHON); VIENEU_URL để dùng máy chủ VieNeu
  --engine 3d             dựng cảnh bằng Blender/Cycles (ánh sáng vật lý); CINEMA_STUDIO_PYTHON trỏ Python có bpy
  --shard i/n             chỉ dựng khung 3D của phần i trong n (render farm); chạy lại không --shard để ghép phim`;

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const log = (message: string) => console.log(message);
// CINEMA_VENV: nơi cài VieNeu khi thư mục bộ dựng chỉ đọc (ứng dụng desktop đặt vào thư mục dữ liệu).
const venv = process.env.CINEMA_VENV ? resolve(process.env.CINEMA_VENV) : resolve(import.meta.dirname, ".venv");
const venvPython = join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const studioVenv = process.env.CINEMA_VENV ? `${resolve(process.env.CINEMA_VENV)}3d` : resolve(import.meta.dirname, ".venv3d");
const studioPython = process.env.CINEMA_STUDIO_PYTHON ?? join(studioVenv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
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
  // Phim nằm ở thư mục bất kỳ (workspace của ứng dụng, ngoài repo) vẫn import được "@toonflow/cinema":
  // viết lại đường import trong các tệp .ts cùng thư mục phim thành đường dẫn tuyệt đối tới bộ dựng này.
  const entry = pathToFileURL(resolve(import.meta.dirname, "src/index.ts")).href;
  const folder = dirname(path).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  plugin({
    name: "cinemaImport",
    setup(build) {
      build.onLoad({ filter: new RegExp(`^${folder}[\\\\/].*\\.ts$`) }, async ({ path: source }) => ({
        contents: (await readFile(source, "utf8")).replace(/(from\s+|import\s*\(\s*)(["'])@toonflow\/cinema\2/g, `$1"${entry}"`),
        loader: "ts",
      }));
    },
  });
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
  if (command === "setup" && has("3d")) {
    // Blender dạng module Python: bản 4.2 LTS chỉ có cho đúng Python 3.11.
    if (!await exists(studioPython)) {
      log(`Tạo môi trường Python 3.11 tại ${studioVenv}…`);
      const created = Bun.spawnSync([process.platform === "win32" ? "py" : "python3.11", ...process.platform === "win32" ? ["-3.11"] : [], "-m", "venv", studioVenv], { stdout: "inherit", stderr: "inherit" });
      if (created.exitCode) throw new Error("Không tạo được môi trường Python 3.11 (bpy 4.2 cần đúng Python 3.11).");
    }
    const installed = Bun.spawnSync([studioPython, "-m", "pip", "install", "bpy==4.2.0"], { stdout: "inherit", stderr: "inherit" });
    if (installed.exitCode) throw new Error("Cài bpy thất bại.");
    const probe = Bun.spawnSync([studioPython, "-c", "import bpy; print(bpy.app.version_string)"], { stdout: "pipe", stderr: "inherit" });
    if (probe.exitCode) throw new Error("Đã cài bpy nhưng không nạp được (trên Linux cần thư viện hệ thống như libxrender1, libxi6, libxkbcommon0, libsm6, libgl1).");
    log(`✅ Xưởng 3D sẵn sàng: Blender ${probe.stdout.toString().trim()}`);
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
  if (command === "matte") {
    const painted = await paintMattes(project.spec, project.directory, log);
    log(painted.length ? `✅ ${painted.join("\n   ")}` : "Mọi bối cảnh ngoài trời đã có phông trời.");
    return;
  }
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
    const engine = flag("engine") === "3d" ? "3d" : "2d";
    if (engine === "3d" && !await exists(studioPython)) throw new Error("Chưa cài xưởng 3D: chạy `bun run cinema setup --3d` hoặc đặt CINEMA_STUDIO_PYTHON.");
    const shard = flag("shard")?.split("/").map(Number);
    if (shard) {
      const [part, parts] = shard as [number, number];
      if (!(parts >= 1 && part >= 1 && part <= parts)) throw new Error("--shard cần dạng i/n với 1 ≤ i ≤ n, ví dụ --shard 3/20");
      await renderShard(project, { ...options, draft: has("draft"), shots, studioPython, shard: [part - 1, parts] });
      log(`✅ Xong phần ${part}/${parts}: khung 3D trong ${join(project.directory, "build", "plates")}`);
      return;
    }
    await mkdir(join(project.directory, "out"), { recursive: true });
    const result = await renderFilm(project, { ...options, draft: has("draft"), shots, engine, studioPython });
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
