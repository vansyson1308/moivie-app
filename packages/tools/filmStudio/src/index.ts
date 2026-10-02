import { z } from "zod";
import type { MediaGenerationRequest, MediaReference, ToolContext, ToolDefinition, ToolPlugin } from "@toonflow/tools-scaffold/runtime";
import {
  capabilities, chapterSchema, characterSchema, locationSchema, planSegments, projectSchema, readProject, relativePath, selectReferences,
  settingsSchema, shotInputSchema, shotPrompt, speechSeconds, status, updateProject, type Project,
} from "./project";
import { assemble, contactSheet, frame, frameHash, hashDistance, joinSegments, lastFrame, probe, sliceAudio, voiceTrack } from "./render";

const configSchema = z.strictObject({});
const statusSchema = z.strictObject({});
const planSchema = z.strictObject({
  settings: settingsSchema.partial().optional().describe("Thiết lập phim; lần đầu bắt buộc có title. Chỉ gửi trường cần đổi"),
  chapters: z.array(chapterSchema).max(200).optional().describe("Chương kịch bản, thêm mới hoặc cập nhật theo id"),
  characters: z.array(characterSchema).max(100).optional().describe("Hồ sơ nhân vật, thêm mới hoặc cập nhật theo id"),
  locations: z.array(locationSchema).max(100).optional().describe("Hồ sơ bối cảnh, thêm mới hoặc cập nhật theo id"),
  shots: z.array(shotInputSchema.partial().extend({ id: shotInputSchema.shape.id })).max(500).optional()
    .describe("Danh sách cảnh theo thứ tự phim; cảnh mới cần đủ chapterId và action, cảnh cũ chỉ gửi trường cần đổi"),
  after: z.string().optional().describe("Chèn các cảnh mới ngay sau cảnh có id này; bỏ trống để thêm vào cuối"),
  remove: z.strictObject({
    chapters: z.array(z.string()).optional(), characters: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(), shots: z.array(z.string()).optional(),
  }).optional(),
});
const shootSchema = z.strictObject({
  shotId: z.string().min(1),
  takes: z.number().int().min(1).max(6).optional().describe("Số bản quay lần này; mặc định theo settings.takes"),
  note: z.string().max(2000).optional().describe("Ghi chú đạo diễn cho lần quay lại, ví dụ lý do bản trước bị loại"),
});
const pickSchema = z.strictObject({
  shotId: z.string().min(1),
  take: z.number().int().positive().describe("Số thứ tự bản quay, bắt đầu từ 1"),
  note: z.string().max(2000).optional(),
});
const voiceSchema = z.strictObject({
  shotIds: z.array(z.string()).optional().describe("Chỉ thu các cảnh này; bỏ trống để thu mọi lời thoại còn thiếu"),
  overwrite: z.boolean().default(false).describe("Thu lại cả những câu đã có âm thanh"),
});
const assembleSchema = z.strictObject({
  output: relativePath.refine(path => path.endsWith(".mp4"), "Tệp xuất phải là .mp4").optional(),
  music: relativePath.optional().describe("Nhạc nền trong thư mục làm việc, lặp lại hết phim"),
  musicVolume: z.number().min(0).max(1).default(0.15),
});

type Raw = Record<string, unknown>;
const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], details: value });

function upsert<T extends { id: string }>(list: T[], items: Raw[] | undefined, merge: (current: T | undefined, item: Raw) => T, after?: string) {
  let position = after ? list.findIndex(item => item.id === after) + 1 : list.length;
  if (after && !position) throw new Error(`Không tìm thấy cảnh ${after}`);
  for (const item of items ?? []) {
    const index = list.findIndex(current => current.id === item.id);
    if (index >= 0) list[index] = merge(list[index], item);
    else list.splice(position++, 0, merge(undefined, item));
  }
}

