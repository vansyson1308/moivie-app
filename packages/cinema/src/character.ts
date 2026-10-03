import { Path2D, type SKRSContext2D } from "@napi-rs/canvas";
import { hashSeed, random } from "./motion";
import { capsule, cone, darken, defaultLighting, lighten, lineColor, mixColor, paintShape, smoothPath, type Lighting, type Point } from "./rig/paint";

export type Expression = "neutral" | "happy" | "sad" | "angry" | "surprised" | "scared" | "thinking" | "tender";
/** Khẩu hình Preston Blair: A khép môi (m b p), B hé răng, C mở vừa, D mở rộng, E tròn, F chu môi, G răng chạm môi (ph v), H lưỡi (l), X nghỉ. */
export type Viseme = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "X";
export type HandShape = "relaxed" | "fist" | "open" | "point" | "grip" | "wave";
export type HairStyle = "short" | "sidePart" | "long" | "bun" | "ponytail" | "bald" | "curly" | "bob";
export type OutfitStyle = "shirt" | "aoDai" | "aoBaBa" | "dress" | "jacket" | "robe";
export type HatStyle = "none" | "nonLa" | "cap" | "khanDong" | "beret";

export interface CharacterSpec {
  name: string;
  age?: "child" | "adult" | "elder";
  gender?: "male" | "female";
  build?: "slim" | "average" | "heavy";
  skin?: string;
  eyes?: string;
  hair?: { style?: HairStyle; color?: string };
  beard?: "none" | "mustache" | "goatee" | "full";
  outfit?: { style?: OutfitStyle; top?: string; bottom?: string; accent?: string; shoes?: string };
  hat?: HatStyle;
  hatColor?: string;
  glasses?: boolean;
  scale?: number;
  /** Giọng VieNeu-TTS, ví dụ "Thiện Minh". */
  voice?: string;
}

/** Một chi hai đốt: swing xoay về trước (rad, 0 = buông thẳng), bend gập khớp giữa, spread dang ra ngoài. */
export interface Limb { swing: number; bend: number; spread: number }

export interface Pose {
  x: number;
  y: number;
  /** Góc quay thân quanh trục đứng: 0 nhìn thẳng máy quay, +π/2 nhìn sang phải màn hình, π quay lưng. */
  yaw: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  lean: number;
  sway: number;
  /** Nhấc khỏi mặt đất (âm = lên trên), sau khi bàn chân đã được đặt chạm đất. */
  bob: number;
  /** Độ hiện của ghế đẩu dưới hông khi ngồi (0 không có, 1 có). */
  seat: number;
  breath: number;
  arms: { left: Limb; right: Limb };
  legs: { left: Limb; right: Limb };
  hands: { left: HandShape; right: HandShape };
  expression: Expression;
  mouth: number;
  viseme: Viseme;
  blink: number;
  look: [number, number];
  tears: number;
  hold: { left?: string; right?: string };
  /** Lệch quán tính của tóc và vạt áo (đơn vị thế giới), do chuyển động sinh ra. */
  flow: [number, number];
}

export interface Character {
  id: string;
  name: string;
  age: "child" | "adult" | "elder";
  gender: "male" | "female";
  build: "slim" | "average" | "heavy";
  scale: number;
  skin: string;
  eyes: string;
  hair: { style: HairStyle; color: string };
  beard: "none" | "mustache" | "goatee" | "full";
  outfit: { style: OutfitStyle; top: string; bottom: string; accent: string; shoes: string };
  hat: HatStyle;
  hatColor: string;
  glasses: boolean;
  voice?: string;
  body: Body;
}

export interface Body {
  height: number; hipY: number; shoulderY: number; neckY: number; headY: number;
  rx: number; ry: number; rz: number;
  thigh: number; shin: number; upperArm: number; forearm: number;
  shoulderHalf: number; chestDepth: number; waistHalf: number; hipHalf: number;
  armRadius: number; legRadius: number; palm: number; foot: number;
}

export function createCharacter(id: string, spec: CharacterSpec): Character {
  const age = spec.age ?? "adult";
  const gender = spec.gender ?? "male";
  const build = spec.build ?? "average";
  const s = spec.scale ?? 1;
  const width = build === "heavy" ? 1.28 : build === "slim" ? 0.88 : 1;
  const height = (age === "child" ? 232 : age === "elder" ? 322 : gender === "female" ? 328 : 342) * s;
  // Tỉ lệ đầu kiểu phim truyện: người lớn ~1:5.5, trẻ em ~1:4 (đầu to hơn thật để dễ đọc biểu cảm).
  const ry = height / (age === "child" ? 4 : 5.5) / 2;
  const rx = ry * (gender === "female" ? 0.84 : 0.88);
  const headY = -height + ry;
  const neckY = headY + ry * 0.92;
  const shoulderY = neckY + height * 0.045;
  const hipY = -height * (age === "child" ? 0.43 : 0.48);
  const leg = -hipY - height * 0.02;
  const shoulderHalf = height * (gender === "female" ? 0.098 : 0.112) * width * (age === "child" ? 1.08 : 1);
  const body: Body = {
    height, hipY, shoulderY, neckY, headY, rx, ry, rz: rx * 0.96,
    thigh: leg * 0.5, shin: leg * 0.5,
    upperArm: height * (age === "child" ? 0.17 : 0.185), forearm: height * (age === "child" ? 0.155 : 0.165),
    shoulderHalf, chestDepth: shoulderHalf * (gender === "female" ? 0.62 : 0.56) * (build === "heavy" ? 1.25 : 1),
    waistHalf: shoulderHalf * (gender === "female" ? 0.7 : 0.84) * (build === "heavy" ? 1.15 : 1),
    hipHalf: height * (gender === "female" ? 0.1 : 0.088) * width,
    armRadius: height * (age === "child" ? 0.03 : 0.026) * Math.sqrt(width), legRadius: height * (age === "child" ? 0.036 : 0.032) * Math.sqrt(width),
    palm: height * (age === "child" ? 0.05 : 0.046), foot: height * (age === "child" ? 0.085 : 0.075),
  };
  const defaultHair: HairStyle = age === "elder" && gender === "male" ? "bald" : gender === "female" ? "long" : "short";
  return {
    id, name: spec.name, age, gender, build, scale: s,
    skin: spec.skin ?? "#e8b48c",
    eyes: spec.eyes ?? "#4a2f22",
    hair: { style: spec.hair?.style ?? defaultHair, color: spec.hair?.color ?? (age === "elder" ? "#d9d5cc" : "#241c18") },
    beard: spec.beard ?? "none",
    outfit: {
      style: spec.outfit?.style ?? "shirt",
      top: spec.outfit?.top ?? (gender === "female" ? "#c4544a" : "#4f6d8f"),
      bottom: spec.outfit?.bottom ?? "#3a3530",
      accent: spec.outfit?.accent ?? "#e8d9b0",
      shoes: spec.outfit?.shoes ?? (age === "elder" ? "#5a4636" : "#2f2a27"),
    },
    hat: spec.hat ?? "none",
    hatColor: spec.hatColor ?? "#e3cc8c",
    glasses: spec.glasses ?? false,
    voice: spec.voice,
    body,
  };
}

const limb = (swing = 0, bend = 0, spread = 0): Limb => ({ swing, bend, spread });

export function restPose(character: Character, x = 0): Pose {
  return {
    x, y: 0, yaw: 0.95, headYaw: 0, headPitch: 0, headRoll: 0, lean: character.age === "elder" ? 0.12 : 0, sway: 0, bob: 0, seat: 0, breath: 0,
    arms: { left: limb(0.04, 0.22, 0.17), right: limb(0.06, 0.2, 0.16) },
    legs: { left: limb(0, 0, 0.03), right: limb(0, 0, 0.03) },
    hands: { left: "relaxed", right: "relaxed" },
    expression: "neutral", mouth: 0, viseme: "X", blink: 0, look: [0, 0], tears: 0, hold: {}, flow: [0, 0],
  };
}

type V3 = [number, number, number];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** Chiếu trực giao: x màn hình, y màn hình, độ sâu hướng về máy quay (lớn hơn = gần hơn). */
function projector(yaw: number) {
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  return (p: V3): [number, number, number] => [p[0] * c + p[2] * s, p[1], p[2] * c - p[0] * s];
}

/** Hướng của một đốt chi trong hệ thân (y xuống dưới): swing về trước, spread dang sang phía side. */
function direction(swing: number, spread: number, side: number): V3 {
  return [side * Math.sin(spread), Math.cos(spread) * Math.cos(swing), Math.cos(spread) * Math.sin(swing)];
}

