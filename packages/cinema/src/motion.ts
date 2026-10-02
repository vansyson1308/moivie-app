import { restPose, type Character, type Expression, type Pose, type Viseme } from "./character";

export type Posture = "stand" | "sit" | "kneel";
export type ActionName =
  | "walk" | "run" | "turn" | "sit" | "kneel" | "stand" | "nod" | "shake" | "bow" | "wave" | "point" | "handToChest"
  | "cry" | "laugh" | "think" | "shrug" | "embrace" | "row" | "give" | "receive" | "pickUp" | "putDown" | "jump" | "look" | "emote";

export interface ActionParams {
  /** walk/run: điểm đến theo trục x của thế giới. */
  to?: number;
  /** point/look/give/turn: id nhân vật hoặc "left"/"right". */
  at?: string;
  /** give/pickUp: tên đạo cụ. */
  prop?: string;
  expression?: Expression;
  duration?: number;
  speed?: number;
}

export interface CharacterState {
  x: number;
  facing: 1 | -1;
  posture: Posture;
  hold: { front?: string; back?: string };
  expression: Expression;
  lookAt?: string;
  ride?: string;
}

export interface TimedAction { name: ActionName; start: number; duration: number; params: ActionParams; from: CharacterState; to: CharacterState }
export interface Speech { start: number; duration: number; envelope: Float32Array; envelopeRate: number; visemes: Viseme[]; expression?: Expression; seed: number }

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x); };
const bell = (t: number) => Math.sin(Math.PI * clamp(t));

