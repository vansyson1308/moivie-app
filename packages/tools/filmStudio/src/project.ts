import { z } from "zod";
import type { MediaModel, ToolFiles } from "@toonflow/tools-scaffold/runtime";

export const projectPath = "film/project.json";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, "ID chỉ gồm chữ không dấu, số, _ hoặc -, tối đa 64 ký tự");
export const relativePath = z.string().min(1).max(2048).refine(
  path => !/^[\\/]|[:\u0000-\u001f]/.test(path) && path.split(/[\\/]/).every(part => part && part !== "." && part !== ".."),
  "Đường dẫn phải là đường dẫn tương đối trong thư mục làm việc",
);
const modelRef = z.strictObject({ providerId: z.string().min(1).max(96), modelId: z.string().min(1).max(256) });

// Ngôn ngữ máy quay (rút từ AIMovieStudio: cỡ cảnh, góc máy, chuyển động, ống kính) — câu tiếng Anh để mô hình video hiểu ổn định nhất.
export const shotSizes = {
  establishing: "establishing shot", extremeWide: "extreme wide shot, figures small in frame, environment dominates",
  wide: "wide shot, full scene visible", full: "full shot, head to toe", medium: "medium shot, waist up",
  mediumClose: "medium close-up, chest up", closeUp: "close-up on the face", extremeCloseUp: "extreme close-up on a detail",
  insert: "insert shot of an object", twoShot: "two-shot framing both characters", overShoulder: "over-the-shoulder shot",
  pov: "point-of-view shot",
} as const;
export const cameraAngles = {
  eyeLevel: "eye-level angle", low: "low angle, heroic perspective", high: "high angle looking down",
  overhead: "top-down overhead view", dutch: "dutch angle, tilted horizon", ground: "ground-level angle",
} as const;
export const cameraMovements = {
  static: "locked-off static camera", dollyIn: "slow dolly in toward the subject", dollyOut: "dolly out away from the subject",
  panLeft: "camera pans left", panRight: "camera pans right", tiltUp: "camera tilts up", tiltDown: "camera tilts down",
  truckLeft: "camera trucks left alongside the subject", truckRight: "camera trucks right alongside the subject",
  craneUp: "crane up revealing the scene", craneDown: "crane down toward the subject", orbitLeft: "orbit shot circling left around the subject",
  orbitRight: "orbit shot circling right around the subject", tracking: "tracking shot following the subject",
  handheld: "handheld camera with subtle natural shake", zoomIn: "slow zoom in", zoomOut: "slow zoom out", dollyZoom: "dolly zoom, vertigo effect",
} as const;
const keys = <T extends object>(value: T) => Object.keys(value) as [keyof T & string, ...(keyof T & string)[]];

const cameraSchema = z.strictObject({
  size: z.enum(keys(shotSizes)).default("medium"),
  angle: z.enum(keys(cameraAngles)).default("eyeLevel"),
  movement: z.enum(keys(cameraMovements)).default("static"),
  speed: z.enum(["slow", "normal", "fast"]).default("normal"),
  lens: z.number().int().min(10).max(300).default(35).describe("Tiêu cự mm: 14–18 siêu rộng, 24–28 rộng, 35–50 chuẩn, 85–135 tele"),
});
const audioClip = z.strictObject({ path: relativePath, duration: z.number().nonnegative() });
const lineSchema = z.strictObject({
  speaker: z.string().min(1).max(64).describe("ID nhân vật, hoặc narrator cho lời dẫn"),
  text: z.string().trim().min(1).max(2000).describe("Đúng nguyên văn lời nói tiếng Việt"),
  audio: audioClip.optional(),
});
const takeSchema = z.strictObject({
  path: relativePath, sheet: relativePath.optional(), prompt: z.string(), references: z.array(relativePath),
  createdAt: z.string(), note: z.string().optional(),
});