function plan(project: Project, params: Raw) {
  const remove = (params.remove ?? {}) as Record<string, string[] | undefined>;
  const keep = <T extends { id: string }>(list: T[], ids = [] as string[]) => list.filter(item => !ids.includes(item.id));
  project.chapters = keep(project.chapters, remove.chapters);
  project.characters = keep(project.characters, remove.characters);
  project.locations = keep(project.locations, remove.locations);
  project.shots = keep(project.shots, remove.shots);
  if (remove.shots?.length) project.memory = project.memory.filter(item => !remove.shots!.includes(item.shotId));
  const replace = <T>(current: T | undefined, item: Raw) => ({ ...current, ...item }) as T;
  upsert(project.chapters, params.chapters as Raw[], replace);
  upsert(project.characters, params.characters as Raw[], replace);
  upsert(project.locations, params.locations as Raw[], replace);
  upsert(project.shots, params.shots as Raw[], (current, item) => {
    const shot = { ...current, ...item, camera: { ...current?.camera, ...(item.camera as Raw | undefined) } } as Project["shots"][number];
    // Giữ âm thanh đã thu của những câu không đổi lời.
    if (current && item.dialogue) shot.dialogue = shot.dialogue.map(line => ({
      ...line, audio: current.dialogue.find(old => old.speaker === line.speaker && old.text === line.text)?.audio,
    }));
    return shot;
  }, params.after as string | undefined);
  project.output = undefined;
}

