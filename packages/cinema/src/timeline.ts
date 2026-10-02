import { createCharacter, type Character } from "./character";
import type { Mood } from "./audio";
import type { FilmSpec, Placement, ShotSpec } from "./film";
import { actionDuration, actionEnd, hashSeed, visemesFor, type CharacterState, type Speech, type TimedAction } from "./motion";
import { spokenText, envelopeRate, type VoiceRequest, type VoiceResult } from "./voice";
import type { SetSpec } from "./set";

export interface Line { start: number; duration: number; text: string; speaker: string; voice: number }
export interface ElementMove { id: string; start: number; duration: number; from: number; to: number }
export interface CompiledScene {
  index: number; setId: string; set: SetSpec; start: number; duration: number; music: Mood;
  initial: Record<string, CharacterState>; actions: Record<string, TimedAction[]>; speech: Record<string, Speech[]>;
  moves: ElementMove[]; lines: Line[];
}
export interface CompiledShot { index: number; start: number; duration: number; scene?: number; spec?: ShotSpec; card?: { title: string; subtitle?: string; credits?: string[] }; label: string }
export interface Timeline { duration: number; shots: CompiledShot[]; scenes: CompiledScene[]; lines: Line[]; characters: Record<string, Character>; cards: { start: number; duration: number; music: Mood }[] }

const lineLead = 0.15;
const lineTail = 0.35;
const sceneHead = 0.3;
const sceneTail = 0.5;

/** Mọi câu cần đọc, theo đúng thứ tự xuất hiện. */
export function collectLines(spec: FilmSpec): VoiceRequest[] {
  const requests: VoiceRequest[] = [];
  for (const item of spec.sequence) {
    if (item.kind !== "scene") continue;
    for (const beat of item.beats) {
      if (beat.kind === "say") requests.push({ text: beat.text, voice: spec.characters[beat.who]?.voice });
      if (beat.kind === "narrate") requests.push({ text: beat.text, voice: spec.options.narrator });
    }
  }
  return requests;
}

export function validate(spec: FilmSpec) {
  const problems: string[] = [];
  for (const [index, item] of spec.sequence.entries()) {
    if (item.kind !== "scene") continue;
    const where = `Cảnh ${index + 1} (${item.set})`;
    if (!spec.sets[item.set]) problems.push(`${where}: chưa khai báo bối cảnh "${item.set}" bằng film.set()`);
    const ids = new Set((spec.sets[item.set]?.elements ?? []).map(element => element.id).filter(Boolean));
    for (const [id, placement] of Object.entries(item.cast)) {
      if (!spec.characters[id]) problems.push(`${where}: nhân vật "${id}" chưa có trong film.cast()`);
      if (placement.ride && !ids.has(placement.ride)) problems.push(`${where}: "${id}" đứng trên "${placement.ride}" nhưng bối cảnh không có vật thể id đó`);
      if (placement.hold && !spec.props[placement.hold] && !builtInProps.has(placement.hold)) problems.push(`${where}: đạo cụ "${placement.hold}" chưa được khai báo`);
    }
    for (const beat of item.beats) {
      const who = "who" in beat ? beat.who : undefined;
      if (who && !item.cast[who]) problems.push(`${where}: "${who}" không có mặt trong cảnh (thêm vào danh sách cast của scene)`);
      if (beat.kind === "shot") for (const id of beat.spec.on) if (!item.cast[id]) problems.push(`${where}: máy quay nhắm vào "${id}" nhưng nhân vật không có mặt`);
      if (beat.kind === "move" && !ids.has(beat.id)) problems.push(`${where}: không có vật thể id "${beat.id}" để di chuyển`);
      if (beat.kind === "act" && beat.params.prop && !spec.props[beat.params.prop] && !builtInProps.has(beat.params.prop)) problems.push(`${where}: đạo cụ "${beat.params.prop}" chưa được khai báo`);
      if (beat.kind === "act" && beat.params.at && !["left", "right"].includes(beat.params.at) && !item.cast[beat.params.at]) problems.push(`${where}: "${beat.params.at}" không có mặt trong cảnh`);
    }
  }
  return problems;
}

export const builtInProps = new Set(["oar", "letter", "flower", "lantern", "bag", "book", "cup", "stick", "umbrella", "phone", "bowl", "fan", "basket"]);

function initialState(placement: Placement): CharacterState {
  return {
    x: placement.x, facing: placement.facing === "left" ? -1 : 1, posture: placement.posture ?? "stand",
    hold: placement.hold ? { front: placement.hold } : {}, expression: placement.expression ?? "neutral", lookAt: placement.lookAt, ride: placement.ride,
  };
}