export const settingsSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  logline: z.string().max(2000).default(""),
  style: z.string().max(2000).default("").describe("Khóa phong cách (style lock) gắn vào mọi prompt, tiếng Anh"),
  negative: z.string().max(2000).default("subtitles, text on screen, watermark, deformed hands, extra fingers, background music"),
  ratio: z.string().regex(/^[1-9]\d{0,3}:[1-9]\d{0,3}$/).default("16:9"),
  resolution: z.string().max(32).optional(),
  takes: z.number().int().min(1).max(6).default(2).describe("Số bản quay mặc định mỗi cảnh"),
  memorySize: z.number().int().min(1).max(30).default(8).describe("Số ảnh tham chiếu tối đa gửi kèm mỗi cảnh"),
  videoModel: modelRef.optional(),
  audioModel: modelRef.optional(),
  narratorVoice: z.string().max(256).optional(),
  generateAudio: z.boolean().default(false).describe("Bật âm thanh gốc của mô hình video (tiếng động, không khí)"),
});
export const chapterSchema = z.strictObject({
  id, title: z.string().trim().min(1).max(200), summary: z.string().max(4000).default(""), script: z.string().max(100000).default(""),
});
export const characterSchema = z.strictObject({
  id, name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2000).describe("Mô tả ngoại hình cố định bằng tiếng Anh, chép nguyên vào mọi prompt"),
  voice: z.string().max(256).optional(), references: z.array(relativePath).max(16).default([]),
});
export const locationSchema = z.strictObject({
  id, name: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(2000),
  references: z.array(relativePath).max(16).default([]),
});
export const shotInputSchema = z.strictObject({
  id, chapterId: id, locationId: id.optional(), characterIds: z.array(id).max(8).default([]),
  action: z.string().trim().min(1).max(4000).describe("Hành động nhìn thấy được, tiếng Anh, thì hiện tại"),
  camera: cameraSchema.default({ size: "medium", angle: "eyeLevel", movement: "static", speed: "normal", lens: 35 }),
  duration: z.number().min(1).max(120).default(5),
  continuity: z.enum(["cut", "continue"]).default("cut").describe("continue: nối liền từ khung cuối của cảnh trước"),
  mood: z.string().max(200).optional(), timeOfDay: z.string().max(100).optional(),
  dialogue: z.array(lineSchema.omit({ audio: true })).max(20).default([]),
});
const shotSchema = shotInputSchema.extend({
  dialogue: z.array(lineSchema).max(20).default([]),
  takes: z.array(takeSchema).default([]),
  selectedTake: z.number().int().positive().optional(),
  keyframes: z.array(relativePath).default([]),
});
const memorySchema = z.strictObject({
  path: relativePath, shotId: id, characterIds: z.array(id), locationId: id.optional(), hash: z.string().regex(/^[0-9a-f]{16}$/),
});
export const projectSchema = z.strictObject({
  toonflowFilm: z.literal(1),
  settings: settingsSchema,
  chapters: z.array(chapterSchema).default([]),
  characters: z.array(characterSchema).default([]),
  locations: z.array(locationSchema).default([]),
  shots: z.array(shotSchema).default([]),
  memory: z.array(memorySchema).default([]),
  output: z.strictObject({ video: relativePath, subtitles: relativePath.optional(), createdAt: z.string() }).optional(),
}).superRefine((project, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  for (const list of ["chapters", "characters", "locations", "shots"] as const) {
    const ids = project[list].map(item => item.id);
    if (new Set(ids).size !== ids.length) issue(`${list} có ID trùng lặp`);
  }
  const chapters = new Set(project.chapters.map(item => item.id));
  const characters = new Set(project.characters.map(item => item.id));
  const locations = new Set(project.locations.map(item => item.id));
  for (const shot of project.shots) {
    if (!chapters.has(shot.chapterId)) issue(`Cảnh ${shot.id}: chưa có chương ${shot.chapterId}`);
    if (shot.locationId && !locations.has(shot.locationId)) issue(`Cảnh ${shot.id}: chưa có bối cảnh ${shot.locationId}`);
    for (const character of shot.characterIds) if (!characters.has(character)) issue(`Cảnh ${shot.id}: chưa có nhân vật ${character}`);
    for (const line of shot.dialogue) if (line.speaker !== "narrator" && !characters.has(line.speaker)) issue(`Cảnh ${shot.id}: người nói ${line.speaker} chưa có hồ sơ`);
    if (shot.selectedTake && shot.selectedTake > shot.takes.length) issue(`Cảnh ${shot.id}: bản quay đã chọn không tồn tại`);
  }
});
export type Project = z.infer<typeof projectSchema>;
export type Shot = Project["shots"][number];

export async function readProject(files: ToolFiles) {
  const content = await files.readFile(projectPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw new Error("Chưa có dự án phim. Hãy gọi filmPlan với settings.title để khởi tạo film/project.json");
    throw error;
  });
  return projectSchema.parse(JSON.parse(content.toString("utf8")));
}

let queue = Promise.resolve();
// ACT: hàng đợi trong tiến trình để các bước đọc–sửa–ghi không ghi đè nhau; không hỗ trợ nhiều tiến trình cùng sửa một dự án.
export function updateProject(files: ToolFiles, change: (project: Project) => void, create?: Project) {
  const task = queue.then(async () => {
    const project = create ?? await readProject(files);
    change(project);
    const checked = projectSchema.parse(project);
    await files.mkdir("film", true);
    await files.writeFile(projectPath, `${JSON.stringify(checked, null, 2)}\n`, !!create);
    return checked;
  });
  queue = task.then(() => undefined, () => undefined);
  return task;
}