export interface Rig { joints: Record<string, V3>; torso: (p: V3) => V3; headCenter: V3 }

/** Toạ độ 3D các khớp theo tư thế (hệ thân, gốc ở giữa hai bàn chân, x là phía tay trái nhân vật, z phía trước mặt). */
export function rig(character: Character, pose: Pose): Rig {
  const b = character.body;
  // Chạm đất: hông hạ xuống đúng bằng điểm thấp nhất của hai chân (gót, mũi, hoặc đầu gối khi quỳ) nên ngồi, quỳ, ngồi xổm,
  // bước đi đều không trượt chân hay lơ lửng; bob chỉ dùng cho nhún và nhảy.
  let lowest = 0;
  for (const side of ["left", "right"] as const) {
    const leg = pose.legs[side];
    const knee = direction(leg.swing, leg.spread, 1)[1] * b.thigh;
    const shinAngle = leg.swing + leg.bend;
    const ankle = knee + direction(shinAngle, leg.spread * 0.5, 1)[1] * b.shin;
    const toe = ankle - Math.sin(shinAngle) * b.foot * 0.9 + b.legRadius * 0.4;
    lowest = Math.max(lowest, knee + b.legRadius, ankle + b.legRadius * 0.77, toe + b.legRadius * 0.62);
  }
  const hip: V3 = [0, -lowest + pose.bob, 0];
  const breath = 1 + pose.breath * 0.012;
  const torso = (p: V3): V3 => {
    const dy = (p[1] - b.hipY) * (p[1] < b.hipY ? breath : 1);
    const dz = p[2];
    // Cúi người về trước (lean) và nghiêng sang bên (sway) quanh hông.
    const y1 = dy * Math.cos(pose.lean) - dz * Math.sin(pose.lean);
    const z1 = dz * Math.cos(pose.lean) - dy * Math.sin(pose.lean);
    const x1 = p[0] * Math.cos(pose.sway) - y1 * Math.sin(pose.sway);
    const y2 = p[0] * Math.sin(pose.sway) + y1 * Math.cos(pose.sway);
    return [x1 + hip[0], y2 + hip[1], z1 + hip[2]];
  };
  const joints: Record<string, V3> = { hip };
  for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
    const shoulder = torso([sign * b.shoulderHalf * 0.86, b.shoulderY + b.armRadius * 0.6, 0]);
    const arm = pose.arms[side];
    // Tay buông theo trọng lực: chỉ ăn một nửa độ cúi của thân.
    const lean = pose.lean * 0.55;
    const elbow = add3(shoulder, scale3(direction(arm.swing - lean, arm.spread, sign), b.upperArm));
    const wrist = add3(elbow, scale3(direction(arm.swing + arm.bend - lean, arm.spread * 0.6, sign), b.forearm));
    const hipJoint: V3 = [sign * b.hipHalf * 0.5, hip[1], 0];
    const legPose = pose.legs[side];
    const knee = add3(hipJoint, scale3(direction(legPose.swing, legPose.spread, sign), b.thigh));
    const ankle = add3(knee, scale3(direction(legPose.swing + legPose.bend, legPose.spread * 0.5, sign), b.shin));
    const shinAngle = legPose.swing + legPose.bend;
    // Bàn chân vuông góc với ống chân: đứng thì nằm ngang, quỳ thì mũi chân chạm đất.
    const toe = add3(ankle, [0, -Math.sin(shinAngle) * b.foot * 0.9 + b.legRadius * 0.4, Math.cos(shinAngle) * b.foot]);
    Object.assign(joints, {
      [`${side}Shoulder`]: shoulder, [`${side}Elbow`]: elbow, [`${side}Wrist`]: wrist,
      [`${side}Hip`]: hipJoint, [`${side}Knee`]: knee, [`${side}Ankle`]: ankle, [`${side}Toe`]: toe,
    });
  }
  const neck = torso([0, b.neckY, b.chestDepth * 0.05]);
  const headCenter = add3(neck, [0, -b.ry * 0.86 * Math.cos(pose.headPitch), -b.ry * 0.86 * Math.sin(pose.headPitch) * 0.6]);
  joints.neck = neck;
  return { joints, torso, headCenter };
}

export interface CharacterAnchors { head: Point; top: number; feet: Point; hands: { front: Point; back: Point }; chest: Point; nearSide: "left" | "right" }

/** Toạ độ màn hình (đơn vị thế giới) của các điểm mốc, dùng cho máy quay và đạo cụ. */
export function anchors(character: Character, pose: Pose): CharacterAnchors {
  const project = projector(pose.yaw);
  const { joints, headCenter, torso } = rig(character, pose);
  const world = (p: V3): Point => { const [x, y] = project(p); return [pose.x + x, pose.y + y]; };
  const nearSide = Math.sin(pose.yaw) >= 0 ? "right" : "left";
  const farSide = nearSide === "right" ? "left" : "right";
  const b = character.body;
  const hatTop = character.hat === "nonLa" ? b.ry * 1.85 : character.hat === "none" ? b.ry * 0.12 : b.ry * 0.3;
  return {
    head: world(headCenter), top: pose.y + headCenter[1] - b.ry - hatTop, feet: [pose.x, pose.y],
    hands: { front: world(joints[`${nearSide}Wrist`]!), back: world(joints[`${farSide}Wrist`]!) },
    chest: world(torso([0, (b.shoulderY + b.hipY) / 2, 0])), nearSide,
  };
}

/** Vẽ đạo cụ trong tay: angle là góc cẳng tay, mirror = -1 khi nhân vật nhìn sang trái. */
export type PropDrawer = (ctx: SKRSContext2D, hand: Point, angle: number, scale: number, t: number, mirror: number) => void;

interface Part { depth: number; draw: () => void }

export const brows: Record<Expression, [number, number]> = {
  neutral: [0, 0], happy: [-0.06, -0.08], sad: [-0.16, 0.08], angry: [0.14, -0.08], surprised: [-0.2, -0.18], scared: [-0.18, 0.04], thinking: [-0.1, 0.02], tender: [-0.08, 0.02],
};
export const smiles: Record<Expression, number> = {
  neutral: 0.08, happy: 1, sad: -0.75, angry: -0.55, surprised: 0, scared: -0.35, thinking: -0.12, tender: 0.55,
};
/** Độ sụp mí trên và độ nhô mí dưới theo cảm xúc. */
export const lids: Record<Expression, [number, number]> = {
  neutral: [0.14, 0], happy: [0.14, 0.32], sad: [0.3, 0], angry: [0.3, 0.08], surprised: [0, 0], scared: [0, 0], thinking: [0.22, 0.05], tender: [0.2, 0.18],
};

/** Bóng trên da: ấm, ngả hồng đỏ (máu dưới da), không xám. */
function skinShadow(skin: string) {
  return mixColor(darken(skin, 0.14), "#b4506a", 0.16);
}

