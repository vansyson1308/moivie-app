import { createCanvas, Path2D } from "@napi-rs/canvas";
import { access, mkdir, readdir, readFile, writeFile } from "@toonflow/file";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { brows, lids, smiles, visemeShapes } from "./character";
import type { FilmSpec } from "./film";
import { createRenderer, type Renderer, type Stage } from "./frame";
import { drawElement, elementDepth, lightingFor, palettes, type SetSpec } from "./set";
import { transitionLength, type CompiledShot, type Timeline } from "./timeline";

/** Một khung cần bộ dựng 3D vẽ: thời điểm và góc máy (góc máy trước khi đang hòa hình sang góc máy mới). */
export interface FrameRequest { time: number; shot: CompiledShot; file: string }
/** Phông vẽ (matte card): phần tử bối cảnh chưa có mô hình 3D, vẽ bằng bộ máy 2D rồi dựng thành tấm phẳng đúng độ sâu. */
export interface Card { index: number; file: string; box: [number, number, number, number]; depth: number; id?: string }

/** Phần tử bối cảnh xưởng 3D dựng bằng hình khối thật; các loại khác thành phông vẽ. */
export const nativeElements = new Set(["house", "tree", "lantern", "hills", "mountains", "bamboo", "grass"]);

const studio = resolve(import.meta.dirname, "../studio");
// Mã xưởng 3D là một phần khoá đệm của bản 3D: sửa mô hình, vật liệu hay ánh sáng thì dựng lại.
const studioSources = (await readdir(studio)).filter(name => name.endsWith(".py")).sort();
export const studioVersion = createHash("sha256").update((await Promise.all(studioSources.map(name => readFile(join(studio, name), "utf8")))).join("\n")).digest("hex").slice(0, 12);

const exists = (path: string) => access(path).then(() => true, () => false);

/**
 * Vẽ phông cho các phần tử không có mô hình 3D. Toạ độ khung vẽ là toạ độ bối cảnh (gốc ở mặt đất, y xuống),
 * cắt sát vùng có hình; phủ sương theo độ xa giống bản 2D. Phông giống nhau dùng lại qua khoá băm.
 */
async function cardsFor(set: SetSpec, directory: string): Promise<Card[]> {
  const width = set.width ?? 1920;
  const time = set.time ?? "morning";
  const palette = palettes[time];
  const margin = 600;
  const top = 1400;
  const scale = 1.5;
  const paths = new Map<string, Path2D>();
  const path2d = (data: string) => paths.get(data) ?? paths.set(data, new Path2D(data)).get(data)!;
  const cards: Card[] = [];
  for (const [index, element] of (set.elements ?? []).entries()) {
    if (nativeElements.has(element.type)) continue;
    const depth = elementDepth(element);
    const placed = { ...element, x: element.x ?? width / 2 };
    const key = createHash("sha256").update(JSON.stringify({ placed, time, width, depth })).digest("hex").slice(0, 16);
    const file = join(directory, `${key}.png`);
    const meta = join(directory, `${key}.json`);
    if (await exists(meta)) {
      cards.push({ ...JSON.parse(await readFile(meta, "utf8")) as Card, index, file, id: element.id });
      continue;
    }
    const canvas = createCanvas(Math.ceil((width + margin * 2) * scale), Math.ceil((top + 300) * scale));
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.translate(margin, top);
    const context = (pass: "back" | "front") => ({ t: 0, palette, time, pass, lights: [], width });
    drawElement(ctx, placed, context("back"), path2d);
    drawElement(ctx, placed, context("front"), path2d);
    if (depth < 1 && !set.interior) {
      ctx.resetTransform();
      ctx.globalCompositeOperation = "source-atop";
      ctx.globalAlpha = (1 - depth) * 0.5;
      ctx.fillStyle = palette.haze;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let [x0, y0, x1, y1] = [canvas.width, canvas.height, -1, -1];
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]! < 4) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) continue;
    const crop = createCanvas(x1 - x0 + 1, y1 - y0 + 1);
    crop.getContext("2d").drawImage(canvas, -x0, -y0);
    const card: Card = { index, file, depth, box: [x0 / scale - margin, y0 / scale - top, (x1 + 1) / scale - margin, (y1 + 1) / scale - top], id: element.id };
    await writeFile(file, await crop.encode("png"));
    await writeFile(meta, JSON.stringify(card));
    cards.push(card);
  }
  return cards;
}

/**
 * Bản "take" gửi sang Blender: hồ sơ diễn viên, bối cảnh, ánh sáng theo giờ, phông vẽ và trạng thái sân khấu từng khung.
 * Mọi tính toán diễn xuất (khung xương, khẩu hình, máy quay) vẫn ở bộ máy TypeScript; Blender chỉ dựng hình,
 * nên bản nháp 2D và bản 3D luôn diễn y hệt nhau.
 */