// Ước lượng thời lượng thoại tiếng Việt: khoảng 230 âm tiết/phút (theo hướng dẫn srt-whiteboard-animation) + 1 giây thở.
export function speechSeconds(shot: Pick<Shot, "dialogue">) {
  const syllables = shot.dialogue.reduce((total, line) => total + line.text.split(/\s+/).filter(Boolean).length, 0);
  return syllables ? syllables / 230 * 60 + 1 : 0;
}

export function status(project: Project) {
  const shots = project.shots;
  const lines = shots.flatMap(shot => shot.dialogue);
  const warnings: string[] = [];
  for (const character of project.characters) {
    if (!character.references.length) warnings.push(`Nhân vật ${character.id} chưa có ảnh hồ sơ — nên tạo ảnh tham chiếu trước khi quay để giữ nhất quán`);
  }
  for (const shot of shots) {
    const speech = speechSeconds(shot);
    if (speech > shot.duration) warnings.push(`Cảnh ${shot.id}: thoại cần khoảng ${speech.toFixed(1)}s nhưng cảnh chỉ ${shot.duration}s`);
  }
  const unshot = shots.filter(shot => !shot.selectedTake);
  const unvoiced = shots.filter(shot => shot.dialogue.some(line => !line.audio));
  const next = !project.chapters.length ? "Bước 1 · Kịch bản: viết các chương rồi lưu bằng filmPlan chapters"
    : !project.characters.length && !project.locations.length ? "Bước 2 · Hồ sơ: lập hồ sơ nhân vật/bối cảnh (filmPlan characters, locations) và tạo ảnh tham chiếu"
    : !shots.length ? "Bước 3 · Danh sách cảnh: chia từng chương thành cảnh quay (filmPlan shots)"
    : unshot.length ? `Bước 4 · Quay và duyệt: ${unshot.length} cảnh chưa chọn bản quay, tiếp theo là ${unshot[0]!.id} (filmShoot rồi filmPick)`
    : unvoiced.length ? `Bước 5 · Âm thanh: ${unvoiced.length} cảnh còn thoại chưa thu (filmVoice)`
    : !project.output ? "Bước 6 · Ghép phim: gọi filmAssemble"
    : `Đã xuất phim: ${project.output.video}`;
  return {
    title: project.settings.title,
    next,
    chapters: project.chapters.length,
    characters: project.characters.map(item => ({ id: item.id, name: item.name, references: item.references.length, voice: item.voice })),
    locations: project.locations.map(item => ({ id: item.id, name: item.name, references: item.references.length })),
    shots: shots.map(shot => ({
      id: shot.id, chapterId: shot.chapterId, duration: shot.duration, continuity: shot.continuity, takes: shot.takes.length,
      selectedTake: shot.selectedTake, voiced: shot.dialogue.filter(line => line.audio).length + "/" + shot.dialogue.length,
    })),
    progress: { shot: `${shots.length - unshot.length}/${shots.length}`, voice: `${lines.filter(line => line.audio).length}/${lines.length}` },
    memory: project.memory.length,
    models: { video: project.settings.videoModel, audio: project.settings.audioModel },
    warnings,
    output: project.output,
  };
}

export interface Reference { path: string; role: string }

// Bộ nhớ hình ảnh xuyên cảnh (theo StoryMem): khung nối tiếp → ảnh hồ sơ cố định (neo danh tính) → khung khóa liên quan gần nhất.
export function selectReferences(project: Project, shot: Shot, limit: number, continuityFrame?: string) {
  const references: Reference[] = [];
  const add = (path: string, role: string) => {
    if (references.length < limit && !references.some(item => item.path === path)) references.push({ path, role });
  };
  if (continuityFrame) add(continuityFrame, "the last frame of the previous shot (continue directly from it)");
  for (const character of project.characters.filter(item => shot.characterIds.includes(item.id))) {
    if (character.references[0]) add(character.references[0], `identity reference of ${character.name}`);
  }
  const location = project.locations.find(item => item.id === shot.locationId);
  if (location?.references[0]) add(location.references[0], `the location ${location.name}`);
  const order = new Map(project.shots.map((item, index) => [item.id, index]));
  const current = order.get(shot.id) ?? project.shots.length;
  const memory = project.memory
    .map(item => ({
      item,
      score: item.characterIds.filter(character => shot.characterIds.includes(character)).length * 2 + (item.locationId && item.locationId === shot.locationId ? 1 : 0),
      distance: Math.abs(current - (order.get(item.shotId) ?? 0)),
    }))
    .filter(entry => entry.item.shotId !== shot.id && entry.score > 0)
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
  for (const { item } of memory) add(item.path, `an earlier frame of the same story (${item.shotId}) for character and set consistency`);
  for (const character of project.characters.filter(item => shot.characterIds.includes(item.id))) {
    for (const path of character.references.slice(1)) add(path, `another view of ${character.name}`);
  }
  return references;
}

