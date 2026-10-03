import { restPose, type Character, type Expression, type HandShape, type Limb, type Pose } from "./character";
import { visemeAt, type Syllable, type VisemeKey } from "./lipSync";

export type Posture = "stand" | "sit" | "kneel";
export type Facing = "left" | "right" | "front" | "back";
export type ActionName =
  | "walk" | "run" | "turn" | "sit" | "kneel" | "stand" | "nod" | "shake" | "bow" | "wave" | "point" | "handToChest"
  | "cry" | "laugh" | "think" | "shrug" | "embrace" | "row" | "give" | "receive" | "pickUp" | "putDown" | "jump" | "look" | "emote";

export interface ActionParams {
  /** walk/run: điểm đến theo trục x của thế giới. */
  to?: number;
  /** point/look/give/turn: id nhân vật, hoặc hướng "left"/"right"/"front"/"back". */
  at?: string;
  /** give/pickUp: tên đạo cụ. */
  prop?: string;
  expression?: Expression;
  duration?: number;
  speed?: number;
}

export interface CharacterState {
  x: number;
  /** Góc quay thân: 0 nhìn máy quay, dương nhìn sang phải màn hình, π quay lưng. */
  yaw: number;
  posture: Posture;
  hold: { left?: string; right?: string };
  expression: Expression;
  lookAt?: string;
  ride?: string;
}

export interface TimedAction { name: ActionName; start: number; duration: number; params: ActionParams; from: CharacterState; to: CharacterState }
export interface Speech {
  start: number; duration: number; envelope: Float32Array; envelopeRate: number;
  track: VisemeKey[]; syllables: Syllable[]; expression?: Expression; seed: number;
}

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => { const x = clamp(t); return x * x * (3 - 2 * x); };
const bell = (t: number) => Math.sin(Math.PI * clamp(t));

/** Hiệu góc ngắn nhất b − a trong (−π, π]: quay trái sang phải đi qua chính diện, không xoay vòng qua lưng. */
export const angleDelta = (a: number, b: number) => {
  const delta = ((b - a) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return delta === -Math.PI ? Math.PI : delta;
};
export const angleLerp = (a: number, b: number, t: number) => a + angleDelta(a, b) * t;

/** Góc 3/4 là góc kể chuyện chuẩn của phim: thấy cả mặt lẫn hướng nhìn. */
export const facingYaw: Record<Facing, number> = { right: 0.95, left: -0.95, front: 0, back: Math.PI };
/** Hướng trên màn hình: +1 phải, −1 trái, 0 chính diện hoặc sau lưng. */
export const screenSide = (yaw: number) => Math.abs(Math.sin(yaw)) < 0.2 ? 0 : Math.sign(Math.sin(yaw));
/** Tay phía gần máy quay; nhìn thẳng thì dùng tay phải. */
export const nearSide = (yaw: number): "left" | "right" => Math.sin(yaw) >= -0.05 ? "right" : "left";
const other = (side: "left" | "right") => side === "left" ? "right" : "left";

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
  if (name === "walk" || name === "run") return Math.max(0.5, Math.abs((params.to ?? state.x) - state.x) / speed(character, params, name === "run") + 0.3);
  const durations: Partial<Record<ActionName, number>> = {
    turn: 0.6, sit: 1, kneel: 1, stand: 0.9, nod: 0.8, shake: 1, bow: 1.4, wave: 1.6, point: 1.6, handToChest: 1.8,
    cry: 3, laugh: 2, think: 2.2, shrug: 1.2, embrace: 2.5, row: 3, give: 1.6, pickUp: 1.4, putDown: 1.4, jump: 1, look: 0, emote: 0,
  };
  return durations[name] ?? 1;
}

/** Hướng quay về phía một mục tiêu (nhân vật hoặc hướng). Giữ nguyên nếu đã nhìn đúng phía. */
export function yawToward(state: CharacterState, target: string | undefined, positions: Record<string, number>) {
  if (!target) return state.yaw;
  if (target in facingYaw) return facingYaw[target as Facing];
  const x = positions[target];
  if (x === undefined || Math.abs(x - state.x) < 1) return state.yaw;
  const side = x > state.x ? 1 : -1;
  return screenSide(state.yaw) === side ? state.yaw : facingYaw[side > 0 ? "right" : "left"];
}