/** Biên dịch kịch bản thành dòng thời gian tuyệt đối: lịch nhịp, góc máy, diễn xuất, lời thoại. */
export function compile(spec: FilmSpec, voices: VoiceResult[]): Timeline {
  const characters = Object.fromEntries(Object.entries(spec.characters).map(([id, character]) => [id, createCharacter(id, character)]));
  const shots: CompiledShot[] = [];
  const scenes: CompiledScene[] = [];
  const lines: Line[] = [];
  const cards: Timeline["cards"] = [];
  let clock = 0;
  let voiceIndex = 0;
  const defaultMood = spec.options.music ?? "calm";

  for (const item of spec.sequence) {
    if (item.kind === "card") {
      shots.push({ index: shots.length, start: clock, duration: item.seconds, card: { title: item.title, subtitle: item.subtitle }, label: `Thẻ: ${item.title}` });
      cards.push({ start: clock, duration: item.seconds, music: item.music ?? defaultMood });
      clock += item.seconds;
      shots.at(-1)!.duration = Math.round(item.seconds * 24) / 24;
      continue;
    }
    const scene: CompiledScene = {
      index: scenes.length, setId: item.set, set: spec.sets[item.set]!, start: clock, duration: 0, music: item.music ?? defaultMood,
      initial: {}, actions: {}, speech: {}, moves: [], lines: [],
    };
    const states: Record<string, CharacterState> = {};
    for (const [id, placement] of Object.entries(item.cast)) {
      states[id] = initialState(placement);
      scene.initial[id] = initialState(placement);
      scene.actions[id] = [];
      scene.speech[id] = [];
    }
    const elementX = Object.fromEntries((scene.set.elements ?? []).filter(element => element.id).map(element => [element.id!, element.x ?? 0]));
    const sceneShots: CompiledShot[] = [];
    let local = sceneHead;
    let previousStart = sceneHead;
    let current: ShotSpec = { size: "wide", on: [] };
    let shotStart = 0;
    let autoLast = "";
    const openShot = (shot: ShotSpec, start: number) => {
      const last = sceneShots.at(-1);
      if (last) last.duration = start - last.start;
      sceneShots.push({ index: 0, start, duration: 0, scene: scene.index, spec: shot, label: "" });
    };
    const closeShot = () => {
      const minimum = shotStart + (current.duration ?? 0);
      if (local < minimum) local = minimum;
      if (sceneShots.length && local - (sceneShots.at(-1)!.start) < 0.05) local += 2.5;
    };
    // Máy tự chia cảnh: thoại → cận người nói (chừa khoảng nhìn về người nghe), lời dẫn → toàn, đi lại → toàn thân bám theo.
    const auto = (beat: { kind: string; who?: string; action?: string }, start: number) => {
      if (current.size !== "auto" || (beat.kind === "act" && beat.action !== "walk" && beat.action !== "run")) return;
      const others = Object.keys(states).filter(id => id !== beat.who);
      const partner = beat.who ? others.sort((a, b) => Math.abs(states[a]!.x - states[beat.who!]!.x) - Math.abs(states[b]!.x - states[beat.who!]!.x))[0] : undefined;
      const shot: ShotSpec = beat.kind === "say" && beat.who
        ? { ...current, size: autoLast.startsWith("say") || !partner ? "closeUp" : "overShoulder", on: partner ? [beat.who, partner] : [beat.who] }
        : beat.kind === "act" && beat.who
          ? { ...current, size: "full", on: [beat.who], move: "follow" }
          : { ...current, size: Object.keys(states).length > 1 ? "twoShot" : "wide", on: Object.keys(states) };
      const signature = `${beat.kind}:${shot.size}:${shot.on.join(",")}`;
      if (signature === autoLast) return;
      autoLast = signature;
      openShot(shot, start);
    };

    for (const beat of item.beats) {
      if (beat.kind === "shot") {
        closeShot();
        current = beat.spec;
        shotStart = local;
        autoLast = "";
        if (beat.spec.size !== "auto") openShot(beat.spec, local);
        continue;
      }
      if (beat.kind === "wait") {
        local += beat.seconds;
        continue;
      }
      const start = beat.with ? previousStart + (beat.delay ?? 0) : local + (beat.delay ?? 0);
      if (!sceneShots.length && current.size !== "auto") openShot(current, sceneHead);
      if (!beat.with) auto({ kind: beat.kind, who: "who" in beat ? beat.who : undefined, action: beat.kind === "act" ? beat.action : undefined }, start);
      let end = start;
      if (beat.kind === "say" || beat.kind === "narrate") {
        const voice = voices[voiceIndex]!;
        const line: Line = { start: start + lineLead, duration: voice.duration, text: spokenText(beat.text), speaker: beat.kind === "say" ? beat.who : "narrator", voice: voiceIndex++ };
        scene.lines.push(line);
        if (beat.kind === "say") {
          scene.speech[beat.who]!.push({
            start: line.start, duration: line.duration, envelope: voice.envelope, envelopeRate,
            visemes: visemesFor(line.text), expression: beat.emotion, seed: hashSeed(beat.text),
          });
        }
        end = start + lineLead + voice.duration + lineTail;
      } else if (beat.kind === "act") {
        const character = characters[beat.who]!;
        const from = states[beat.who]!;
        const positions = Object.fromEntries(Object.entries(states).map(([id, state]) => [id, state.x]));
        const duration = actionDuration(character, beat.action, from, beat.params);
        const to = actionEnd(from, beat.action, beat.params, positions);
        scene.actions[beat.who]!.push({ name: beat.action, start, duration, params: beat.params, from, to });
        states[beat.who] = to;
        if (beat.action === "give" && beat.params.at && states[beat.params.at] && beat.params.prop) {
          const receiver = states[beat.params.at]!;
          const received: CharacterState = { ...receiver, facing: to.x > receiver.x ? 1 : -1, hold: { ...receiver.hold, front: beat.params.prop } };
          scene.actions[beat.params.at]!.push({ name: "receive", start: start + duration * 0.35, duration: duration * 0.65, params: { at: beat.who }, from: receiver, to: received });
          states[beat.params.at] = received;
        }
        end = start + duration;
      } else if (beat.kind === "move") {
        scene.moves.push({ id: beat.id, start, duration: beat.duration, from: elementX[beat.id] ?? 0, to: beat.to });
        elementX[beat.id] = beat.to;
        end = start + beat.duration;
      }
      previousStart = start;
      local = Math.max(local, end);
    }
    closeShot();
    if (!sceneShots.length) openShot(current.size === "auto" ? { ...current, size: "wide" } : current, sceneHead);
    // Mốc cắt nằm đúng lưới khung hình 1/24 giây: mỗi góc máy có số khung nguyên và dựng lại được độc lập.
    const grid = (value: number) => Math.round(value * 24) / 24;
    scene.duration = Math.ceil((local + sceneTail) * 24) / 24;
    for (const shot of sceneShots) shot.start = grid(shot.start);
    // Góc máy đầu phủ cả phần mở cảnh; thời lượng mỗi góc máy tính lại từ mốc bắt đầu để các góc máy nối liền, không hở.
    sceneShots[0]!.start = 0;
    sceneShots.forEach((shot, index) => { shot.duration = (sceneShots[index + 1]?.start ?? scene.duration) - shot.start; });
    for (const shot of sceneShots) {
      shot.index = shots.length;
      shot.start += clock;
      shot.label = `${String(shots.length + 1).padStart(3, "0")} · ${item.set} · ${shot.spec!.size}${shot.spec!.on.length ? ` ${shot.spec!.on.join("/")}` : ""}`;
      shots.push(shot);
    }
    for (const line of scene.lines) lines.push({ ...line, start: line.start + clock });
    scenes.push(scene);
    clock += scene.duration;
  }
  if (spec.options.credits !== false) {
    const credits = [
      spec.options.title,
      ...(spec.options.author ? [`Biên kịch & đạo diễn: ${spec.options.author}`] : []),
      "",
      "Diễn viên",
      ...Object.values(characters).map(character => `${character.name}${character.voice ? ` — giọng ${character.voice}` : ""}`),
      ...(spec.options.narrator ? [`Lời dẫn — giọng ${spec.options.narrator}`] : []),
      "",
      "Lồng tiếng: VieNeu-TTS · Nhạc: tự sinh",
      "Dựng hoàn toàn trên máy bằng Toonflow Cinema",
    ];
    const seconds = Math.round(Math.max(6, credits.length * 0.75) * 24) / 24;
    shots.push({ index: shots.length, start: clock, duration: seconds, card: { title: "", credits }, label: "Danh đề" });
    cards.push({ start: clock, duration: seconds, music: defaultMood });
    clock += seconds;
  }
  return { duration: clock, shots, scenes, lines, characters, cards };
}

/** Trạng thái nhân vật tại thời điểm t trong cảnh (đã áp mọi động tác kết thúc trước t). */
export function stateAt(scene: CompiledScene, id: string, t: number) {
  let state = scene.initial[id]!;
  for (const action of scene.actions[id]!) if (t >= action.start + action.duration) state = action.to;
  return state;
}

export function elementOffset(scene: CompiledScene, id: string, t: number) {
  let offset = 0;
  for (const move of scene.moves) {
    if (move.id !== id || t < move.start) continue;
    const p = Math.min(1, (t - move.start) / move.duration);
    const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    offset = move.from + (move.to - move.from) * eased - ((scene.set.elements ?? []).find(element => element.id === id)?.x ?? 0);
  }
  return offset;
}