export function shotPrompt(project: Project, shot: Shot, references: Reference[], options: { voiced: boolean; firstFrame?: boolean; segment?: [number, number]; note?: string }) {
  const { settings } = project;
  const location = project.locations.find(item => item.id === shot.locationId);
  const characters = project.characters.filter(item => shot.characterIds.includes(item.id));
  const name = (speaker: string) => speaker === "narrator" ? "Narrator (voice-over, not on screen)" : project.characters.find(item => item.id === speaker)?.name ?? speaker;
  const camera = shot.camera;
  const movement = `${cameraMovements[camera.movement]}${camera.speed === "normal" ? "" : ` at ${camera.speed} speed`}`;
  const lens = camera.lens <= 18 ? "ultra-wide" : camera.lens <= 28 ? "wide-angle" : camera.lens <= 60 ? "normal" : "telephoto";
  // Theo KupkaProd: mỗi prompt tự dựng lại toàn bộ thế giới, chép nguyên mô tả nhân vật, không viết "người đàn ông đó".
  return [
    settings.style && `Style: ${settings.style}.`,
    location && `Location: ${location.name} — ${location.description}.${[shot.timeOfDay, shot.mood].filter(Boolean).map(item => ` ${item}.`).join("")}`,
    !location && [shot.timeOfDay, shot.mood].filter(Boolean).join(", "),
    ...characters.map(character => `${character.name}: ${character.description}.`),
    references.length && `Reference images: ${references.map((item, position) => `image ${position + 1} is ${item.role}`).join("; ")}.`,
    `Camera: ${shotSizes[camera.size]}, ${cameraAngles[camera.angle]}, ${movement}, ${camera.lens}mm ${lens} lens.`,
    options.firstFrame && "Continuity: begin exactly on the provided first frame and continue the motion naturally, no cut.",
    options.segment && options.segment[0] > 1 && `Segment ${options.segment[0]} of ${options.segment[1]}: continue the same action seamlessly from the previous segment, no cut.`,
    `Action: ${shot.action}`,
    ...shot.dialogue.map(line => `${name(line.speaker)} says in Vietnamese: "${line.text}"${options.voiced && line.speaker !== "narrator" ? " (lip-sync to the provided audio)" : ""}`),
    options.note && `Director's note: ${options.note}`,
    settings.negative && `Avoid: ${settings.negative}.`,
  ].filter(Boolean).join("\n");
}

export interface Capabilities {
  model: MediaModel;
  frameMode?: "startFrameOptional" | "singleImage";
  referenceMode?: string[];
  imageLimit: number;
  audioLimit: number;
  durations: number[];
}

// Cổng năng lực mô hình (theo AIMovieStudio): chọn chế độ, số tham chiếu và thời lượng theo đúng khai báo của mô hình.
export function capabilities(model: MediaModel): Capabilities {
  const modes = Array.isArray(model.mode) ? model.mode as (string | string[])[] : [];
  const referenceMode = modes.find((mode): mode is string[] => Array.isArray(mode));
  const limit = (type: string) => Number(referenceMode?.find(item => item.startsWith(`${type}Reference:`))?.split(":")[1] ?? 0);
  const frameMode = modes.includes("startFrameOptional") ? "startFrameOptional" : modes.includes("singleImage") ? "singleImage" : undefined;
  const durations = [...new Set((model.durationResolutionMap ?? []).flatMap(item => item.duration))].sort((a, b) => a - b);
  return { model, frameMode, referenceMode, imageLimit: limit("image"), audioLimit: limit("audio"), durations };
}

// Chia cảnh dài thành nhiều đoạn nối tiếp (theo LongCat-Video): mỗi đoạn bắt đầu từ khung cuối của đoạn trước.
export function planSegments(required: number, durations: number[]) {
  if (!durations.length) return { count: 1, duration: Math.ceil(required) };
  const max = durations.at(-1)!;
  const count = Math.max(1, Math.ceil(required / max - 1e-9));
  const each = required / count;
  return { count, duration: durations.find(item => item >= each - 1e-9) ?? max };
}