/** Trạng thái sau khi động tác kết thúc. */
export function actionEnd(state: CharacterState, name: ActionName, params: ActionParams, positions: Record<string, number>): CharacterState {
  const next = { ...state, hold: { ...state.hold } };
  if (name === "walk" || name === "run") {
    if (params.to !== undefined && params.to !== state.x) next.yaw = facingYaw[params.to > state.x ? "right" : "left"];
    next.x = params.to ?? state.x;
  }
  if (name === "turn") {
    // Không chỉ hướng: quay ngược lại (trái ↔ phải, trước ↔ sau).
    next.yaw = params.at ? yawToward(state, params.at, positions) : Math.abs(Math.sin(state.yaw)) < 0.2 ? angleLerp(state.yaw, state.yaw + Math.PI, 1) : -state.yaw;
  }
  if (name === "point" || name === "give" || name === "receive") next.yaw = yawToward(state, params.at, positions);
  if (name === "sit" || name === "kneel" || name === "stand") next.posture = name;
  if (name === "pickUp") next.hold[nearSide(next.yaw)] = params.prop;
  if (name === "putDown" || name === "give") {
    const side = params.prop && next.hold.left === params.prop ? "left" : params.prop && next.hold.right === params.prop ? "right" : next.hold[nearSide(next.yaw)] ? nearSide(next.yaw) : other(nearSide(next.yaw));
    next.hold[side] = undefined;
  }
  if (name === "look") next.lookAt = params.at;
  if (name === "emote" && params.expression) next.expression = params.expression;
  return next;
}

const limb = (swing: number, bend: number, spread = 0.1): Limb => ({ swing, bend, spread });
const blend = (a: Limb, b: Limb, t: number): Limb => ({ swing: lerp(a.swing, b.swing, t), bend: lerp(a.bend, b.bend, t), spread: lerp(a.spread, b.spread, t) });

/** Tư thế nền theo dáng: hông tự hạ chạm đất theo chân (xem rig), nên chỉ cần đặt góc chân. */
function posturePose(posture: Posture, pose: Pose) {
  const near = nearSide(pose.yaw);
  if (posture === "sit") {
    pose.legs = { left: limb(1.5, -1.5, 0.1), right: limb(1.42, -1.42, 0.1) };
    pose.arms = { left: limb(0.5, 0.8, 0.05), right: limb(0.5, 0.8, 0.05) };
    pose.lean = Math.max(pose.lean - 0.05, -0.05);
    pose.seat = 1;
  } else if (posture === "kneel") {
    // Gối gần đặt xuống đất, chân xa chống bàn chân phía trước.
    pose.legs[near] = limb(-0.05, -1.66, 0.04);
    pose.legs[other(near)] = limb(1.57, -1.57, 0.06);
    pose.arms[near] = limb(0.35, 0.7, 0.05);
    pose.lean += 0.06;
  }
}

function baseFor(character: Character, state: CharacterState) {
  const pose = restPose(character, state.x);
  pose.yaw = state.yaw;
  pose.expression = state.expression;
  pose.hold = { ...state.hold };
  for (const side of ["left", "right"] as const) if (pose.hold[side]) pose.hands[side] = "grip";
  posturePose(state.posture, pose);
  return pose;
}

function mixPose(a: Pose, b: Pose, t: number): Pose {
  return {
    ...a, lean: lerp(a.lean, b.lean, t), seat: lerp(a.seat, b.seat, t), yaw: angleLerp(a.yaw, b.yaw, t),
    arms: { left: blend(a.arms.left, b.arms.left, t), right: blend(a.arms.right, b.arms.right, t) },
    legs: { left: blend(a.legs.left, b.legs.left, t), right: blend(a.legs.right, b.legs.right, t) },
  };
}

/** Đưa một tay tới tư thế đích với trọng số k (0 = giữ nguyên). */
function reach(pose: Pose, side: "left" | "right", target: Limb, k: number, hand?: HandShape) {
  pose.arms[side] = blend(pose.arms[side], target, k);
  if (hand && k > 0.35) pose.hands[side] = hand;
}