async function mimeType(context: ToolContext, path: string): Promise<MediaReference> {
  return { path, mimeType: await context.files.detectImageMimeType(path) ?? "image/jpeg" };
}

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    const { files, media } = context;
    const tools: ToolDefinition[] = [{
      name: "filmStatus",
      label: "Trạng thái dự án phim",
      description: "Đọc film/project.json: tiến độ từng bước, cảnh chưa quay/chưa chọn, thoại chưa thu, cảnh báo nhất quán và bước tiếp theo. Gọi đầu tiên khi tiếp tục dự án.",
      parameters: z.toJSONSchema(statusSchema, { io: "input", target: "draft-07" }),
      async execute() {
        return json(status(await readProject(files)));
      },
    }, {
      name: "filmPlan",
      label: "Lập kế hoạch phim",
      description: "Tạo hoặc cập nhật dự án phim: thiết lập, chương kịch bản, hồ sơ nhân vật/bối cảnh (kèm ảnh tham chiếu), danh sách cảnh. Thêm mới hoặc sửa theo id, xóa qua remove. Mọi tham chiếu chéo được kiểm tra trước khi lưu.",
      parameters: z.toJSONSchema(planSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params) {
        planSchema.parse(params);
        const raw = params as Raw;
        const exists = await files.access("film/project.json").then(() => true, () => false);
        const settings = raw.settings as Raw | undefined;
        const project = exists
          ? await updateProject(files, current => {
            if (settings) current.settings = settingsSchema.parse({ ...current.settings, ...settings });
            plan(current, raw);
          })
          : await updateProject(files, current => plan(current, raw), projectSchema.parse({ toonflowFilm: 1, settings: settingsSchema.parse(settings ?? {}) }));
        return json(status(project));
      },
    }];
    if (!media) return tools;

    tools.push({
      name: "filmShoot",
      label: "Quay cảnh",
      description: "Quay một cảnh thành nhiều bản (take) bằng mô hình video đã chọn trong settings.videoModel. Tự gửi ảnh hồ sơ và bộ nhớ hình ảnh để giữ nhân vật nhất quán, nối khung cuối của cảnh trước khi continuity=continue, gửi dải thoại để khớp khẩu hình nếu mô hình nhận âm thanh, tự chia cảnh dài thành nhiều đoạn nối tiếp. Trả về tờ duyệt 4 khung của mỗi bản.",
      parameters: z.toJSONSchema(shootSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const { shotId, takes, note } = shootSchema.parse(params);
        const project = await readProject(files);
        const { settings } = project;
        if (!settings.videoModel) throw new Error("Chưa chọn mô hình video: gọi listMediaModels rồi lưu filmPlan settings.videoModel");
        const index = project.shots.findIndex(item => item.id === shotId);
        const shot = project.shots[index];
        if (!shot) throw new Error(`Không tìm thấy cảnh ${shotId}`);
        const model = (await media.listModels()).find(item => item.type === "video" && item.providerId === settings.videoModel!.providerId && item.modelId === settings.videoModel!.modelId);
        if (!model) throw new Error("Mô hình video trong settings không còn khả dụng, hãy chọn lại bằng listMediaModels");
        const caps = capabilities(model);
        const directory = `film/takes/${shot.id}`;
        await files.mkdir(`${directory}/parts`, true);

        let continuity: string | undefined;
        if (shot.continuity === "continue" && index > 0) {
          const previous = project.shots[index - 1]!;
          if (!previous.selectedTake) throw new Error(`Cảnh ${shot.id} nối tiếp ${previous.id}: hãy quay và chọn bản cho ${previous.id} trước`);
          continuity = `film/takes/${previous.id}/last.jpg`;
          await lastFrame(context, previous.takes[previous.selectedTake - 1]!.path, continuity, signal);
        }
        // Chỉ gửi dải thoại để khớp khẩu hình khi có nhân vật nói trên hình; lời dẫn được trộn ở bước ghép.
        const lipSync = caps.audioLimit && shot.dialogue.some(line => line.speaker !== "narrator") && shot.dialogue.every(line => line.audio);
        const voice = lipSync ? await voiceTrack(context, shot, signal) : undefined;
        const segments = planSegments(Math.max(shot.duration, voice ? voice.duration + 0.3 : 0), caps.durations);
        const resolution = settings.resolution && model.durationResolutionMap?.some(item => item.resolution.includes(settings.resolution!)) ? settings.resolution : undefined;
        const results = [];
        for (let take = 0; take < (takes ?? settings.takes); take++) {
          const parts: string[] = [];
          let start = continuity;
          let prompt = "";
          let used: string[] = [];
          for (let part = 0; part < segments.count; part++) {
            const references = caps.referenceMode ? selectReferences(project, shot, Math.min(caps.imageLimit, settings.memorySize), start) : [];
            let audio = voice?.path;
            if (audio && segments.count > 1) {
              // Cắt dải thoại theo cửa sổ của từng đoạn, như cách LongCat-Video chia âm thanh cho video dài.
              audio = `${directory}/parts/voice-${take + 1}-${part + 1}.wav`;
              await sliceAudio(context, voice!.path, audio, part * segments.duration, segments.duration, signal);
            }
            const firstFrame = !references.length && !audio && start && caps.frameMode ? start : undefined;
            prompt = shotPrompt(project, shot, references, {
              voiced: !!audio, firstFrame: !!firstFrame, note, segment: segments.count > 1 ? [part + 1, segments.count] : undefined,
            });
            const [video] = await media.generateVideo({
              providerId: model.providerId, modelId: model.modelId, prompt, outputDirectory: segments.count > 1 ? `${directory}/parts` : directory,
              ratio: settings.ratio, resolution, duration: caps.durations.length ? segments.duration : undefined, generateAudio: settings.generateAudio,
              ...(references.length || audio
                ? { mode: caps.referenceMode as MediaGenerationRequest["mode"], images: await Promise.all(references.map(item => mimeType(context, item.path))), audios: audio ? [{ path: audio, mimeType: "audio/wav" }] : undefined }
                : firstFrame && caps.frameMode === "startFrameOptional" ? { mode: "startFrameOptional" as const, firstFrame: await mimeType(context, firstFrame) }
                : firstFrame ? { mode: "singleImage" as const, images: [await mimeType(context, firstFrame)] }
                : { mode: "text" as const }),
            }, signal);
            if (!video) throw new Error("Mô hình không trả về video");
            parts.push(video.path);
            used = references.map(item => item.path);
            if (part < segments.count - 1) {
              start = `${directory}/parts/last-${take + 1}-${part + 1}.jpg`;
              await lastFrame(context, video.path, start, signal);
            }
          }
          const path = parts.length > 1 ? `${directory}/long-${crypto.randomUUID().slice(0, 8)}.mp4` : parts[0]!;
          if (parts.length > 1) await joinSegments(context, parts, path, signal);
          const sheet = path.replace(/\.[^./]+$/, ".jpg");
          await contactSheet(context, path, sheet, signal);
          // Lưu ngay sau mỗi bản quay để dừng giữa chừng vẫn tiếp tục được (như state.json của KupkaProd).
          const saved = await updateProject(files, current => {
            current.shots.find(item => item.id === shot.id)!.takes.push({ path, sheet, prompt, references: used, createdAt: new Date().toISOString(), ...(note ? { note } : {}) });
          });
          results.push({ take: saved.shots.find(item => item.id === shot.id)!.takes.length, path, sheet, segments: parts.length });
        }
        return json({
          shotId, takes: results,
          review: "Xem từng tờ duyệt (sheet) rồi chấm: khớp nội dung, chuyển động, nhất quán nhân vật, đúng cỡ cảnh, liền mạch với cảnh trước. Có mục kém hoặc từ hai mục tạm trở lên thì quay lại với note; đạt thì gọi filmPick.",
        });
      },
    }, {
      name: "filmPick",
      label: "Chọn bản quay",
      description: "Chọn bản quay đạt cho một cảnh, trích tối đa 3 khung khóa mới (bỏ khung gần trùng) vào bộ nhớ hình ảnh để các cảnh sau giữ nhân vật và bối cảnh nhất quán.",
      parameters: z.toJSONSchema(pickSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const { shotId, take, note } = pickSchema.parse(params);
        const project = await readProject(files);
        const shot = project.shots.find(item => item.id === shotId);
        if (!shot) throw new Error(`Không tìm thấy cảnh ${shotId}`);
        const chosen = shot.takes[take - 1];
        if (!chosen) throw new Error(`Cảnh ${shotId} chỉ có ${shot.takes.length} bản quay`);
        await files.mkdir("film/memory", true);
        const { duration } = await probe(context, chosen.path, signal);
        const others = project.memory.filter(item => item.shotId !== shotId);
        const keyframes: { path: string; hash: string }[] = [];
        // Theo StoryMem: tối đa 3 khung khóa mỗi cảnh, chỉ giữ khung mới so với nhau và với bộ nhớ hiện có.
        for (const [index, position] of [0.15, 0.5, 0.85].entries()) {
          const path = `film/memory/${shotId}-k${index + 1}.jpg`;
          await frame(context, chosen.path, path, duration * position, signal);
          const hash = await frameHash(context, path, signal);
          if ([...keyframes, ...others].every(item => hashDistance(item.hash, hash) > 6)) keyframes.push({ path, hash });
          else await files.remove(path).catch(() => {});
        }
        const saved = await updateProject(files, current => {
          const target = current.shots.find(item => item.id === shotId)!;
          target.selectedTake = take;
          target.keyframes = keyframes.map(item => item.path);
          if (note) target.takes[take - 1]!.note = note;
          current.memory = [
            ...current.memory.filter(item => item.shotId !== shotId),
            ...keyframes.map(item => ({ ...item, shotId, characterIds: target.characterIds, ...(target.locationId ? { locationId: target.locationId } : {}) })),
          ];
          current.output = undefined;
        });
        return json({ shotId, take, keyframes: keyframes.map(item => item.path), next: status(saved).next });
      },
    }, {
      name: "filmVoice",
      label: "Thu thoại",
      description: "Đọc lời thoại và lời dẫn tiếng Việt bằng mô hình âm thanh trong settings.audioModel (khuyên dùng VieNeu-TTS), giọng lấy từ hồ sơ nhân vật hoặc settings.narratorVoice. Đo thời lượng, cảnh báo câu đọc bất thường hoặc dài hơn cảnh.",
      parameters: z.toJSONSchema(voiceSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const { shotIds, overwrite } = voiceSchema.parse(params);
        const project = await readProject(files);
        const model = project.settings.audioModel;
        if (!model) throw new Error("Chưa chọn mô hình âm thanh: gọi listMediaModels (ví dụ VieNeu-TTS) rồi lưu filmPlan settings.audioModel");
        const results = [];
        const warnings: string[] = [];
        for (const shot of project.shots.filter(item => !shotIds || shotIds.includes(item.id))) {
          for (const [index, line] of shot.dialogue.entries()) {
            if (line.audio && !overwrite) continue;
            const voice = line.speaker === "narrator" ? project.settings.narratorVoice : project.characters.find(item => item.id === line.speaker)?.voice;
            const [audio] = await media.generateAudio({
              providerId: model.providerId, modelId: model.modelId, prompt: line.text, voice, format: "wav", outputDirectory: `film/audio/${shot.id}`,
            }, signal);
            if (!audio) throw new Error("Mô hình không trả về âm thanh");
            const { duration } = await probe(context, audio.path, signal);
            // Kiểm tra độ hợp lý như srt-whiteboard-animation: khoảng 4,5 âm tiết/giây, lệch quá xa thường là đọc sót hoặc lặp.
            const ratio = duration / (line.text.split(/\s+/).filter(Boolean).length / 4.5);
            if (ratio < 0.55 || ratio > 1.8) warnings.push(`${shot.id} · "${line.text.slice(0, 40)}": thời lượng bất thường (${duration.toFixed(1)}s), nên nghe lại hoặc thu lại`);
            await updateProject(files, current => {
              // Câu có thể đã bị sửa trong lúc thu; chỉ gắn khi vẫn đúng người nói và đúng lời.
              const target = current.shots.find(item => item.id === shot.id)?.dialogue[index];
              if (target?.speaker === line.speaker && target.text === line.text) target.audio = { path: audio.path, duration };
              current.output = undefined;
            });
            results.push({ shotId: shot.id, speaker: line.speaker, path: audio.path, duration });
          }
          const speech = speechSeconds(shot);
          const total = results.filter(item => item.shotId === shot.id).reduce((sum, item) => sum + item.duration, 0);
          if (Math.max(speech, total) > shot.duration) warnings.push(`${shot.id}: thoại dài hơn cảnh ${shot.duration}s — khi ghép sẽ giữ khung cuối, hoặc tăng duration và quay lại`);
        }
        return json({ recorded: results, warnings });
      },
    }, {
      name: "filmAssemble",
      label: "Ghép phim",
      description: "Ghép các bản quay đã chọn theo thứ tự cảnh: chuẩn hóa khung hình và 25 fps, trộn thoại lên âm thanh gốc, giữ khung cuối nếu thoại dài hơn hình, thêm nhạc nền tùy chọn, xuất MP4 kèm phụ đề tiếng Việt (SRT và phụ đề mềm).",
      parameters: z.toJSONSchema(assembleSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal) {
        const { output, music, musicVolume } = assembleSchema.parse(params);
        const project = await readProject(files);
        if (!project.shots.length) throw new Error("Chưa có cảnh nào để ghép");
        const missing = project.shots.filter(shot => !shot.selectedTake).map(shot => shot.id);
        if (missing.length) throw new Error(`Còn cảnh chưa chọn bản quay: ${missing.join(", ")}`);
        const name = project.settings.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "phim";
        const result = await assemble(context, project, { output: output ?? `film/output/${name}.mp4`, music, musicVolume }, signal);
        await updateProject(files, current => {
          current.output = { video: result.video, ...(result.subtitles ? { subtitles: result.subtitles } : {}), createdAt: new Date().toISOString() };
        });
        const silent = project.shots.flatMap(shot => shot.dialogue.filter(line => !line.audio).map(() => shot.id));
        return json({ ...result, warnings: silent.length ? [`Các cảnh còn thoại chưa thu nên không có tiếng: ${[...new Set(silent)].join(", ")}`] : [] });
      },
    });
    return tools;
  },
};

export default plugin;