const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Vẽ một diễn viên 2.5D: khớp 3D chiếu theo góc quay, bộ phận sắp lớp theo độ sâu, đổ bóng theo nguồn sáng của cảnh. */
export function drawCharacter(ctx: SKRSContext2D, character: Character, pose: Pose, props: Record<string, PropDrawer>, t: number, lighting: Lighting = defaultLighting) {
  const b = character.body;
  const { outfit } = character;
  const project = projector(pose.yaw);
  const { joints, torso, headCenter } = rig(character, pose);
  const screen = (p: V3): Point => { const [x, y] = project(p); return [x, y]; };
  const depthOf = (p: V3) => project(p)[2];
  const parts: Part[] = [];
  const line = 2.3 * Math.max(0.7, character.scale);
  const shade = (fill: string, shape: Path2D, depth: number, highlight?: number) =>
    paintShape(ctx, shape, fill, lighting, { depth, line, highlight, shadow: fill === character.skin ? skinShadow(fill) : undefined });

  ctx.save();
  ctx.translate(pose.x, pose.y);

  // Bóng tiếp xúc dưới chân: elip tối mờ dần, lệch ngược hướng sáng.
  const shadowWidth = (b.hipHalf * 2.4 + Math.abs(Math.sin(pose.yaw)) * b.foot) * (1 - Math.min(0.5, -pose.bob / 300));
  const shadowX = -lighting.dir[0] * b.hipHalf * 0.6;
  const contact = ctx.createRadialGradient(shadowX, 2, 0, shadowX, 2, shadowWidth);
  contact.addColorStop(0, "rgba(20,15,40,0.4)");
  contact.addColorStop(1, "rgba(20,15,40,0)");
  ctx.fillStyle = contact;
  ctx.beginPath();
  ctx.ellipse(shadowX, 2, shadowWidth, shadowWidth * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  const skirt = outfit.style === "dress";
  const tunic = outfit.style === "aoDai" || outfit.style === "robe";
  const loose = outfit.style === "aoBaBa";
  const legColor = skirt ? character.skin : outfit.bottom;
  const shortSleeve = outfit.style === "shirt" && character.age !== "elder";

  // --- Ghế đẩu gỗ khi ngồi: mặt ghế ngay dưới hông, nằm sau mọi bộ phận ---
  if (pose.seat > 0.02) {
    parts.push({
      depth: -b.chestDepth * 3,
      draw: () => {
        const top = joints.hip![1] + b.legRadius * 0.9;
        const half = b.hipHalf * 1.25;
        const wood = "#8a6440";
        ctx.save();
        ctx.globalAlpha = Math.min(1, pose.seat);
        const stool = new Path2D();
        for (const side of [-1, 1]) capsule(stool, [side * half * 0.75, top], [side * half * 0.85, -b.legRadius * 0.3], b.legRadius * 0.32);
        stool.rect(-half * 0.8, top + (-top) * 0.55, half * 1.6, b.legRadius * 0.35);
        paintShape(ctx, stool, darken(wood, 0.12), lighting, { depth: 2, line: line * 0.8 });
        const plank = new Path2D();
        plank.ellipse(0, top, half, Math.max(2, half * 0.22 * Math.abs(Math.cos(pose.yaw)) + 3), 0, 0, Math.PI * 2);
        plank.rect(-half, top, half * 2, b.legRadius * 0.5);
        paintShape(ctx, plank, wood, lighting, { depth: 3, line: line * 0.8, highlight: 0.3 });
        ctx.restore();
      },
    });
  }

  // --- Chân ---
  for (const side of ["left", "right"] as const) {
    const [hipJ, knee, ankle, toe] = [joints[`${side}Hip`]!, joints[`${side}Knee`]!, joints[`${side}Ankle`]!, joints[`${side}Toe`]!];
    const forward = Math.max(0, Math.sin(pose.legs[side].swing)) * b.thigh;
    parts.push({
      // Chân nằm sau thân áo, trừ khi đùi đưa ra trước (ngồi, quỳ).
      depth: (depthOf(knee) + depthOf(ankle)) / 2 - b.chestDepth * 1.2 + forward * Math.abs(Math.cos(pose.yaw)) * 1.2,
      draw: () => {
        const radius = b.legRadius * (loose || outfit.style === "aoDai" ? 1.22 : 1);
        const leg = new Path2D();
        // Đùi to dần về hông, ống quyển thon về cổ chân (hai khúc côn nối nhau thay vì ống đều).
        cone(leg, screen(hipJ), screen(knee), radius * 1.12, radius * 0.9);
        cone(leg, screen(knee), screen(ankle), radius * 0.9, radius * (loose ? 0.95 : 0.72));
        shade(legColor, leg, radius * 0.55);
        const foot = new Path2D();
        capsule(foot, screen(add3(ankle, [0, b.legRadius * 0.15, -b.foot * 0.12])), screen(toe), b.legRadius * 0.62);
        shade(outfit.shoes, foot, 3, 0.4);
      },
    });
  }

  // --- Thân áo: các lát cắt elip theo chiều cao, chiếu theo góc quay ---
  const sections: [number, number, number, number][] = [
    [b.shoulderY - b.armRadius * 0.4, b.shoulderHalf * 0.62, b.chestDepth * 0.7, 0],
    [b.shoulderY + b.armRadius * 0.9, b.shoulderHalf, b.chestDepth, 0],
    [b.shoulderY + (b.hipY - b.shoulderY) * 0.32, b.shoulderHalf * 0.94, b.chestDepth * (character.gender === "female" ? 1.12 : 1.02), b.chestDepth * 0.08],
    [b.shoulderY + (b.hipY - b.shoulderY) * 0.68, b.waistHalf * (loose ? 1.12 : 1), b.chestDepth * 0.88, 0],
    [b.hipY + b.legRadius * 0.4, b.hipHalf * (loose ? 1.18 : 1.04), b.chestDepth * 0.95, -b.chestDepth * 0.04],
  ];
  const outline = (rows: [number, number, number, number][]) => {
    const left: Point[] = [];
    const right: Point[] = [];
    for (const [y, half, depth, forward] of rows) {
      const [cx, cy] = screen(torso([0, y, forward]));
      const width = Math.hypot(half * Math.cos(pose.yaw), depth * Math.sin(pose.yaw));
      left.push([cx - width, cy]);
      right.push([cx + width, cy]);
    }
    return [...left, ...right.reverse()];
  };
  // Điểm trên bề mặt thân (u = 0 là chính giữa ngực) và mức hướng về máy quay, để ẩn chi tiết khi bị khuất.
  const surface = (u: number, y: number): [Point, number] => {
    let row = sections[0]!;
    for (const item of sections) if (Math.abs(item[0] - y) < Math.abs(row[0] - y)) row = item;
    const point = torso([row[1] * Math.sin(u), y, row[2] * Math.cos(u) + row[3]]);
    return [screen(point), Math.cos(u + pose.yaw * (row[1] / Math.max(1, row[2])) ** 0)];
  };
  parts.push({
    depth: 0,
    draw: () => {
      if (!skirt && !tunic) {
        // Cạp quần lộ dưới vạt áo.
        const band = smoothPath(outline([[b.hipY - b.legRadius * 0.3, b.hipHalf * 0.98, b.chestDepth * 0.9, 0], [b.hipY + b.legRadius * 1.2, b.hipHalf * 0.98, b.chestDepth * 0.92, 0]]));
        shade(outfit.bottom, band, b.hipHalf * 0.3);
      }
      shade(outfit.top, smoothPath(outline(sections)), b.shoulderHalf * 0.35, 0.25);
      // Nếp áo: đường cong nhẹ dưới nách và ngang eo.
      ctx.lineWidth = line * 0.5;
      ctx.strokeStyle = mixColor(lineColor(outfit.top), outfit.top, 0.45);
      for (const u of [-1.1, 1.1]) {
        const [a, facing] = surface(u, b.shoulderY + (b.hipY - b.shoulderY) * 0.35);
        const [c] = surface(u * 0.8, b.shoulderY + (b.hipY - b.shoulderY) * 0.62);
        if (facing < 0.15) continue;
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.quadraticCurveTo(a[0] + (c[0] - a[0]) * 0.2, (a[1] + c[1]) / 2, ...c);
        ctx.stroke();
      }
      const [top, topFacing] = surface(0.04, b.shoulderY + b.armRadius);
      if ((outfit.style === "jacket" || outfit.style === "aoBaBa" || outfit.style === "shirt") && topFacing > 0.05) {
        // Đường nẹp và hàng khuy giữa ngực.
        const [bottom] = surface(0.04, b.hipY);
        ctx.globalAlpha = smoothstep(0.05, 0.35, topFacing);
        ctx.beginPath();
        ctx.moveTo(...top);
        ctx.lineTo(...bottom);
        ctx.lineWidth = line * 0.6;
        ctx.strokeStyle = lineColor(outfit.top);
        ctx.stroke();
        for (let index = 1; index <= 3; index++) {
          const [button] = surface(0.12, b.shoulderY + (b.hipY - b.shoulderY) * (index / 4));
          ctx.beginPath();
          ctx.arc(button[0], button[1], b.palm * 0.1, 0, Math.PI * 2);
          ctx.fillStyle = outfit.style === "aoBaBa" ? "#3a3028" : outfit.accent;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (outfit.style === "aoDai" && topFacing > -0.3) {
        // Cổ đứng và đường cài chéo của áo dài.
        const [left] = surface(-0.4, b.shoulderY - b.armRadius * 0.3);
        const [right] = surface(0.4, b.shoulderY - b.armRadius * 0.3);
        const [slant] = surface(0.95, b.shoulderY + (b.hipY - b.shoulderY) * 0.3);
        ctx.beginPath();
        ctx.moveTo(...left);
        ctx.quadraticCurveTo((left[0] + right[0]) / 2, left[1] + b.armRadius * 0.7, ...right);
        ctx.moveTo(...right);
        ctx.quadraticCurveTo(right[0], slant[1] - b.armRadius, ...slant);
        ctx.lineWidth = line * 0.65;
        ctx.strokeStyle = lineColor(outfit.top);
        ctx.stroke();
      }
      if (outfit.style === "jacket" && topFacing > 0) {
        const [left] = surface(-0.32, b.shoulderY);
        const [right] = surface(0.32, b.shoulderY);
        const [tip] = surface(0, b.shoulderY + (b.hipY - b.shoulderY) * 0.32);
        ctx.beginPath();
        ctx.moveTo(...left);
        ctx.lineTo(...tip);
        ctx.lineTo(...right);
        ctx.lineWidth = line * 0.75;
        ctx.strokeStyle = lineColor(outfit.top);
        ctx.stroke();
      }
    },
  });

  // Váy, vạt áo dài trước/sau, áo choàng: tấm vải treo từ eo, lay theo quán tính.
  if (skirt) {
    const hem = b.hipY + b.thigh * 0.95;
    parts.push({
      depth: 0.5,
      draw: () => {
        const points = outline([
          [b.hipY - b.legRadius * 0.6, b.waistHalf, b.chestDepth * 0.9, 0],
          [(b.hipY + hem) / 2, b.hipHalf * 1.35, b.chestDepth * 1.25, 0],
          [hem, b.hipHalf * 1.7, b.chestDepth * 1.55, 0],
        ]);
        points[2] = [points[2]![0] + pose.flow[0] * 0.6, points[2]![1]];
        points[3] = [points[3]![0] + pose.flow[0] * 0.6, points[3]![1]];
        shade(outfit.top, smoothPath(points), b.hipHalf * 0.4, 0.2);
      },
    });
  }
  if (tunic) {
    const hem = outfit.style === "robe" ? -b.legRadius * 1.2 : b.hipY + b.thigh * 1.3;
    for (const sign of [1, -1] as const) {
      const facingFront = sign * Math.cos(pose.yaw);
      parts.push({
        depth: facingFront * b.chestDepth + (facingFront > 0 ? 0.2 : -b.chestDepth * 1.5),
        draw: () => {
          const top = screen(torso([0, b.hipY - b.legRadius * 0.4, sign * b.chestDepth * 0.85]));
          const bottom = screen([0, hem, sign * b.chestDepth * 1.25]);
          const topWidth = Math.hypot(b.waistHalf * 0.9 * Math.cos(pose.yaw), b.chestDepth * 0.25 * Math.sin(pose.yaw));
          const bottomWidth = Math.hypot(b.hipHalf * 1.05 * Math.cos(pose.yaw), b.chestDepth * 0.4 * Math.sin(pose.yaw));
          const drift = pose.flow[0] * (sign > 0 ? 0.8 : 1.2) - sign * Math.sin(pose.yaw) * pose.flow[1] * 0.2;
          const shape = smoothPath([
            [top[0] - topWidth, top[1]], [top[0] + topWidth, top[1]],
            [bottom[0] + bottomWidth + drift, bottom[1]], [bottom[0] + drift, bottom[1] + b.legRadius * 0.4], [bottom[0] - bottomWidth + drift, bottom[1]],
          ]);
          shade(sign > 0 ? outfit.top : darken(outfit.top, 0.07), shape, b.hipHalf * 0.4, 0.2);
        },
      });
    }
  }

  // --- Tay ---
  for (const side of ["left", "right"] as const) {
    const [shoulder, elbow, wrist] = [joints[`${side}Shoulder`]!, joints[`${side}Elbow`]!, joints[`${side}Wrist`]!];
    parts.push({
      depth: Math.max(depthOf(elbow), depthOf(wrist)) + (depthOf(shoulder) > 0 ? b.chestDepth * 0.2 : -b.chestDepth * 0.2),
      draw: () => {
        const [a, m, c] = [screen(shoulder), screen(elbow), screen(wrist)];
        if (shortSleeve) {
          const cut: Point = [a[0] + (m[0] - a[0]) * 0.55, a[1] + (m[1] - a[1]) * 0.55];
          const arm = new Path2D();
          capsule(arm, cut, m, b.armRadius * 0.9);
          capsule(arm, m, c, b.armRadius * 0.82);
          shade(character.skin, arm, b.armRadius * 0.5);
          const sleeve = new Path2D();
          capsule(sleeve, a, cut, b.armRadius * 1.15);
          shade(outfit.top, sleeve, b.armRadius * 0.5);
        } else {
          const radius = b.armRadius * (loose || tunic ? 1.12 : 1);
          const sleeve = new Path2D();
          capsule(sleeve, a, m, radius);
          capsule(sleeve, m, c, radius * 0.9);
          shade(outfit.top, sleeve, radius * 0.5);
        }
        const angle = Math.atan2(c[0] - m[0], c[1] - m[1]);
        const holding = pose.hold[side];
        if (holding && props[holding]) props[holding](ctx, c, -angle, character.scale, t, Math.sin(pose.yaw) < -0.05 ? -1 : 1);
        drawHand(ctx, character, c, angle, pose.hands[side], side, pose.yaw, lighting, line);
      },
    });
  }

  // --- Cổ, đầu, tóc ---
  const headYaw = pose.yaw + pose.headYaw;
  parts.push({
    depth: b.chestDepth * 0.25,
    draw: () => {
      const neck = new Path2D();
      capsule(neck, screen(torso([0, b.shoulderY, 0])), screen(joints.neck!), b.rx * (character.gender === "female" ? 0.36 : 0.44));
      shade(character.skin, neck, b.rx * 0.2);
      drawHead(ctx, character, pose, screen(headCenter), headYaw, lighting, line, t);
    },
  });
  // Tóc dài/đuôi ngựa phía sau là bộ phận riêng: nằm sau thân khi nhìn thẳng, phủ lưng khi quay lưng.
  if (character.hair.style === "long" || character.hair.style === "ponytail") {
    parts.push({
      depth: Math.cos(headYaw) < -0.2 ? b.chestDepth * 1.8 : -b.chestDepth * 1.6,
      draw: () => drawBackHair(ctx, character, pose, screen(headCenter), headYaw, lighting, line),
    });
  }

  // Họa sĩ: vẽ từ xa đến gần.
  parts.sort((a, c) => a.depth - c.depth);
  for (const part of parts) part.draw();
  ctx.restore();
}

function drawHand(ctx: SKRSContext2D, character: Character, wrist: Point, angle: number, shape: HandShape, side: "left" | "right", yaw: number, lighting: Lighting, line: number) {
  const p = character.body.palm;
  ctx.save();
  ctx.translate(wrist[0], wrist[1]);
  ctx.rotate(-angle);
  // Ngón cái nằm phía trong (về giữa thân); khi quay lưng thì đảo phía.
  const thumbSide = (side === "right" ? 1 : -1) * (Math.cos(yaw) >= 0 ? 1 : -1);
  const hand = new Path2D();
  const palmWidth = p * 0.86;
  hand.ellipse(0, p * 0.42, palmWidth / 2, p * 0.52, 0, 0, Math.PI * 2);
  const curls: Record<HandShape, number[]> = {
    relaxed: [0.3, 0.35, 0.4, 0.45], fist: [1, 1, 1, 1], open: [0, 0, 0, 0], point: [0, 1, 1, 1], grip: [0.7, 0.7, 0.7, 0.7], wave: [0, 0, 0, 0],
  };
  const spread = shape === "open" || shape === "wave" ? 1.7 : 1;
  curls[shape].forEach((curl, index) => {
    // Ngón khép sát nhau (đọc thành bàn tay liền khối ở cỡ nhỏ), chỉ tách khi xòe.
    const offset = (index - 1.5) * palmWidth * (spread > 1 ? 0.27 : 0.2) * thumbSide;
    const out = (index - 1.5) * 0.12 * (spread > 1 ? spread : 0.3) * thumbSide;
    const length = p * (index === 3 ? 0.55 : index === 0 ? 0.72 : 0.8) * (1 - curl * 0.62);
    const base: Point = [offset, p * 0.7];
    const tip: Point = [offset + Math.sin(out) * length - curl * thumbSide * p * 0.08, base[1] + Math.cos(out) * length - curl * p * 0.12];
    capsule(hand, base, tip, p * 0.16);
  });
  const thumbBase: Point = [-thumbSide * palmWidth * 0.4, p * 0.32];
  const thumbOut = shape === "fist" || shape === "point" ? 0.35 : shape === "open" || shape === "wave" ? 1.15 : 0.7;
  capsule(hand, thumbBase, [thumbBase[0] - thumbSide * Math.sin(thumbOut) * p * 0.55, thumbBase[1] + Math.cos(thumbOut) * p * 0.55], p * 0.145);
  paintShape(ctx, hand, character.skin, lighting, { depth: p * 0.22, line: line * 0.8, shadow: skinShadow(character.skin) });
  ctx.restore();
}

/** Toạ độ một điểm trên bề mặt elip của đầu: u kinh độ (0 = giữa mặt), v vĩ độ (+ lên trên). */
function headPoint(character: Character, u: number, v: number, lift = 1): V3 {
  const { rx, ry, rz } = character.body;
  return [rx * Math.sin(u) * Math.cos(v) * lift, -ry * Math.sin(v) * lift, rz * Math.cos(u) * Math.cos(v) * lift];
}

type Projector = (u: number, v: number, lift?: number) => [number, number, number];

function drawHead(ctx: SKRSContext2D, character: Character, pose: Pose, center: Point, yaw: number, lighting: Lighting, line: number, t: number) {
  const { rx, ry, rz } = character.body;
  const pitch = pose.headPitch;
  const project = (p: V3): [number, number, number] => {
    // Gật đầu (pitch) quanh trục ngang, quay (yaw) quanh trục đứng, nghiêng (roll) trong mặt phẳng ảnh.
    const y = p[1] * Math.cos(pitch) - p[2] * Math.sin(pitch);
    const z = p[2] * Math.cos(pitch) + p[1] * Math.sin(pitch);
    const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
    const x = p[0] * c + z * s;
    return [center[0] + x * Math.cos(pose.headRoll) - y * Math.sin(pose.headRoll), center[1] + x * Math.sin(pose.headRoll) + y * Math.cos(pose.headRoll), z * c - p[0] * s];
  };
  const at: Projector = (u, v, lift = 1) => project(headPoint(character, u, v, lift));
  const facing = (u: number, v: number) => Math.cos(v) * Math.cos(u + yaw);
  const width = Math.hypot(rx * Math.cos(yaw), rz * Math.sin(yaw));
  const skin = character.skin;

  // Tai: tai phía xa vẽ trước đầu, tai phía gần vẽ sau.
  const ear = (u: number, near: boolean) => {
    const [x, y, depth] = at(u, -0.02, 1.0);
    const side = Math.abs(Math.sin(u + yaw));
    if ((depth >= 0) !== near || side < 0.2 || hairline(character.hair.style, u) < -0.05) return;
    const shape = new Path2D();
    shape.ellipse(x, y, rx * (0.08 + 0.12 * side), ry * 0.24, pose.headRoll, 0, Math.PI * 2);
    paintShape(ctx, shape, skin, lighting, { depth: 2, line: line * 0.85, shadow: skinShadow(skin) });
    if (near && side > 0.5) {
      // Vành tai trong: một nét cong hở về phía mặt.
      const toward = Math.sign(Math.sin(u + yaw));
      ctx.beginPath();
      ctx.ellipse(x - toward * rx * 0.02, y, rx * 0.11 * side, ry * 0.15, pose.headRoll, toward > 0 ? Math.PI * 0.6 : -Math.PI * 0.4, toward > 0 ? Math.PI * 1.6 : Math.PI * 0.6);
      ctx.lineWidth = line * 0.6;
      ctx.strokeStyle = mixColor(lineColor(skin), skin, 0.4);
      ctx.stroke();
    }
  };
  ear(Math.PI / 2, false);
  ear(-Math.PI / 2, false);

  // Khối đầu = elip + hàm cằm + sống mũi (khi quay nghiêng, mũi và cằm tự nhô khỏi đường viền).
  const head = new Path2D();
  head.ellipse(center[0], center[1], width, ry, pose.headRoll, 0, Math.PI * 2);
  smoothPath([at(-1.3, -0.25), at(-0.8, -0.62), at(0, -0.9, 1.03), at(0.8, -0.62), at(1.3, -0.25), at(0, 0)].map(([x, y]) => [x, y] as Point), true, head);
  if (Math.abs(Math.sin(yaw)) > 0.3) {
    const tip = project([0, ry * 0.22, rz * 1.17]);
    smoothPath([at(0, 0.14), [tip[0], tip[1] - ry * 0.04], [tip[0], tip[1]], at(0, -0.3), at(0, -0.1, 0.9)].map(([x, y]) => [x, y] as Point), true, head);
  }
  paintShape(ctx, head, skin, lighting, { depth: rx * 0.2, line, highlight: 0.35, shadow: skinShadow(skin) });

  // Nét mặt được cắt theo khối đầu: mắt phía xa trượt qua gò má thì tự khuất.
  ctx.save();
  ctx.clip(head);
  const [inner, outer] = brows[pose.expression];
  const [lidTop, lidBottom] = lids[pose.expression];
  const wide = pose.expression === "surprised" || pose.expression === "scared";
  for (const u of [-0.46, 0.46]) {
    const v = -0.04;
    const f = facing(u, v);
    if (f <= 0.02) continue;
    ctx.globalAlpha = smoothstep(0.02, 0.3, f);
    const [x, y] = at(u, v);
    const squeeze = Math.max(0.18, Math.cos(u + yaw));
    const eyeW = rx * 0.27 * squeeze * (wide ? 1.08 : 1);
    const eyeH = ry * 0.23 * (wide ? 1.15 : 1);
    const closed = Math.min(1, lidTop + pose.blink * (1 - lidTop));
    // Mắt hình hạnh nhân: khóe trong thấp, đuôi mắt hơi xếch; mí trên cong cao, mí dưới phẳng. Chớp/sụp mí = hạ đường mí trên.
    const outward = Math.sign(u) || 1;
    const innerCorner: Point = [x - outward * eyeW, y + eyeH * 0.12];
    const outerCorner: Point = [x + outward * eyeW, y - eyeH * 0.08];
    const topY = y - eyeH * 1.3 + (eyeH * 1.95) * closed;
    const bottomY = y + eyeH * (0.95 - lidBottom * 0.9);
    const opening = new Path2D();
    opening.moveTo(...innerCorner);
    opening.bezierCurveTo(x - outward * eyeW * 0.45, topY, x + outward * eyeW * 0.45, topY, ...outerCorner);
    opening.bezierCurveTo(x + outward * eyeW * 0.4, bottomY, x - outward * eyeW * 0.45, bottomY, ...innerCorner);
    opening.closePath();
    if (closed < 0.95) {
      ctx.save();
      ctx.clip(opening);
      const white = ctx.createLinearGradient(x, y - eyeH, x, y + eyeH);
      white.addColorStop(0, "#d9d2e4");
      white.addColorStop(0.5, "#fbf8f4");
      ctx.fillStyle = white;
      ctx.fillRect(x - eyeW * 1.2, y - eyeH * 1.5, eyeW * 2.4, eyeH * 3);
      // Mống mắt chuyển sắc (tối phía trên vì mí đổ bóng), đồng tử, hai điểm sáng cố định theo nguồn sáng.
      const irisR = eyeH * 0.7;
      const ix = x + pose.look[0] * eyeW * 0.45 + Math.sin(yaw + u * 0.3) * eyeW * 0.12;
      const iy = y + pose.look[1] * eyeH * 0.3 + eyeH * 0.05;
      const iris = ctx.createLinearGradient(ix, iy - irisR, ix, iy + irisR);
      iris.addColorStop(0, darken(character.eyes, 0.55));
      iris.addColorStop(1, lighten(character.eyes, 0.3));
      ctx.beginPath();
      ctx.ellipse(ix, iy, irisR * squeeze, irisR, 0, 0, Math.PI * 2);
      ctx.fillStyle = iris;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(ix, iy, irisR * 0.45 * squeeze, irisR * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#120c0a";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(ix + lighting.dir[0] * irisR * 0.38, iy + lighting.dir[1] * irisR * 0.38, irisR * 0.26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha *= 0.6;
      ctx.beginPath();
      ctx.arc(ix - lighting.dir[0] * irisR * 0.32, iy - lighting.dir[1] * irisR * 0.3, irisR * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Đường mi trên đậm, thon dần về khóe trong; mí dưới mảnh, chỉ nửa ngoài.
    ctx.lineCap = "round";
    ctx.strokeStyle = "#2a1d1c";
    ctx.beginPath();
    ctx.moveTo(...innerCorner);
    ctx.bezierCurveTo(x - outward * eyeW * 0.45, topY, x + outward * eyeW * 0.45, topY, ...outerCorner);
    ctx.lineWidth = line * (closed >= 0.95 ? 1.0 : 1.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(outerCorner[0], outerCorner[1]);
    ctx.quadraticCurveTo(outerCorner[0] + outward * eyeW * 0.18, outerCorner[1] - eyeH * 0.12, outerCorner[0] + outward * eyeW * 0.26, outerCorner[1] - eyeH * 0.3);
    ctx.lineWidth = line * 1.1;
    ctx.stroke();
    if (closed < 0.95) {
      ctx.beginPath();
      ctx.moveTo(x, bottomY - eyeH * 0.05);
      ctx.quadraticCurveTo(x + outward * eyeW * 0.6, bottomY, ...outerCorner);
      ctx.lineWidth = line * 0.45;
      ctx.strokeStyle = mixColor("#2a1d1c", skin, 0.45);
      ctx.stroke();
      ctx.strokeStyle = "#2a1d1c";
    }
    if (character.gender === "female" && squeeze > 0.45 && closed < 0.9) {
      for (const k of [0, 1]) {
        const base: Point = [x + outward * eyeW * (0.55 + k * 0.32), topY * 0.25 + y * 0.75 - eyeH * (0.62 - k * 0.3)];
        ctx.beginPath();
        ctx.moveTo(...base);
        ctx.quadraticCurveTo(base[0] + outward * eyeW * 0.15, base[1] - eyeH * 0.25, base[0] + outward * eyeW * 0.32, base[1] - eyeH * 0.3);
        ctx.lineWidth = line * 0.7;
        ctx.stroke();
      }
    }
    // Lông mày: đầu trong nâng = buồn/lo, hạ = giận.
    const near = u < 0 ? -1 : 1;
    const [bx, by] = at(u, 0.32);
    ctx.beginPath();
    ctx.moveTo(bx - near * eyeW * 0.95, by + inner * ry);
    ctx.quadraticCurveTo(bx, by - ry * 0.05 + (inner + outer) * ry / 2, bx + near * eyeW * 1.05, by + outer * ry + ry * 0.03);
    ctx.lineWidth = ry * (character.gender === "female" ? 0.065 : 0.095);
    ctx.strokeStyle = darken(character.hair.color === "#d9d5cc" ? "#a8a196" : character.hair.color, 0.1);
    ctx.stroke();
    if (character.glasses) {
      ctx.beginPath();
      ctx.ellipse(x, y, eyeW * 1.55, eyeH * 1.35, 0, 0, Math.PI * 2);
      ctx.lineWidth = line * 0.9;
      ctx.strokeStyle = "#2a2220";
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  if (character.glasses && facing(0, 0) > 0.15) {
    const [l, r] = [at(-0.22, -0.04), at(0.22, -0.04)];
    ctx.beginPath();
    ctx.moveTo(l[0], l[1]);
    ctx.lineTo(r[0], r[1]);
    ctx.lineWidth = line * 0.9;
    ctx.strokeStyle = "#2a2220";
    ctx.stroke();
  }
  // Mũi nhìn chính diện: một vệt bóng nhỏ phía khuất sáng.
  if (facing(0, -0.2) > 0.45) {
    const [nx, ny] = at(0.05, -0.27);
    const away = lighting.dir[0] > 0 ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(nx + away * rx * 0.03, ny - ry * 0.22);
    ctx.quadraticCurveTo(nx + away * rx * 0.11, ny, nx, ny + ry * 0.04);
    ctx.lineWidth = line * 0.75;
    ctx.strokeStyle = mixColor(lineColor(skin), skin, 0.35);
    ctx.stroke();
  }
  // Má hồng.
  if (character.age === "child" || character.gender === "female" || pose.expression === "happy" || pose.expression === "tender") {
    for (const u of [-0.75, 0.75]) {
      if (facing(u, -0.3) < 0.1) continue;
      const [x, y] = at(u, -0.3);
      const blush = ctx.createRadialGradient(x, y, 0, x, y, rx * 0.22);
      blush.addColorStop(0, "rgba(235,110,110,0.32)");
      blush.addColorStop(1, "rgba(235,110,110,0)");
      ctx.fillStyle = blush;
      ctx.fillRect(x - rx * 0.3, y - rx * 0.3, rx * 0.6, rx * 0.6);
    }
  }
  drawMouth(ctx, character, pose, at, facing, yaw, line);
  if (pose.tears > 0) {
    for (const u of [-0.46, 0.46]) {
      if (facing(u, -0.1) < 0.1) continue;
      const [x, y] = at(u, -0.22);
      ctx.fillStyle = `rgba(160,210,255,${Math.min(0.9, pose.tears)})`;
      ctx.beginPath();
      ctx.ellipse(x, y + ((pose.tears * 30 + t * 18) % (ry * 0.5)), rx * 0.035, ry * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  drawBeard(ctx, character, at, facing, lighting, line);
  ear(Math.PI / 2, true);
  ear(-Math.PI / 2, true);
  drawHairCap(ctx, character, pose, center, yaw, at, lighting, line);
  drawHat(ctx, character, pose, center, yaw, at, lighting, line);
}

export const visemeShapes: Record<Viseme, { w: number; h: number; teeth: number; tongue: number; round: number }> = {
  X: { w: 0.8, h: 0, teeth: 0, tongue: 0, round: 0 },
  A: { w: 0.72, h: 0, teeth: 0, tongue: 0, round: 0 },
  B: { w: 0.9, h: 0.3, teeth: 1, tongue: 0, round: 0 },
  C: { w: 0.95, h: 0.58, teeth: 0.6, tongue: 0.3, round: 0 },
  D: { w: 1, h: 1, teeth: 0.6, tongue: 0.5, round: 0 },
  E: { w: 0.72, h: 0.62, teeth: 0.3, tongue: 0.3, round: 0.5 },
  F: { w: 0.45, h: 0.4, teeth: 0, tongue: 0, round: 1 },
  G: { w: 0.85, h: 0.24, teeth: 1, tongue: 0, round: 0 },
  H: { w: 0.92, h: 0.64, teeth: 0.5, tongue: 1, round: 0 },
};

function drawMouth(ctx: SKRSContext2D, character: Character, pose: Pose, at: Projector, facing: (u: number, v: number) => number, yaw: number, line: number) {
  const { rx, ry } = character.body;
  if (facing(0, -0.5) < -0.3) return;
  const smile = smiles[pose.expression];
  const shape = visemeShapes[pose.viseme] ?? visemeShapes.X;
  const open = shape.h === 0 ? 0 : Math.max(0.2, pose.mouth) * shape.h;
  const [cx, cy] = at(0, -0.52);
  const squeeze = Math.max(0.3, Math.cos(yaw));
  const half = rx * 0.34 * shape.w * squeeze * (1 + smile * 0.08);
  const depth = ry * 0.3 * open;
  const ink = mixColor(lineColor(character.skin), "#3a1a18", 0.5);
  const corner = -smile * ry * 0.08;
  // Nhìn nghiêng quá ~60°: miệng thành hình nêm lệch về mép mặt.
  const profile = Math.abs(Math.sin(yaw)) > 0.86;
  const side = Math.sign(Math.sin(yaw)) || 1;
  const left = profile ? cx - side * half * 0.6 : cx - half;
  const right = profile ? cx + side * half * 0.15 : cx + half;
  if (open < 0.05) {
    ctx.beginPath();
    ctx.moveTo(left, cy + corner);
    ctx.quadraticCurveTo((left + right) / 2, cy + smile * ry * 0.1, right, cy + corner);
    ctx.lineWidth = line * (pose.viseme === "A" ? 1.15 : 0.95);
    ctx.lineCap = "round";
    ctx.strokeStyle = ink;
    ctx.stroke();
    return;
  }
  const mouth = new Path2D();
  const w = Math.abs(right - left) / 2;
  const mx = (left + right) / 2;
  const round = shape.round;
  mouth.moveTo(mx - w, cy + corner);
  mouth.bezierCurveTo(mx - w * (0.6 - round * 0.3), cy - depth * (0.3 + round * 0.4), mx + w * (0.6 - round * 0.3), cy - depth * (0.3 + round * 0.4), mx + w, cy + corner);
  mouth.bezierCurveTo(mx + w * (0.7 - round * 0.2), cy + depth * (1 + round * 0.2), mx - w * (0.7 - round * 0.2), cy + depth * (1 + round * 0.2), mx - w, cy + corner);
  mouth.closePath();
  ctx.fillStyle = "#4a1a1d";
  ctx.fill(mouth);
  ctx.save();
  ctx.clip(mouth);
  if (shape.teeth > 0) {
    ctx.fillStyle = "#f6efe6";
    ctx.fillRect(mx - w * 1.2, cy - depth * 0.6, w * 2.4, depth * (pose.viseme === "G" || pose.viseme === "B" ? 0.75 : 0.38) + ry * 0.03);
  }
  if (shape.tongue > 0) {
    ctx.fillStyle = "#c7646a";
    ctx.beginPath();
    ctx.ellipse(mx, cy + depth * (pose.viseme === "H" ? 0.25 : 0.9), w * 0.6, depth * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.lineWidth = line * 0.9;
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  ctx.stroke(mouth);
  if (pose.viseme === "G") {
    ctx.beginPath();
    ctx.moveTo(mx - w * 0.7, cy + depth * 0.55);
    ctx.quadraticCurveTo(mx, cy + depth * 0.2, mx + w * 0.7, cy + depth * 0.55);
    ctx.stroke();
  }
}

function drawBeard(ctx: SKRSContext2D, character: Character, at: Projector, facing: (u: number, v: number) => number, lighting: Lighting, line: number) {
  if (character.beard === "none") return;
  const color = character.hair.color;
  const visible = (points: [number, number, number][]) => points.filter(point => point[2] > -character.body.rz * 0.25).map(([x, y]) => [x, y] as Point);
  if (character.beard === "full") {
    const points = visible([at(-1.45, -0.05, 1.04), at(-1.1, -0.55, 1.08), at(-0.5, -0.95, 1.12), at(0, -1.12, 1.16), at(0.5, -0.95, 1.12), at(1.1, -0.55, 1.08), at(1.45, -0.05, 1.04), at(0.7, -0.62, 1.02), at(0, -0.74, 1.02), at(-0.7, -0.62, 1.02)]);
    if (points.length > 3) paintShape(ctx, smoothPath(points), color, lighting, { depth: 3, line: line * 0.8 });
  }
  if (character.beard === "goatee") {
    const points = visible([at(-0.2, -0.7, 1.02), at(-0.15, -0.9, 1.06), at(0, -1.02, 1.08), at(0.15, -0.9, 1.06), at(0.2, -0.7, 1.02), at(0, -0.76, 1.03)]);
    if (points.length === 6) paintShape(ctx, smoothPath(points), color, lighting, { depth: 2, line: line * 0.7 });
  }
  if (facing(0, -0.4) > -0.2) {
    // Ria mép: hai nét cong thuôn hai bên nhân trung.
    for (const side of [-1, 1]) {
      const points = visible([at(side * 0.04, -0.4, 1.07), at(side * 0.22, -0.39, 1.06), at(side * 0.4, -0.47, 1.03), at(side * 0.2, -0.44, 1.05)]);
      if (points.length === 4) paintShape(ctx, smoothPath(points), color, lighting, { depth: 1.5, line: line * 0.6 });
    }
  }
}

/** Đường chân tóc theo kinh độ u: cao ở trán, thấp dần ra gáy; mỗi kiểu tóc một đường. */
function hairline(style: HairStyle, u: number) {
  const settings: Record<HairStyle, [number, number, number]> = {
    short: [0.6, 0.22, -0.42], sidePart: [0.58, 0.2, -0.42], long: [0.4, -0.08, -0.95], bun: [0.45, 0.2, -0.4],
    ponytail: [0.45, 0.2, -0.4], bald: [2, 2, 2], curly: [0.5, 0.16, -0.45], bob: [0.24, -0.55, -0.7],
  };
  const [front, side, back] = settings[style];
  const c = Math.cos(u);
  let v = c >= 0 ? side + (front - side) * c : side + (back - side) * -c;
  if (style === "sidePart") v -= Math.max(0, Math.sin(u)) * 0.18 * Math.max(0, c);
  if (style === "bob" && c > 0.3) v += Math.abs(Math.sin(u * 9)) * 0.05;
  return v;
}

function drawHairCap(ctx: SKRSContext2D, character: Character, pose: Pose, center: Point, yaw: number, at: Projector, lighting: Lighting, line: number) {
  const style = character.hair.style;
  const { rx, ry, rz } = character.body;
  const color = character.hair.color;
  if (style === "bald") {
    if (character.age !== "elder") return;
    // Vành tóc bạc hình móng ngựa quanh gáy, trên tai: mỏng dần về thái dương, mép dưới lởm chởm.
    // Chỉ lấy phần kinh độ thuộc nửa cầu nhìn thấy nên hai đầu dải nằm đúng trên đường viền đầu.
    // Đi một vòng liền từ thái dương này qua gáy sang thái dương kia; mỗi đoạn nhìn thấy liên tục là một mảng.
    const runs: [Point[], Point[]][] = [];
    let run: [Point[], Point[]] | undefined;
    for (let index = 0; index <= 60; index++) {
      const u = 1.2 + (Math.PI * 2 - 2.4) * (index / 60);
      if (Math.cos(u + yaw) < 0.02) {
        run = undefined;
        continue;
      }
      const k = 1 - Math.abs(u - Math.PI) / (Math.PI - 1.2);
      const thick = smoothstep(0, 0.4, k);
      const crown = 0.42 - 0.2 * smoothstep(0, 1, k);
      const [tx, ty] = at(u, crown, 1.03);
      const [bx, by] = at(u, crown - 0.34 * thick - 0.035 * thick * Math.abs(Math.sin(index * 1.6)), 1.06);
      if (!run) runs.push(run = [[], []]);
      run[0].push([tx, ty]);
      run[1].unshift([bx, by]);
    }
    for (const [top, bottom] of runs) {
      if (top.length > 2) paintShape(ctx, smoothPath([...top, ...bottom]), color, lighting, { depth: 2, line: line * 0.75 });
    }
    return;
  }
  const lift = style === "curly" ? 1.15 : 1.1;
  // Vùng tóc trên mặt cầu tham số (u, v) giao với nửa cầu đang nhìn thấy: đi dọc đường chân tóc giữa hai kinh tuyến biên
  // (hai kinh tuyến này chiếu đúng lên đường viền đầu), rồi theo kinh tuyến lên đỉnh đầu và quay xuống.
  const from = -yaw - Math.PI / 2;
  const to = -yaw + Math.PI / 2;
  const loop: Point[] = [];
  const steps = 72;
  for (let index = 0; index <= steps; index++) {
    const u = from + (to - from) * (index / steps);
    const edge = (Math.abs(index - steps / 2) / (steps / 2)) ** 4;
    // Mép tóc trước trán thành từng lọn nhọn (mái), không phải đường cắt trơn như mũ.
    const front = Math.max(0, Math.cos(u));
    const clump = style === "bob" ? 0 : Math.abs(Math.sin(u * 9 + 0.6)) ** 0.7 * (style === "short" || style === "sidePart" ? 0.035 : 0.07) * front;
    const [x, y] = at(u, hairline(style, u) - clump, 1.0 + (lift - 1) * edge);
    loop.push([x, y]);
  }
  for (const [u, down] of [[to, false], [from, true]] as const) {
    const base = hairline(style, u);
    for (let index = 1; index <= 10; index++) {
      const k = down ? 10 - index : index;
      const v = Math.min(base + (Math.PI / 2 - base) * (k / 10), Math.PI / 2 - 0.001);
      const bump = style === "curly" ? 1 + 0.05 * Math.sin(k * 2.4) : 1;
      const [x, y] = at(u, v, lift * bump);
      loop.push([x, y]);
    }
  }
  const region = smoothPath(loop);
  const width = Math.hypot(rx * Math.cos(yaw), rz * Math.sin(yaw)) * lift;
  if (style === "bob") {
    // Hai mảng tóc ngang cằm hai bên má.
    const sides = new Path2D();
    sides.ellipse(center[0], center[1] + ry * 0.2, width, ry * 0.85, pose.headRoll, 0, Math.PI * 2);
    const lower = new Path2D();
    lower.rect(center[0] - width * 2, center[1] - ry * 0.1, width * 4, ry * 1.2);
    ctx.save();
    ctx.clip(lower);
    paintShape(ctx, sides, color, lighting, { depth: rx * 0.3, line });
    ctx.restore();
  }
  paintShape(ctx, region, color, lighting, { depth: rx * 0.3, line });
  ctx.save();
  ctx.clip(region);
  // Sợi tóc: vài nét mảnh từ xoáy đỉnh đầu chảy xuống mép tóc, màu tối hơn, chỉ ở nửa nhìn thấy.
  ctx.lineCap = "round";
  ctx.strokeStyle = mixColor(color, lineColor(color), 0.55);
  ctx.lineWidth = line * 0.45;
  ctx.globalAlpha = 0.7;
  for (let strand = -3; strand <= 3; strand++) {
    const u = -yaw + strand * 0.38;
    if (Math.cos(u + yaw) < 0.25) continue;
    const base = hairline(style, u);
    const points = [0.85, 0.6, 0.35, 0.1].map(k => at(u + strand * 0.05 * (1 - k), base + 0.08 + (Math.PI / 2 - 0.2 - base) * k, lift * 1.01));
    ctx.beginPath();
    ctx.moveTo(points[0]![0], points[0]![1]);
    for (let index = 1; index < points.length - 1; index++) {
      const [a, b] = [points[index]!, points[index + 1]!];
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    ctx.stroke();
  }
  // Vòng sáng trên tóc (angel ring): các vệt đứt quãng theo một vĩ tuyến, lệch về phía nguồn sáng.
  ctx.strokeStyle = mixColor(color, "#ffffff", character.age === "elder" ? 0.4 : 0.3);
  ctx.globalAlpha = 0.65;
  const ring = random(hashSeed(character.id));
  for (let u = -yaw - 1.2 + lighting.dir[0] * 0.3; u < -yaw + 1.2 + lighting.dir[0] * 0.3;) {
    const length = 0.12 + ring() * 0.22;
    if (Math.cos(u + yaw) > 0.15 && Math.cos(u + length + yaw) > 0.15) {
      const v = 0.52 + ring() * 0.06;
      const [a, b, c] = [at(u, v, lift * 1.01), at(u + length / 2, v + 0.02, lift * 1.01), at(u + length, v, lift * 1.01)];
      ctx.lineWidth = ry * (0.035 + ring() * 0.03);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(b[0], b[1], c[0], c[1]);
      ctx.stroke();
    }
    u += length + 0.05 + ring() * 0.1;
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  if (style === "bun") {
    const [x, y] = at(Math.PI, 0.55, 1.28);
    const bun = new Path2D();
    bun.arc(x, y, rx * 0.42, 0, Math.PI * 2);
    paintShape(ctx, bun, color, lighting, { depth: 4, line });
  }
}

function drawBackHair(ctx: SKRSContext2D, character: Character, pose: Pose, center: Point, yaw: number, lighting: Lighting, line: number) {
  const { rx, ry, rz, shoulderY, hipY, headY } = character.body;
  const color = character.hair.color;
  const project = (p: V3): Point => [center[0] + p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), center[1] + p[1]];
  if (character.hair.style === "long") {
    const bottom = (shoulderY + hipY) / 2 - headY + ry * 0.2;
    const sway = pose.flow[0] * 0.8;
    const lower = (x: number, extra = 0): Point => { const point = project([x, bottom + extra, -rz * 0.9]); return [point[0] + sway, point[1]]; };
    // Mái tóc dài: thuôn dần, đuôi tóc tách thành các lọn nhọn đung đưa lệch pha nhau.
    const tips = [-0.72, -0.36, 0, 0.36, 0.72].flatMap((x, index): Point[] => {
      const tip = lower(rx * x * 1.05, ry * (0.12 + (index % 2) * 0.1));
      const notch = lower(rx * (x + 0.18) * 1.05, -ry * 0.12);
      tip[0] += sway * (0.15 + index * 0.06);
      return index < 4 ? [tip, notch] : [tip];
    });
    const points: Point[] = [
      project([-rx * 1.02, -ry * 0.35, -rz * 0.3]), project([rx * 1.02, -ry * 0.35, -rz * 0.3]),
      project([rx * 0.98, ry * 1.2, -rz * 0.55]), ...tips.reverse(), project([-rx * 0.98, ry * 1.2, -rz * 0.55]),
    ];
    const shape = smoothPath(points);
    paintShape(ctx, shape, color, lighting, { depth: rx * 0.3, line });
    ctx.save();
    ctx.clip(shape);
    ctx.strokeStyle = mixColor(color, lineColor(color), 0.5);
    ctx.lineWidth = line * 0.45;
    ctx.globalAlpha = 0.6;
    for (const x of [-0.5, -0.15, 0.2, 0.55]) {
      const [a, b] = [project([rx * x, ry * 0.9, -rz]), lower(rx * x * 0.9, -ry * 0.3)];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(a[0] + sway * 0.2 + rx * 0.05, (a[1] + b[1]) / 2, b[0], b[1]);
      ctx.stroke();
    }
    ctx.restore();
  } else if (character.hair.style === "ponytail") {
    const base = project([0, -ry * 0.25, -rz * 1.05]);
    const tip: Point = [base[0] - Math.sin(yaw) * rx * 0.5 + pose.flow[0], base[1] + ry * 1.6];
    const tail = smoothPath([[base[0] - rx * 0.22, base[1]], [base[0] + rx * 0.22, base[1]], [tip[0] + rx * 0.1, tip[1]], [tip[0] - rx * 0.12, tip[1] - ry * 0.1]]);
    paintShape(ctx, tail, color, lighting, { depth: 4, line });
  }
}

function drawHat(ctx: SKRSContext2D, character: Character, pose: Pose, center: Point, yaw: number, at: Projector, lighting: Lighting, line: number) {
  const { rx, ry, rz } = character.body;
  const color = character.hatColor;
  if (character.hat === "nonLa") {
    // Nón lá: vành tròn nhìn hơi từ trên xuống (elip dẹt) + chóp nón, có các vòng nan; quai nón khi nhìn thẳng.
    const radius = rx * 2.05;
    const brimY = center[1] - ry * 0.5;
    const apex: Point = [center[0] + Math.sin(pose.headRoll) * ry, brimY - ry * 1.3];
    const flat = radius * 0.17;
    const shape = new Path2D();
    shape.ellipse(center[0], brimY, radius, flat, pose.headRoll * 0.5, 0, Math.PI * 2);
    shape.moveTo(center[0] - radius * 0.98, brimY);
    shape.lineTo(...apex);
    shape.lineTo(center[0] + radius * 0.98, brimY);
    shape.closePath();
    paintShape(ctx, shape, color, lighting, { depth: rx * 0.6, line, highlight: 0.4 });
    ctx.lineWidth = line * 0.5;
    ctx.strokeStyle = mixColor(lineColor(color), color, 0.45);
    for (const k of [0.3, 0.56, 0.8]) {
      ctx.beginPath();
      ctx.ellipse(center[0] + (apex[0] - center[0]) * k, brimY + (apex[1] - brimY) * k, radius * (1 - k), flat * (1 - k), 0, 0, Math.PI);
      ctx.stroke();
    }
    // Quai nón: từ mép trong vành chạy dọc xương hàm, vòng dưới cằm; chỉ vẽ đoạn ở nửa đầu nhìn thấy.
    ctx.beginPath();
    let open = false;
    for (let index = 0; index <= 24; index++) {
      const s = index / 12 - 1;
      const u = 1.4 * s;
      const [x, y] = at(u, 0.2 - 1.2 * (1 - s * s) ** 0.55, 1.03);
      if (Math.cos(u + yaw) < 0.05) { open = false; continue; }
      if (open) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      open = true;
    }
    ctx.lineWidth = line * 0.55;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(70,45,35,0.55)";
    ctx.stroke();
  } else if (character.hat === "cap") {
    const cap = new Path2D();
    cap.ellipse(center[0], center[1] - ry * 0.3, Math.hypot(rx * Math.cos(yaw), rz * Math.sin(yaw)) * 1.07, ry * 0.8, pose.headRoll, Math.PI, Math.PI * 2);
    cap.closePath();
    const visor: Point[] = [];
    for (let index = 0; index <= 12; index++) {
      const angle = -Math.PI / 2 + (index / 12) * Math.PI;
      const p: V3 = [Math.sin(angle) * rx * 0.95, -ry * 0.34, Math.cos(angle) * rx * 0.95 + rx * 0.55];
      visor.push([center[0] + p[0] * Math.cos(yaw) + p[2] * Math.sin(yaw), center[1] + p[1] + (p[2] * Math.cos(yaw) - p[0] * Math.sin(yaw)) * 0.12]);
    }
    smoothPath(visor, true, cap);
    paintShape(ctx, cap, color, lighting, { depth: rx * 0.4, line, highlight: 0.3 });
  } else if (character.hat === "khanDong") {
    const width = Math.hypot(rx * Math.cos(yaw), rz * Math.sin(yaw)) * 1.1;
    const band = new Path2D();
    band.ellipse(center[0], center[1] - ry * 0.55, width, ry * 0.48, pose.headRoll, 0, Math.PI * 2);
    ctx.save();
    const clip = new Path2D();
    clip.rect(center[0] - width * 2, center[1] - ry * 2, width * 4, ry * 1.75);
    ctx.clip(clip);
    paintShape(ctx, band, color, lighting, { depth: rx * 0.3, line });
    ctx.lineWidth = line * 0.5;
    ctx.strokeStyle = lineColor(color);
    for (const k of [0.25, 0.5, 0.75]) {
      ctx.beginPath();
      ctx.ellipse(center[0], center[1] - ry * 0.95 + k * ry * 0.75, width * 0.98, ry * 0.18, pose.headRoll, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  } else if (character.hat === "beret") {
    const beret = new Path2D();
    beret.ellipse(center[0] - Math.sin(yaw) * rx * 0.2, center[1] - ry * 0.78, rx * 1.15, ry * 0.42, -0.12 + pose.headRoll, 0, Math.PI * 2);
    paintShape(ctx, beret, color, lighting, { depth: rx * 0.3, line, highlight: 0.3 });
  }
}