export async function takeFor(spec: FilmSpec, timeline: Timeline, renderer: Renderer, requests: FrameRequest[], size: [number, number], quality: "draft" | "final", cardDirectory: string, matteDirectory?: string) {
  const frames = requests.map(request => ({ ...renderer.stage(request.time, request.shot)!, file: request.file, shotIndex: request.shot.index }));
  await mkdir(cardDirectory, { recursive: true });
  const sets: Record<string, unknown> = {};
  for (const id of new Set(frames.map(frame => frame.setId))) {
    const set = spec.sets[id]!;
    // Phông trời vẽ sẵn (bun run cinema matte): có thì máy quay nhìn thấy tranh, ánh sáng bầu trời vẫn theo bảng màu.
    const matte = matteDirectory && join(matteDirectory, `${id}.jpg`);
    sets[id] = { ...set, lighting: lightingFor(set), palette: palettes[set.time ?? "morning"], cards: await cardsFor(set, cardDirectory), matte: matte && await exists(matte) ? matte : undefined };
  }
  const cast = new Set(frames.flatMap(frame => frame.actors.map(actor => actor.id)));
  return {
    size, quality, fps: 24,
    // Bảng biểu cảm dùng chung với bộ vẽ 2D: chân mày, mí mắt, khoé miệng, khẩu hình.
    faces: { brows, lids, smiles, visemes: visemeShapes },
    characters: Object.fromEntries([...cast].map(id => [id, timeline.characters[id]])),
    props: spec.props,
    sets,
    frames: frames as (Stage & { file: string; shotIndex: number })[],
  };
}

/** Các khung một đoạn cần từ Blender: khung của góc máy (tệp `n.jpg`) và, trong đoạn hòa hình, khung của góc máy trước (`np.jpg`). */
export function plateRequests(timeline: Timeline, shotIndex: number, start: number, frames: number, fps: number): FrameRequest[] {
  const shot = timeline.shots[shotIndex]!;
  const previous = timeline.shots[shotIndex - 1];
  const kind = shot.spec?.transition;
  const length = transitionLength(shot);
  const blends = previous && !previous.card && length && (kind === "dissolve" || kind === "wipe" || kind === "iris");
  const requests: FrameRequest[] = [];
  if (shot.card) return requests;
  for (let frame = 0; frame < frames; frame++) {
    const time = start + frame / fps + 0.0001;
    requests.push({ time, shot, file: `${frame}.jpg` });
    if (blends && time - shot.start < length) requests.push({ time, shot: previous, file: `${frame}p.jpg` });
  }
  return requests;
}

/**
 * Dựng khung 3D của một đoạn bằng Blender (Cycles, chạy trên CPU) vào thư mục riêng; có tệp done.json là xong.
 * python: Python 3.11 có module bpy (`bun run cinema setup --3d`).
 */
export async function renderPlates(spec: FilmSpec, timeline: Timeline, segment: { shot: number; start: number; frames: number }, directory: string, options: { size: [number, number]; fps: number; draft?: boolean; python: string; cardDirectory: string; matteDirectory?: string; log: (message: string) => void }) {
  const done = join(directory, "done.json");
  if (await exists(done)) return;
  const requests = plateRequests(timeline, segment.shot, segment.start, segment.frames, options.fps);
  await mkdir(directory, { recursive: true });
  if (requests.length) {
    // ACT: bộ dựng 2D chỉ để hỏi trạng thái sân khấu, khung vẽ nhỏ; tỉ lệ khung giữ đúng vì máy quay bố cục theo tỉ lệ.
    const [width, height] = options.size;
    const renderer = createRenderer(spec, timeline, Math.round(width / 4), Math.round(height / 4));
    const take = await takeFor(spec, timeline, renderer, requests, options.size, options.draft ? "draft" : "final", options.cardDirectory, options.matteDirectory);
    const takeFile = join(directory, "take.json");
    await writeFile(takeFile, JSON.stringify(take));
    const process = Bun.spawn([options.python, join(studio, "main.py"), takeFile, directory], { stdout: "pipe", stderr: "pipe" });
    const errors = new Response(process.stderr).text();
    let rendered = 0;
    const decoder = new TextDecoder();
    for await (const chunk of process.stdout) {
      for (const line of decoder.decode(chunk).split("\n")) {
        if (!line.startsWith("{\"rendered\"")) continue;
        rendered++;
        if (rendered % 24 === 0 || rendered === requests.length) options.log(`    🧊 ${rendered}/${requests.length} khung 3D`);
      }
    }
    const code = await process.exited;
    if (code) throw new Error(`Xưởng 3D lỗi (mã ${code}): ${(await errors).slice(-1500)}`);
  }
  await writeFile(done, JSON.stringify({ frames: requests.length, studioVersion }));
}