export function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string) {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function speed(character: Character, params: ActionParams, run: boolean) {
  const base = character.age === "elder" ? 95 : character.age === "child" ? 150 : 140;
  return (params.speed ?? 1) * base * character.scale * (run ? 2.6 : 1);
}

/** Thời lượng mặc định của từng động tác, tính theo trạng thái lúc bắt đầu. */
export function actionDuration(character: Character, name: ActionName, state: CharacterState, params: ActionParams) {
  if (params.duration) return params.duration;
  if (name === "walk" || name === "run") return Math.max(0.4, Math.abs((params.to ?? state.x) - state.x) / speed(character, params, name === "run"));
  const durations: Partial<Record<ActionName, number>> = {
    turn: 0.35, sit: 0.8, kneel: 0.8, stand: 0.8, nod: 0.8, shake: 1, bow: 1.4, wave: 1.6, point: 1.6, handToChest: 1.8,
    cry: 3, laugh: 2, think: 2.2, shrug: 1.2, embrace: 2.5, row: 3, give: 1.6, pickUp: 1.2, putDown: 1.2, jump: 0.7, look: 0, emote: 0,
  };
  return durations[name] ?? 1;
}

/** Trạng thái sau khi động tác kết thúc. */
export function actionEnd(state: CharacterState, name: ActionName, params: ActionParams, positions: Record<string, number>): CharacterState {
  const next = { ...state, hold: { ...state.hold } };
  const toward = (target?: string) => {
    if (target === "left") return -1;
    if (target === "right") return 1;
    const x = target ? positions[target] : undefined;
    return x === undefined || x === state.x ? state.facing : (x > state.x ? 1 : -1);
  };
  if (name === "walk" || name === "run") {
    if (params.to !== undefined && params.to !== state.x) next.facing = params.to > state.x ? 1 : -1;
    next.x = params.to ?? state.x;
  }
  if (name === "turn") next.facing = params.at ? toward(params.at) : (state.facing === 1 ? -1 : 1);
  if (name === "point" || name === "give") next.facing = toward(params.at);
  if (name === "sit" || name === "kneel" || name === "stand") next.posture = name;
  if (name === "pickUp") next.hold.front = params.prop;
  if (name === "putDown" || name === "give") next.hold.front = undefined;
  if (name === "look") next.lookAt = params.at;
  if (name === "emote" && params.expression) next.expression = params.expression;
  return next;
}

function posturePose(character: Character, posture: Posture, pose: Pose) {
  const { hipY, shin, thigh } = character.body;
  if (posture === "sit") {
    pose.crouch = 1 - (shin + 6) / -hipY;
    pose.legFront = [1.5, -1.5];
    pose.legBack = [1.38, -1.38];
    pose.armFront = [0.55, 0.85];
    pose.armBack = [0.45, 0.8];
    pose.lean = Math.max(pose.lean - 0.05, -0.05);
  } else if (posture === "kneel") {
    pose.crouch = 1 - (thigh + 4) / -hipY;
    pose.legFront = [1.45, -1.45];
    pose.legBack = [0.05, -1.62];
    pose.armFront = [0.35, 0.7];
    pose.lean += 0.06;
  }
}

function mix(a: Pose, b: Pose, t: number): Pose {
  const pair = (x: [number, number], y: [number, number]): [number, number] => [lerp(x[0], y[0], t), lerp(x[1], y[1], t)];
  return {
    ...a, crouch: lerp(a.crouch, b.crouch, t), lean: lerp(a.lean, b.lean, t),
    armFront: pair(a.armFront, b.armFront), armBack: pair(a.armBack, b.armBack), legFront: pair(a.legFront, b.legFront), legBack: pair(a.legBack, b.legBack),
  };
}

function baseFor(character: Character, state: CharacterState) {
  const pose = restPose(character, state.x);
  pose.facing = state.facing;
  pose.expression = state.expression;
  pose.hold = { ...state.hold };
  posturePose(character, state.posture, pose);
  return pose;
}

const expressionPosture: Partial<Record<Expression, (pose: Pose) => void>> = {
  sad: pose => { pose.headTilt += 0.14; pose.armFront[0] -= 0.05; },
  angry: pose => { pose.lean += 0.05; pose.headTilt += 0.05; },
  surprised: pose => { pose.headTilt -= 0.08; pose.armFront = [pose.armFront[0] + 0.3, pose.armFront[1] + 0.5]; },
  scared: pose => { pose.headTilt += 0.06; pose.armFront = [0.6, 1.7]; pose.armBack = [0.5, 1.6]; pose.lean -= 0.04; },
  thinking: pose => { pose.headTilt -= 0.05; },
  tender: pose => { pose.headTilt += 0.06; },
};

export interface PoseContext { t: number; seed: number; positions: Record<string, number>; speaker?: string; id: string }

/** Tư thế của một nhân vật tại thời điểm t: tư thế nền → động tác đang diễn → lời nói → hơi thở, chớp mắt, ánh nhìn. */
export function poseAt(character: Character, state: CharacterState, actions: TimedAction[], speech: Speech[], context: PoseContext) {
  const { t } = context;
  let pose = baseFor(character, state);
  for (const action of actions) {
    if (t < action.start || t > action.start + action.duration || action.duration <= 0) continue;
    const p = (t - action.start) / action.duration;
    const from = baseFor(character, action.from);
    const name = action.name;
    if (name === "walk" || name === "run") {
      const to = action.params.to ?? action.from.x;
      const distance = Math.abs(to - action.from.x);
      const travelled = distance * p;
      pose = from;
      pose.x = lerp(action.from.x, to, p);
      pose.facing = to >= action.from.x ? 1 : -1;
      const stride = name === "run" ? 115 : 75;
      const phase = (travelled / stride) * Math.PI;
      const swing = (name === "run" ? 0.75 : 0.45) * smooth(Math.min(p * 4, (1 - p) * 4, 1));
      pose.legFront = [Math.sin(phase) * swing, -Math.max(0, -Math.cos(phase)) * swing * 1.4];
      pose.legBack = [-Math.sin(phase) * swing, -Math.max(0, Math.cos(phase)) * swing * 1.4];
      pose.armFront = [-Math.sin(phase) * swing * 0.8, name === "run" ? 1.4 : -0.25];
      pose.armBack = [Math.sin(phase) * swing * 0.8, name === "run" ? 1.4 : -0.25];
      pose.bob = -Math.abs(Math.sin(phase)) * (name === "run" ? 9 : 4) * character.scale;
      pose.lean += name === "run" ? 0.18 : 0.03;
    } else if (name === "sit" || name === "kneel" || name === "stand") {
      const target = baseFor(character, { ...action.from, posture: name });
      pose = mix(from, target, smooth(p));
    } else if (name === "turn") {
      pose = from;
      pose.facing = p < 0.5 ? action.from.facing : action.to.facing;
      pose.bob = -bell(p) * 3;
    } else {
      pose = from;
      const e = bell(p);
      const k = smooth(Math.min(p * 5, (1 - p) * 5, 1));
      if (name === "nod") pose.headTilt += Math.sin(p * Math.PI * 4) * 0.12 * k;
      if (name === "shake") { pose.look = [Math.sin(p * Math.PI * 6) * k, 0]; pose.headTilt += Math.sin(p * Math.PI * 6) * 0.04 * k; }
      if (name === "bow") { pose.lean += 0.4 * e; pose.headTilt += 0.18 * e; pose.armFront = [pose.armFront[0] - 0.3 * e, pose.armFront[1] + 1.2 * e]; pose.armBack = [pose.armBack[0] - 0.3 * e, pose.armBack[1] + 1.1 * e]; }
      if (name === "wave") pose.armFront = [lerp(pose.armFront[0], 2.35, k), lerp(pose.armFront[1], -0.15 + Math.sin(p * Math.PI * 8) * 0.45, k)];
      if (name === "point") { pose.armFront = [lerp(pose.armFront[0], 1.5, k), lerp(pose.armFront[1], 0.05, k)]; pose.facing = action.to.facing; }
      if (name === "handToChest") pose.armFront = [lerp(pose.armFront[0], 0.55, k), lerp(pose.armFront[1], 2.05, k)];
      if (name === "cry") {
        pose.armFront = [lerp(pose.armFront[0], 1.15, k), lerp(pose.armFront[1], 2.3, k)];
        pose.headTilt += 0.22 * k;
        pose.expression = "sad";
        pose.tears = k * (0.6 + p * 2);
        pose.bob += Math.sin(t * 9) * 1.2 * k;
      }
      if (name === "laugh") { pose.headTilt -= 0.12 * k + Math.sin(t * 14) * 0.03 * k; pose.expression = "happy"; pose.mouth = 0.5 + Math.abs(Math.sin(t * 12)) * 0.4 * k; pose.viseme = "a"; pose.bob += Math.sin(t * 14) * 1.5 * k; }
      if (name === "think") { pose.armFront = [lerp(pose.armFront[0], 0.6, k), lerp(pose.armFront[1], 2.45, k)]; pose.expression = "thinking"; pose.look = [0.6, -0.8]; }
      if (name === "shrug") { pose.armFront = [0.4, 1.4 * e]; pose.armBack = [0.3, 1.3 * e]; pose.headTilt += 0.1 * e; pose.bob -= 4 * e; }
      if (name === "embrace") { pose.armFront = [lerp(pose.armFront[0], 1.35, k), lerp(pose.armFront[1], 0.75, k)]; pose.armBack = [lerp(pose.armBack[0], 1.25, k), lerp(pose.armBack[1], 0.8, k)]; pose.lean += 0.08 * k; }
      if (name === "row") {
        const stroke = Math.sin(t * 2.6);
        pose.armFront = [1.0 + stroke * 0.45, 0.55 - stroke * 0.2];
        pose.armBack = [0.75 + stroke * 0.45, 0.85 - stroke * 0.2];
        pose.lean += 0.08 + stroke * 0.06;
      }
      if (name === "receive") { pose.armFront = [lerp(pose.armFront[0], 1.25, k), lerp(pose.armFront[1], 0.25, k)]; pose.facing = action.to.facing; pose.hold.front = p > 0.45 ? action.to.hold.front : action.from.hold.front; }
      if (name === "give") { pose.armFront = [lerp(pose.armFront[0], 1.3, k), lerp(pose.armFront[1], 0.15, k)]; pose.facing = action.to.facing; if (p > 0.6) pose.hold.front = undefined; }
      if (name === "pickUp" || name === "putDown") {
        pose.lean += 0.6 * e;
        pose.crouch = Math.max(pose.crouch, 0.18 * e);
        pose.armFront = [lerp(pose.armFront[0], 0.5, e), lerp(pose.armFront[1], 0.1, e)];
        pose.hold.front = (name === "pickUp") === p > 0.5 ? action.params.prop : pose.hold.front;
      }
      if (name === "jump") { pose.bob -= 70 * Math.sin(Math.PI * p) * character.scale; pose.legFront = [0.5 * e, -1 * e]; pose.legBack = [-0.2 * e, -1.1 * e]; pose.armFront = [2.4 * e, 0.3]; }
    }
  }
  expressionPosture[pose.expression]?.(pose);

  // Lời nói: miệng theo năng lượng giọng, nguyên âm theo âm tiết, đầu nhấp nhẹ và cử chỉ tay ở câu dài.
  for (const line of speech) {
    if (t < line.start || t > line.start + line.duration) continue;
    const local = t - line.start;
    const index = Math.min(line.envelope.length - 1, Math.floor(local * line.envelopeRate));
    const level = line.envelope[index] ?? 0;
    pose.mouth = Math.max(pose.mouth, clamp(level * 1.25));
    pose.viseme = line.visemes[Math.floor(local * 4.5) % Math.max(1, line.visemes.length)] ?? "a";
    if (line.expression) pose.expression = line.expression;
    pose.headTilt += Math.sin(local * 5.3) * 0.025 * level - 0.02 * level;
    if (line.duration > 2.4 && state.posture === "stand" && !actions.some(action => t >= action.start && t <= action.start + action.duration)) {
      const choose = random(line.seed)();
      const k = smooth(Math.min((local - 0.4) * 2, (line.duration - local - 0.3) * 2, 1));
      if (k > 0) {
        if (choose < 0.4) pose.armFront = [lerp(pose.armFront[0], 0.75 + level * 0.25, k), lerp(pose.armFront[1], 1.0 + Math.sin(local * 3) * 0.15, k)];
        else if (choose < 0.7) pose.armFront = [lerp(pose.armFront[0], 0.5, k), lerp(pose.armFront[1], 1.9, k)];
        else pose.armBack = [lerp(pose.armBack[0], 0.6, k), lerp(pose.armBack[1], 1.1 + level * 0.2, k)];
      }
    }
  }

  // Sống động khi đứng yên: thở, đung đưa, chớp mắt theo lịch tất định.
  const seed = context.seed;
  pose.breath = Math.sin(t * 1.8 + seed % 7);
  pose.bob += pose.breath * 1.1 * character.scale;
  pose.armFront[0] += Math.sin(t * 1.3 + seed % 5) * 0.02;
  pose.armBack[0] += Math.sin(t * 1.1 + seed % 3) * 0.02;
  const blinkRandom = random(seed + Math.floor(t / 3.2));
  const blinkAt = Math.floor(t / 3.2) * 3.2 + blinkRandom() * 2.8;
  if (t >= blinkAt && t < blinkAt + 0.14) pose.blink = 1 - Math.abs((t - blinkAt) / 0.07 - 1);

  const targetId = state.lookAt ?? (context.speaker !== context.id ? context.speaker : undefined);
  const targetX = targetId ? context.positions[targetId] : undefined;
  if (targetX !== undefined && Math.abs(pose.look[0]) < 0.01) pose.look = [clamp((targetX - pose.x) / 200, -1, 1) * pose.facing, pose.look[1]];
  return pose;
}

const vowels: [RegExp, Viseme][] = [[/[oôơuưóòỏõọốồổỗộớờởỡợúùủũụứừửữự]/i, "o"], [/[eêiyéèẻẽẹếềểễệíìỉĩịýỳỷỹỵ]/i, "e"], [/[aăâáàảãạắằẳẵặấầẩẫậ]/i, "a"]];

/** Khẩu hình theo nguyên âm chính của từng âm tiết tiếng Việt. */
export function visemesFor(text: string): Viseme[] {
  return text.split(/\s+/).filter(Boolean).map(word => {
    if (/^[mbp]/i.test(word) && word.length <= 2) return "m";
    return vowels.find(([pattern]) => pattern.test(word))?.[1] ?? "a";
  });
}