const expressionPosture: Partial<Record<Expression, (pose: Pose) => void>> = {
  sad: pose => { pose.headPitch -= 0.16; pose.lean += 0.04; },
  angry: pose => { pose.lean += 0.05; pose.headPitch -= 0.06; pose.hands.left = pose.hands.left === "relaxed" ? "fist" : pose.hands.left; pose.hands.right = pose.hands.right === "relaxed" ? "fist" : pose.hands.right; },
  surprised: pose => { pose.headPitch += 0.08; const side = nearSide(pose.yaw); reach(pose, side, limb(0.5, 1.1, 0.15), 0.6, "open"); },
  scared: pose => { pose.headPitch -= 0.05; reach(pose, "left", limb(0.7, 1.5, -0.15), 0.9, "open"); reach(pose, "right", limb(0.7, 1.5, -0.15), 0.9, "open"); pose.lean -= 0.05; },
  thinking: pose => { pose.headPitch += 0.06; pose.headRoll += 0.05; },
  tender: pose => { pose.headRoll += 0.07; pose.headPitch -= 0.04; },
};

/** Bước chân dài bao nhiêu đơn vị thế giới: mỗi nửa chu kỳ (pha tăng π) là một bước, gót chạm đất khi pha = π/2 + kπ. */
export const strideOf = (character: Character, run: boolean) => (run ? 125 : 82) * character.scale;

/**
 * Tiến độ một lần đi/chạy tại thời điểm t: quay người trong 0,15 s đầu và cuối, vận tốc hình thang (tăng tốc 15% đầu,
 * giảm tốc 15% cuối). Dùng chung cho dáng đi và tiếng bước chân để hai thứ luôn khớp nhau.
 */
export function walkProgress(action: TimedAction, t: number) {
  const p = clamp((t - action.start) / action.duration);
  const turnIn = Math.min(0.15 / action.duration, 0.3);
  const walking = clamp((p - turnIn) / (1 - 2 * turnIn));
  const ramp = 0.15;
  const travel = walking < ramp ? walking ** 2 / (2 * ramp * (1 - ramp)) : walking > 1 - ramp ? 1 - (1 - walking) ** 2 / (2 * ramp * (1 - ramp)) : (walking - ramp / 2) / (1 - ramp);
  const gait = smooth(Math.min(walking * 6, (1 - walking) * 6, 1));
  return { walking, travel, gait };
}

export interface PoseContext { t: number; seed: number; positions: Record<string, number>; speaker?: string; id: string }

/** Lò xo tắt dần (nghiệm đóng): vật thể bị kéo theo rồi đung đưa khi chuyển động dừng. */
const spring = (time: number) => time < 0 ? 0 : Math.exp(-3.2 * time) * Math.sin(8.5 * time);

/** Tư thế của một nhân vật tại thời điểm t: tư thế nền → động tác đang diễn → lời nói → hơi thở, chớp mắt, ánh nhìn. */
export function poseAt(character: Character, state: CharacterState, actions: TimedAction[], speech: Speech[], context: PoseContext) {
  const { t } = context;
  let pose = baseFor(character, state);
  let busy = false;
  for (const action of actions) {
    const end = action.start + action.duration;
    const name = action.name;
    // Quán tính sau khi dừng bước: tóc và vạt áo văng tới trước rồi đung đưa về.
    if ((name === "walk" || name === "run") && t > end && t < end + 1.5) {
      const direction = Math.sign((action.params.to ?? action.from.x) - action.from.x);
      pose.flow[0] += direction * (name === "run" ? 26 : 12) * character.scale * spring(t - end);
    }
    if (t < action.start || t > end || action.duration <= 0) continue;
    busy = true;
    const p = (t - action.start) / action.duration;
    const from = baseFor(character, action.from);
    if (name === "walk" || name === "run") {
      const to = action.params.to ?? action.from.x;
      const direction = to >= action.from.x ? 1 : -1;
      const { travel, gait } = walkProgress(action, t);
      pose = from;
      pose.x = lerp(action.from.x, to, travel);
      const profile = direction * (name === "run" ? 1.4 : 1.3);
      const turnIn = Math.min(0.15 / action.duration, 0.3);
      pose.yaw = p < turnIn ? angleLerp(action.from.yaw, profile, smooth(p / turnIn)) : p > 1 - turnIn ? angleLerp(profile, action.to.yaw, smooth((p - 1 + turnIn) / turnIn)) : profile;
      const phase = (Math.abs(pose.x - action.from.x) / strideOf(character, name === "run")) * Math.PI;
      const amplitude = (name === "run" ? 0.7 : 0.42) * gait;
      const swing = Math.sin(phase);
      // Chân đưa tới thì gập gối để nhấc bàn chân; chân trụ thẳng. Tay vung ngược chân cùng phía.
      pose.legs.right = limb(swing * amplitude, -Math.max(0, Math.cos(phase)) * amplitude * (name === "run" ? 2.2 : 1.3), 0.03);
      pose.legs.left = limb(-swing * amplitude, -Math.max(0, -Math.cos(phase)) * amplitude * (name === "run" ? 2.2 : 1.3), 0.03);
      pose.arms.right = limb(-swing * amplitude * 0.75, name === "run" ? 1.5 * gait + 0.12 : 0.18 + Math.max(0, -swing) * 0.3 * amplitude, 0.1);
      pose.arms.left = limb(swing * amplitude * 0.75, name === "run" ? 1.5 * gait + 0.12 : 0.18 + Math.max(0, swing) * 0.3 * amplitude, 0.1);
      if (pose.hold.left) pose.arms.left.swing *= 0.4;
      if (pose.hold.right) pose.arms.right.swing *= 0.4;
      pose.hands = { left: name === "run" ? "fist" : pose.hands.left, right: name === "run" ? "fist" : pose.hands.right };
      pose.lean += (name === "run" ? 0.2 : 0.05) * gait;
      pose.sway = Math.sin(phase) * 0.03 * gait;
      if (name === "run") pose.bob -= Math.abs(Math.cos(phase)) * 10 * character.scale * gait;
      // Tóc, vạt áo bị gió đẩy ngược hướng đi, rung theo nhịp bước.
      pose.flow = [-direction * (name === "run" ? 24 : 10) * character.scale * gait, Math.abs(Math.sin(phase)) * 3 * gait];
    } else if (name === "sit" || name === "kneel" || name === "stand") {
      const target = baseFor(character, { ...action.from, posture: name });
      // Ngồi xuống/đứng lên: người đổ về trước lấy đà ở giữa động tác.
      pose = mixPose(from, target, smooth(p));
      pose.lean += 0.35 * bell(p);
    } else if (name === "turn") {
      pose = from;
      pose.yaw = angleLerp(action.from.yaw, action.to.yaw, smooth(p));
      // Đầu quay trước thân một nhịp, vai nhún nhẹ.
      pose.headYaw = angleDelta(pose.yaw, angleLerp(action.from.yaw, action.to.yaw, smooth(p * 1.6))) * 0.8;
      pose.bob += bell(p) * 2 * character.scale;
      const step = bell(p);
      pose.legs.left = limb(0.12 * step, -0.25 * step, 0.03);
    } else {
      pose = from;
      const e = bell(p);
      const k = smooth(Math.min(p * 5, (1 - p) * 5, 1));
      const near = nearSide(action.to.yaw);
      const far = other(near);
      if (name === "point" || name === "give" || name === "receive") pose.yaw = angleLerp(action.from.yaw, action.to.yaw, smooth(p * 3));
      if (name === "nod") pose.headPitch -= (0.5 - 0.5 * Math.cos(p * Math.PI * 4)) * 0.16 * k;
      if (name === "shake") pose.headYaw += Math.sin(p * Math.PI * 6) * 0.38 * k;
      if (name === "bow") {
        pose.lean += 0.45 * e;
        pose.headPitch -= 0.2 * e;
        reach(pose, "left", limb(-0.1, 0.35, -0.1), e);
        reach(pose, "right", limb(-0.1, 0.35, -0.1), e);
      }
      if (name === "wave") {
        reach(pose, near, limb(0.25, Math.PI - 0.5 + Math.sin(p * Math.PI * 8) * 0.38, 1.05), k, "wave");
        pose.headRoll += 0.05 * k;
      }
      if (name === "point") reach(pose, near, limb(1.45, 0.05, 0.12), k, "point");
      if (name === "handToChest") { reach(pose, near, limb(0.45, 1.95, -0.4), k, "open"); pose.headPitch -= 0.06 * k; }
      if (name === "cry") {
        reach(pose, near, limb(0.75, 2.05, -0.3), k, "open");
        reach(pose, far, limb(0.65, 2.0, -0.3), k * 0.85, "open");
        pose.headPitch -= 0.25 * k;
        pose.lean += 0.12 * k;
        pose.expression = "sad";
        pose.tears = k * (0.6 + p * 2);
        pose.bob += Math.abs(Math.sin(t * 9)) * 1.4 * k * character.scale;
      }
      if (name === "laugh") {
        pose.headPitch += 0.14 * k + Math.sin(t * 14) * 0.03 * k;
        pose.lean -= 0.05 * k;
        pose.expression = "happy";
        pose.mouth = 0.5 + Math.abs(Math.sin(t * 12)) * 0.4 * k;
        pose.viseme = "D";
        pose.bob += Math.sin(t * 14) * 1.5 * k * character.scale;
        reach(pose, near, limb(0.4, 1.3, -0.2), k * 0.7, "relaxed");
      }
      if (name === "think") {
        reach(pose, near, limb(0.35, 2.35, -0.35), k, "fist");
        reach(pose, far, limb(0.45, 1.35, -0.45), k, "relaxed");
        pose.expression = "thinking";
        pose.look = [0.6, -0.8];
        pose.headPitch += 0.1 * k;
      }
      if (name === "shrug") {
        reach(pose, "left", limb(0.3, 1.25, 0.45), e, "open");
        reach(pose, "right", limb(0.3, 1.25, 0.45), e, "open");
        pose.headRoll += 0.1 * e;
        pose.bob -= 4 * e * character.scale;
      }
      if (name === "embrace") {
        reach(pose, near, limb(1.25, 0.75, -0.05), k, "open");
        reach(pose, far, limb(1.15, 0.85, -0.05), k, "open");
        pose.lean += 0.08 * k;
        pose.headRoll += 0.08 * k;
      }
      if (name === "row") {
        // Chèo đứng kiểu đò miền Tây: hai tay đẩy cán, thân dồn trọng tâm theo nhịp chèo.
        const stroke = Math.sin(t * 2.6);
        reach(pose, near, limb(1.0 + stroke * 0.4, 0.45 - stroke * 0.15, 0.05), k, "grip");
        reach(pose, far, limb(0.8 + stroke * 0.4, 0.7 - stroke * 0.15, -0.1), k, "grip");
        pose.lean += (0.1 + stroke * 0.07) * k;
        pose.legs[near] = limb(0.18 * k, -0.05, 0.05);
        pose.legs[far] = limb(-0.15 * k, 0, 0.05);
      }
      if (name === "receive") {
        reach(pose, near, limb(1.2, 0.3, 0.05), k, "open");
        pose.hold = p > 0.45 ? { ...action.to.hold } : { ...action.from.hold };
      }
      if (name === "give") {
        const side = action.from.hold.left === action.params.prop ? "left" : "right";
        reach(pose, side, limb(1.25, 0.2, 0.05), k, "grip");
        if (p > 0.6) pose.hold[side] = undefined;
      }
      if (name === "pickUp" || name === "putDown") {
        // Ngồi xổm, cúi người, với tay chạm đất.
        pose.legs.left = blend(pose.legs.left, limb(0.85, -1.7, 0.12), e);
        pose.legs.right = blend(pose.legs.right, limb(0.75, -1.5, 0.12), e);
        pose.lean += 0.55 * e;
        reach(pose, near, limb(0.25, 0.1, 0.1), e, "grip");
        const holding = (name === "pickUp") === p > 0.5;
        pose.hold[near] = holding ? action.params.prop : name === "pickUp" ? undefined : pose.hold[near];
        if (name === "putDown" && p > 0.5) pose.hold = { ...action.to.hold };
      }
      if (name === "jump") {
        // Lấy đà (nhún) → bật lên → tiếp đất có nhún giảm chấn.
        const crouch = p < 0.25 ? bell(p / 0.5) : p > 0.8 ? bell((p - 0.8) / 0.4) * 0.8 : 0;
        const air = p >= 0.25 && p <= 0.8 ? Math.sin(Math.PI * (p - 0.25) / 0.55) : 0;
        pose.legs.left = limb(0.6 * crouch + 0.35 * air, -1.2 * crouch - 0.7 * air, 0.06);
        pose.legs.right = limb(0.55 * crouch + 0.25 * air, -1.1 * crouch - 0.9 * air, 0.06);
        pose.bob -= 75 * air * character.scale;
        pose.lean += 0.25 * crouch;
        reach(pose, "left", limb(p < 0.25 ? -0.6 : 2.2, 0.3, 0.3), Math.max(crouch, air), "open");
        reach(pose, "right", limb(p < 0.25 ? -0.6 : 2.2, 0.3, 0.3), Math.max(crouch, air), "open");
        pose.flow[1] = air * 8 - crouch * 4;
      }
    }
  }
  expressionPosture[pose.expression]?.(pose);

  // Lời nói: khẩu hình theo âm tiết đã căn với giọng thật, độ mở theo năng lượng, đầu và lông mày nhấn theo âm tiết mạnh.
  for (const line of speech) {
    if (t < line.start || t > line.start + line.duration) continue;
    const local = t - line.start;
    const index = Math.min(line.envelope.length - 1, Math.floor(local * line.envelopeRate));
    const level = line.envelope[index] ?? 0;
    pose.viseme = visemeAt(line.track, local);
    pose.mouth = pose.viseme === "X" || pose.viseme === "A" ? 0 : 0.5 + 0.5 * clamp(level * 1.2);
    if (line.expression) pose.expression = line.expression;
    // Nhấn đầu (beat) tại các âm tiết mạnh: gật nhẹ 120 ms sau hạt nhân âm tiết.
    let beat = 0;
    for (const syllable of line.syllables) {
      if (syllable.stress < 0.75) continue;
      const since = local - syllable.nucleus;
      if (since > -0.05 && since < 0.4) beat = Math.max(beat, Math.sin(Math.PI * clamp((since + 0.05) / 0.45)) * (syllable.stress - 0.6));
    }
    pose.headPitch -= beat * 0.12;
    pose.headRoll += Math.sin(local * 2.1 + line.seed % 5) * 0.025;
    if (line.duration > 2.2 && state.posture === "stand" && !busy) {
      const choose = random(line.seed)();
      const k = smooth(Math.min((local - 0.35) * 2, (line.duration - local - 0.3) * 2, 1));
      const near = nearSide(pose.yaw);
      if (k > 0) {
        if (choose < 0.4) reach(pose, near, limb(0.6 + level * 0.2 + beat * 0.3, 1.0 + Math.sin(local * 3) * 0.12, 0.15), k, "open");
        else if (choose < 0.7) reach(pose, near, limb(0.45, 1.9, -0.38), k, "open");
        else reach(pose, other(near), limb(0.55, 1.1 + level * 0.2, 0.1), k, "relaxed");
      }
    }
  }

  // Sống động khi đứng yên: thở, dồn trọng tâm, chớp mắt theo lịch tất định.
  const seed = context.seed;
  pose.breath = Math.sin(t * 1.8 + seed % 7);
  pose.bob += pose.breath * 0.8 * character.scale;
  pose.arms.left.swing += Math.sin(t * 1.3 + seed % 5) * 0.02;
  pose.arms.right.swing += Math.sin(t * 1.1 + seed % 3) * 0.02;
  if (!busy) pose.sway += Math.sin(t * 0.45 + seed % 11) * 0.012;
  // Gió nhẹ: tóc và vạt áo lay theo hai sóng chậm lệch pha, không bao giờ đứng im như tượng.
  pose.flow[0] += (Math.sin(t * 1.3 + seed % 13) + Math.sin(t * 2.9 + seed % 7) * 0.4) * 1.6 * character.scale;
  const blinkRandom = random(seed + Math.floor(t / 3.2));
  const blinkAt = Math.floor(t / 3.2) * 3.2 + blinkRandom() * 2.8;
  if (t >= blinkAt && t < blinkAt + 0.14) pose.blink = 1 - Math.abs((t - blinkAt) / 0.07 - 1);

  // Ánh nhìn: mắt và đầu hướng về người được nhìn (hoặc người đang nói); đầu chỉ quay tới một giới hạn tự nhiên.
  const targetId = state.lookAt ?? (context.speaker !== context.id ? context.speaker : undefined);
  const targetX = targetId ? context.positions[targetId] : undefined;
  if (targetX !== undefined && Math.abs(pose.look[0]) < 0.01 && Math.abs(targetX - pose.x) > 1) {
    const side = Math.sign(targetX - pose.x);
    pose.look = [side * clamp(Math.abs(targetX - pose.x) / 200, 0.3, 1), pose.look[1]];
    const want = angleDelta(pose.yaw, side * 1.1);
    pose.headYaw += clamp(want, -0.7, 0.7) * 0.75;
  }
  return pose;
}
