import type { SKRSContext2D } from "@napi-rs/canvas";

export type Expression = "neutral" | "happy" | "sad" | "angry" | "surprised" | "scared" | "thinking" | "tender";
export type Viseme = "a" | "o" | "e" | "m";
export type HairStyle = "short" | "sidePart" | "long" | "bun" | "ponytail" | "bald" | "curly" | "bob";
export type OutfitStyle = "shirt" | "aoDai" | "aoBaBa" | "dress" | "jacket" | "robe";
export type HatStyle = "none" | "nonLa" | "cap" | "khanDong" | "beret";

export interface CharacterSpec {
  name: string;
  age?: "child" | "adult" | "elder";
  gender?: "male" | "female";
  build?: "slim" | "average" | "heavy";
  skin?: string;
  hair?: { style?: HairStyle; color?: string };
  beard?: "none" | "mustache" | "goatee" | "full";
  outfit?: { style?: OutfitStyle; top?: string; bottom?: string; accent?: string };
  hat?: HatStyle;
  hatColor?: string;
  glasses?: boolean;
  scale?: number;
  /** Giọng VieNeu-TTS, ví dụ "Thiện Minh". */
  voice?: string;
}

export interface Pose {
  x: number;
  y: number;
  facing: 1 | -1;
  lean: number;
  crouch: number;
  bob: number;
  breath: number;
  headTilt: number;
  armFront: [number, number];
  armBack: [number, number];
  legFront: [number, number];
  legBack: [number, number];
  expression: Expression;
  mouth: number;
  viseme: Viseme;
  blink: number;
  look: [number, number];
  hold: { front?: string; back?: string };
  tears: number;
}

export interface Character extends Required<Omit<CharacterSpec, "hair" | "outfit" | "voice" | "hatColor">> {
  id: string;
  voice?: string;
  hair: { style: HairStyle; color: string };
  outfit: { style: OutfitStyle; top: string; bottom: string; accent: string };
  hatColor: string;
  body: Body;
}

interface Body {
  height: number; hipY: number; shoulderY: number; headY: number; headRx: number; headRy: number;
  thigh: number; shin: number; upperArm: number; forearm: number; shoulderHalf: number; hipHalf: number;
  arm: number; leg: number;
}

const ink = "#2b2522";

export function createCharacter(id: string, spec: CharacterSpec): Character {
  const age = spec.age ?? "adult";
  const gender = spec.gender ?? "male";
  const build = spec.build ?? "average";
  const scale = spec.scale ?? 1;
  const width = build === "heavy" ? 1.3 : build === "slim" ? 0.88 : 1;
  const height = (age === "child" ? 225 : age === "elder" ? 318 : gender === "female" ? 322 : 336) * scale;
  const headRy = (age === "child" ? 38 : 40) * scale;
  const headRx = (age === "child" ? 34 : gender === "female" ? 33 : 35) * scale;
  const shoulderY = -(height - headRy * 2 - 10 * scale);
  const hipY = -height * (age === "child" ? 0.4 : 0.47);
  const legLength = -hipY - 6 * scale;
  const armLength = (shoulderY - hipY) * -1 * (age === "child" ? 1.05 : 1.15);
  const body: Body = {
    height, hipY, shoulderY, headY: shoulderY - 8 * scale - headRy * 0.92, headRx, headRy,
    thigh: legLength * 0.51, shin: legLength * 0.49, upperArm: armLength * 0.53, forearm: armLength * 0.47,
    shoulderHalf: (gender === "female" ? 27 : 32) * scale * width, hipHalf: (gender === "female" ? 28 : 26) * scale * width,
    arm: (age === "child" ? 13 : 15) * scale * Math.sqrt(width), leg: (age === "child" ? 16 : 19) * scale * Math.sqrt(width),
  };
  const defaultHair: HairStyle = age === "elder" && gender === "male" ? "bald" : gender === "female" ? "long" : "short";
  return {
    id, name: spec.name, age, gender, build, scale,
    skin: spec.skin ?? "#e9b98f",
    hair: { style: spec.hair?.style ?? defaultHair, color: spec.hair?.color ?? (age === "elder" ? "#d8d4cc" : "#1f1a17") },
    beard: spec.beard ?? "none",
    outfit: {
      style: spec.outfit?.style ?? "shirt",
      top: spec.outfit?.top ?? (gender === "female" ? "#c4544a" : "#4f6d8f"),
      bottom: spec.outfit?.bottom ?? "#3a3530",
      accent: spec.outfit?.accent ?? "#e8d9b0",
    },
    hat: spec.hat ?? "none",
    hatColor: spec.hatColor ?? "#e3cc8c",
    glasses: spec.glasses ?? false,
    voice: spec.voice,
    body,
  };
}

export function restPose(character: Character, x = 0): Pose {
  return {
    x, y: 0, facing: 1, lean: character.age === "elder" ? 0.1 : 0, crouch: 0, bob: 0, breath: 0, headTilt: 0,
    armFront: [0.08, -0.12], armBack: [-0.06, -0.1], legFront: [0.02, 0], legBack: [-0.02, 0],
    expression: "neutral", mouth: 0, viseme: "m", blink: 0, look: [0, 0], hold: {}, tears: 0,
  };
}

function shade(color: string, amount: number) {
  const value = Number.parseInt(color.slice(1), 16);
  const channel = (shift: number) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * amount)));
  return `rgb(${channel(16)},${channel(8)},${channel(0)})`;
}

type Point = [number, number];
const rotate = ([x, y]: Point, angle: number): Point => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
const add = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];

// Chi (tay/chân) hai đốt: góc 0 là buông thẳng xuống, góc dương xoay về phía trước mặt.
function limb(start: Point, first: number, second: number, angles: [number, number], base = 0): [Point, Point] {
  const middle = add(start, rotate([0, first], -(angles[0] + base)));
  return [middle, add(middle, rotate([0, second], -(angles[0] + angles[1] + base)))];
}

function stroke(ctx: SKRSContext2D, points: Point[], width: number, color: string) {
  ctx.beginPath();
  ctx.moveTo(...points[0]!);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = width + 5;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function blob(ctx: SKRSContext2D, draw: () => void, fill: string, line = 3.5) {
  ctx.beginPath();
  draw();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = ink;
  ctx.lineJoin = "round";
  ctx.stroke();
}

export interface CharacterAnchors { head: Point; top: number; feet: Point; hands: { front: Point; back: Point }; chest: Point }

/** Toạ độ thế giới của các điểm mốc, dùng cho máy quay và đạo cụ cầm tay. */
export function anchors(character: Character, pose: Pose): CharacterAnchors {
  const { body } = character;
  const sink = pose.crouch * -body.hipY;
  const hip: Point = [0, body.hipY + sink + pose.bob];
  const torso = (point: Point) => add(hip, rotate([point[0], point[1] - body.hipY], pose.lean));
  const shoulder = torso([4, body.shoulderY + 10]);
  const neck = torso([3, body.shoulderY - 4]);
  const head = add(neck, rotate([4, body.headY - body.shoulderY + 4], pose.lean * 0.5 + pose.headTilt));
  const front = limb(shoulder, body.upperArm, body.forearm, pose.armFront, pose.lean)[1];
  const back = limb(shoulder, body.upperArm, body.forearm, pose.armBack, pose.lean)[1];
  const world = ([x, y]: Point): Point => [pose.x + x * pose.facing, pose.y + y];
  return {
    head: world(head), top: pose.y + head[1] - body.headRy - (character.hat === "nonLa" ? 30 : 6), feet: world([0, 0]),
    hands: { front: world(front), back: world(back) }, chest: world(torso([0, (body.shoulderY + body.hipY) / 2])),
  };
}

const brows: Record<Expression, [number, number]> = {
  neutral: [0, 0], happy: [-2, -3], sad: [-5, 3], angry: [4, -3], surprised: [-7, -6], scared: [-6, 2], thinking: [-4, 1], tender: [-3, 1],
};
const smiles: Record<Expression, number> = {
  neutral: 0.1, happy: 1, sad: -0.8, angry: -0.6, surprised: 0, scared: -0.4, thinking: -0.1, tender: 0.6,
};

function drawFace(ctx: SKRSContext2D, character: Character, pose: Pose, head: Point) {
  const { headRx: rx, headRy: ry } = character.body;
  const s = character.scale;
  const forward = rx * 0.24;
  const [cx, cy] = head;
  const [inner, outer] = brows[pose.expression];
  const squint = pose.expression === "happy" || pose.expression === "tender" ? 0.35 : pose.expression === "angry" ? 0.25 : 0;
  const wide = pose.expression === "surprised" || pose.expression === "scared" ? 1.25 : 1;
  const eyes: [number, number][] = [[cx + forward - 12 * s, 6.2 * s], [cx + forward + 13 * s, 7 * s]];
  for (const [ex, size] of eyes) {
    const ey = cy + 1 * s;
    const open = Math.max(0.08, (1 - pose.blink) * (1 - squint)) * wide;
    ctx.beginPath();
    ctx.ellipse(ex, ey, size, size * 1.25 * open, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#fffaf2";
    ctx.fill();
    ctx.lineWidth = 2.2 * s;
    ctx.strokeStyle = ink;
    ctx.stroke();
    if (open > 0.2) {
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.arc(ex + (pose.look[0] * 2.4 + 1.2) * s, ey + pose.look[1] * 2.4 * s, size * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = "#2a1d17";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + (pose.look[0] * 2.4 + 2.4) * s, ey + (pose.look[1] * 2.4 - 1.6) * s, size * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.restore();
    }
    const near = ex > cx + forward;
    ctx.beginPath();
    const browY = ey - size * 1.9;
    ctx.moveTo(ex - size * 1.1, browY + (near ? inner : outer) * s);
    ctx.lineTo(ex + size * 1.1, browY + (near ? outer : inner) * s);
    ctx.lineWidth = 3.2 * s;
    ctx.lineCap = "round";
    ctx.strokeStyle = shade(character.hair.color === "#d8d4cc" ? "#9a958c" : character.hair.color, 1);
    ctx.stroke();
  }
  if (character.glasses) {
    ctx.lineWidth = 2.2 * s;
    ctx.strokeStyle = ink;
    for (const [ex] of eyes) {
      ctx.beginPath();
      ctx.arc(ex, cy + s, 10.5 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(eyes[0]![0] + 10 * s, cy);
    ctx.lineTo(eyes[1]![0] - 10 * s, cy);
    ctx.stroke();
  }
  // Mũi nhìn nghiêng 3/4 hướng về phía trước.
  ctx.beginPath();
  ctx.moveTo(cx + forward + 23 * s, cy + 5 * s);
  ctx.lineTo(cx + forward + 28 * s, cy + 15 * s);
  ctx.lineTo(cx + forward + 22 * s, cy + 16 * s);
  ctx.lineWidth = 2.2 * s;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(43,37,34,0.75)";
  ctx.stroke();
  if (character.age === "child" || character.gender === "female") {
    ctx.beginPath();
    ctx.ellipse(cx + forward + 18 * s, cy + 17 * s, 6 * s, 3.5 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(230,110,100,0.35)";
    ctx.fill();
  }
  const mx = cx + forward + 7 * s;
  const my = cy + 25 * s;
  const smile = smiles[pose.expression];
  const open = pose.mouth;
  if (open < 0.08) {
    ctx.beginPath();
    ctx.moveTo(mx - 8 * s, my - smile * 2 * s);
    ctx.quadraticCurveTo(mx, my + smile * 5 * s, mx + 8 * s, my - smile * 2 * s);
    ctx.lineWidth = 2.6 * s;
    ctx.strokeStyle = ink;
    ctx.stroke();
  } else {
    const [w, h] = pose.viseme === "o" ? [5.5, 3 + open * 8] : pose.viseme === "e" ? [9, 2 + open * 5] : pose.viseme === "m" ? [7, 1 + open * 2] : [8, 2.5 + open * 9];
    ctx.beginPath();
    ctx.ellipse(mx, my + h * 0.3 * s - smile * s, w * s, h * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#5a1f1c";
    ctx.fill();
    ctx.lineWidth = 2.2 * s;
    ctx.strokeStyle = ink;
    ctx.stroke();
    if (h > 5) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "#f4ece0";
      ctx.fillRect(mx - w * s, my - h * 0.7 * s - smile * s, w * 2 * s, h * 0.35 * s);
      ctx.restore();
    }
  }
  if (pose.tears > 0) {
    ctx.fillStyle = `rgba(150,200,255,${Math.min(1, pose.tears)})`;
    for (const [ex] of eyes) {
      ctx.beginPath();
      ctx.ellipse(ex + 2 * s, cy + (10 + ((pose.tears * 40) % 14)) * s, 2.2 * s, 3.4 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawHairBack(ctx: SKRSContext2D, character: Character, head: Point) {
  const { headRx: rx, headRy: ry, shoulderY, hipY } = character.body;
  const [cx, cy] = head;
  const color = character.hair.color;
  if (character.hair.style === "long") {
    const bottom = (shoulderY + hipY) / 2 + 20;
    blob(ctx, () => {
      ctx.moveTo(cx - rx * 0.9, cy - ry * 0.2);
      ctx.quadraticCurveTo(cx - rx * 1.25, bottom - 30, cx - rx * 0.9, bottom);
      ctx.quadraticCurveTo(cx - rx * 0.1, bottom + 10, cx + rx * 0.35, bottom - 25);
      ctx.lineTo(cx + rx * 0.2, cy);
    }, color);
  } else if (character.hair.style === "ponytail") {
    blob(ctx, () => {
      ctx.moveTo(cx - rx * 0.8, cy - ry * 0.55);
      ctx.quadraticCurveTo(cx - rx * 1.7, cy - ry * 0.2, cx - rx * 1.45, cy + ry * 1.3);
      ctx.quadraticCurveTo(cx - rx * 1.1, cy + ry * 0.4, cx - rx * 0.6, cy - ry * 0.2);
    }, color);
  } else if (character.hair.style === "bun") {
    blob(ctx, () => ctx.arc(cx - rx * 0.85, cy - ry * 0.72, rx * 0.42, 0, Math.PI * 2), color);
  } else if (character.hair.style === "bob") {
    blob(ctx, () => {
      ctx.moveTo(cx - rx * 1.08, cy - ry * 0.3);
      ctx.lineTo(cx - rx * 1.05, cy + ry * 0.75);
      ctx.quadraticCurveTo(cx - rx * 0.3, cy + ry * 0.95, cx + rx * 0.1, cy + ry * 0.7);
      ctx.lineTo(cx, cy);
    }, color);
  }
}

function drawHairFront(ctx: SKRSContext2D, character: Character, head: Point) {
  const { headRx: rx, headRy: ry } = character.body;
  const [cx, cy] = head;
  const color = character.hair.color;
  const style = character.hair.style;
  if (style === "bald") {
    if (character.age === "elder") {
      blob(ctx, () => {
        ctx.moveTo(cx - rx * 0.98, cy - ry * 0.15);
        ctx.quadraticCurveTo(cx - rx * 1.12, cy + ry * 0.25, cx - rx * 0.72, cy + ry * 0.35);
        ctx.quadraticCurveTo(cx - rx * 0.62, cy, cx - rx * 0.75, cy - ry * 0.35);
      }, color, 2.5);
    }
    return;
  }
  blob(ctx, () => {
    ctx.moveTo(cx - rx * 1.04, cy + ry * 0.15);
    ctx.bezierCurveTo(cx - rx * 1.25, cy - ry * 1.15, cx + rx * 0.7, cy - ry * 1.35, cx + rx * 0.98, cy - ry * 0.32);
    if (style === "sidePart" || style === "long" || style === "bob") {
      ctx.quadraticCurveTo(cx + rx * 0.3, cy - ry * 0.7, cx - rx * 0.15, cy - ry * 0.35);
    } else if (style === "curly") {
      for (let index = 0; index < 4; index++) ctx.arc(cx + rx * (0.65 - index * 0.38), cy - ry * (0.42 + (index % 2) * 0.08), rx * 0.2, 0, Math.PI, false);
    } else {
      ctx.quadraticCurveTo(cx + rx * 0.4, cy - ry * 0.55, cx + rx * 0.1, cy - ry * 0.45);
    }
    ctx.quadraticCurveTo(cx - rx * 0.45, cy - ry * 0.4, cx - rx * 0.55, cy + ry * 0.05);
    ctx.quadraticCurveTo(cx - rx * 0.75, cy + ry * 0.35, cx - rx * 1.04, cy + ry * 0.15);
  }, color);
}

function drawHat(ctx: SKRSContext2D, character: Character, head: Point) {
  const { headRx: rx, headRy: ry } = character.body;
  const [cx, cy] = head;
  const color = character.hatColor;
  if (character.hat === "nonLa") {
    blob(ctx, () => {
      ctx.moveTo(cx - rx * 2, cy - ry * 0.35);
      ctx.quadraticCurveTo(cx, cy - ry * 0.12, cx + rx * 2.05, cy - ry * 0.4);
      ctx.lineTo(cx + rx * 0.05, cy - ry * 1.85);
      ctx.closePath();
    }, color);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = shade(color, 0.75);
    for (const offset of [0.55, 1.05, 1.5]) {
      ctx.beginPath();
      ctx.moveTo(cx - rx * (2 - offset * 0.95), cy - ry * (0.35 + offset * 0.62));
      ctx.quadraticCurveTo(cx, cy - ry * (0.18 + offset * 0.6), cx + rx * (2.05 - offset * 0.98), cy - ry * (0.4 + offset * 0.62));
      ctx.stroke();
    }
  } else if (character.hat === "cap") {
    blob(ctx, () => {
      ctx.moveTo(cx - rx * 1.02, cy - ry * 0.25);
      ctx.bezierCurveTo(cx - rx, cy - ry * 1.35, cx + rx, cy - ry * 1.35, cx + rx * 1.02, cy - ry * 0.3);
      ctx.lineTo(cx + rx * 1.65, cy - ry * 0.22);
      ctx.lineTo(cx + rx * 1.0, cy - ry * 0.12);
      ctx.closePath();
    }, color);
  } else if (character.hat === "khanDong") {
    blob(ctx, () => ctx.ellipse(cx - rx * 0.05, cy - ry * 0.62, rx * 1.08, ry * 0.42, -0.08, 0, Math.PI * 2), color);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = shade(color, 0.7);
    for (const offset of [-0.2, 0.05, 0.3]) {
      ctx.beginPath();
      ctx.ellipse(cx - rx * 0.05, cy - ry * (0.62 + offset * 0.5), rx * 1.0, ry * 0.15, -0.08, 0, Math.PI);
      ctx.stroke();
    }
  } else if (character.hat === "beret") {
    blob(ctx, () => ctx.ellipse(cx - rx * 0.1, cy - ry * 0.78, rx * 1.12, ry * 0.4, -0.15, 0, Math.PI * 2), color);
  }
}

function drawBeard(ctx: SKRSContext2D, character: Character, head: Point) {
  if (character.beard === "none") return;
  const { headRx: rx, headRy: ry } = character.body;
  const [cx, cy] = head;
  const forward = rx * 0.24;
  const color = character.hair.color;
  if (character.beard === "full") {
    blob(ctx, () => {
      ctx.moveTo(cx - rx * 0.75, cy + ry * 0.2);
      ctx.quadraticCurveTo(cx - rx * 0.5, cy + ry * 1.25, cx + forward + rx * 0.3, cy + ry * 1.15);
      ctx.quadraticCurveTo(cx + forward + rx * 0.75, cy + ry * 0.75, cx + forward + rx * 0.7, cy + ry * 0.4);
      ctx.quadraticCurveTo(cx + forward, cy + ry * 0.75, cx - rx * 0.75, cy + ry * 0.2);
    }, color, 2.5);
  }
  if (character.beard === "goatee") {
    blob(ctx, () => {
      ctx.moveTo(cx + forward - rx * 0.05, cy + ry * 0.82);
      ctx.quadraticCurveTo(cx + forward + rx * 0.2, cy + ry * 1.55, cx + forward + rx * 0.4, cy + ry * 0.8);
    }, color, 2.2);
  }
  ctx.beginPath();
  ctx.moveTo(cx + forward - rx * 0.12, cy + ry * 0.52);
  ctx.quadraticCurveTo(cx + forward + rx * 0.25, cy + ry * 0.38, cx + forward + rx * 0.62, cy + ry * 0.55);
  ctx.lineWidth = 5 * character.scale;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.stroke();
}

export type PropDrawer = (ctx: SKRSContext2D, hand: Point, angle: number, scale: number, t: number) => void;

export function drawCharacter(ctx: SKRSContext2D, character: Character, pose: Pose, props: Record<string, PropDrawer>, t: number) {
  const { body, outfit, skin } = character;
  const s = character.scale;
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.scale(pose.facing, 1);
  // Bóng đổ dưới chân.
  ctx.beginPath();
  ctx.ellipse(0, 2, body.hipHalf * 2.1, 9 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fill();

  const sink = pose.crouch * -body.hipY;
  const hip: Point = [0, body.hipY + sink + pose.bob];
  const torsoPoint = (point: Point) => add(hip, rotate([point[0], point[1] - body.hipY], pose.lean));
  const shoulderFront = torsoPoint([body.shoulderHalf * 0.25, body.shoulderY + 10 * s]);
  const shoulderBack = torsoPoint([-body.shoulderHalf * 0.3, body.shoulderY + 10 * s]);
  const neck = torsoPoint([3 * s, body.shoulderY - 4 * s]);
  const head = add(neck, rotate([4 * s, body.headY - body.shoulderY + 4 * s], pose.lean * 0.5 + pose.headTilt));
  const legStart = (offset: number): Point => add(hip, [offset, 0]);
  const shortSleeve = outfit.style === "shirt" && character.gender === "male" && character.age !== "elder";
  const longTunic = outfit.style === "aoDai" || outfit.style === "robe";
  const skirt = outfit.style === "dress";
  const legColor = skirt ? skin : outfit.bottom;

  const drawLeg = (start: Point, angles: [number, number], darker: number) => {
    const [knee, foot] = limb(start, body.thigh, body.shin, angles);
    stroke(ctx, [start, knee, foot], body.leg, shade(legColor, darker));
    blob(ctx, () => ctx.ellipse(foot[0] + 7 * s, foot[1] + 1, 13 * s, 6.5 * s, 0, 0, Math.PI * 2), shade(skirt || character.age === "child" ? "#7a4a32" : "#2f2a27", darker), 2.5);
  };
  const drawArm = (start: Point, angles: [number, number], darker: number, holding?: string) => {
    const [elbow, hand] = limb(start, body.upperArm, body.forearm, angles, pose.lean);
    if (shortSleeve) {
      stroke(ctx, [start, elbow, hand], body.arm, shade(skin, darker));
      stroke(ctx, [start, add(start, rotate([0, body.upperArm * 0.55], -(angles[0] + pose.lean)))], body.arm + 3, shade(outfit.top, darker));
    } else {
      stroke(ctx, [start, elbow, hand], body.arm, shade(outfit.top, darker));
    }
    if (holding && props[holding]) props[holding](ctx, hand, angles[0] + angles[1] + pose.lean, s, t);
    blob(ctx, () => ctx.arc(hand[0], hand[1], body.arm * 0.62, 0, Math.PI * 2), shade(skin, darker), 2.5);
  };

  drawArm(shoulderBack, pose.armBack, 0.78, pose.hold.back);
  drawLeg(legStart(-4 * s), pose.legBack, 0.8);
  drawHairBack(ctx, character, head);

  // Thân áo.
  const top = body.shoulderY + 4 * s;
  const tunicBottom = longTunic ? body.hipY + body.thigh * 1.05 : skirt ? body.hipY + body.thigh * 0.85 : body.hipY + 14 * s;
  if (!longTunic && !skirt) {
    blob(ctx, () => {
      const [a, b] = [torsoPoint([-body.hipHalf, body.hipY - 4 * s]), torsoPoint([body.hipHalf, body.hipY - 4 * s])];
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineTo(b[0] + 2, b[1] + 16 * s);
      ctx.lineTo(a[0] - 2, a[1] + 16 * s);
      ctx.closePath();
    }, outfit.bottom);
  }
  drawLeg(legStart(5 * s), pose.legFront, 1);
  blob(ctx, () => {
    const points: Point[] = [
      [-body.shoulderHalf, top + 10 * s], [-body.shoulderHalf * 0.7, top], [body.shoulderHalf * 0.7, top], [body.shoulderHalf, top + 10 * s],
      [body.hipHalf * (skirt ? 1.6 : 1.05), skirt ? tunicBottom : body.hipY + 6 * s], [-body.hipHalf * (skirt ? 1.6 : 1.05), skirt ? tunicBottom : body.hipY + 6 * s],
    ];
    const [first, ...rest] = points.map(torsoPoint);
    ctx.moveTo(...first!);
    for (const point of rest) ctx.lineTo(...point);
    ctx.closePath();
  }, outfit.top);
  if (longTunic) {
    // Hai vạt áo dài bay nhẹ theo thời gian.
    const sway = Math.sin(t * 2.1 + pose.x * 0.01) * 4 * s;
    for (const side of [-1, 1]) {
      blob(ctx, () => {
        const a = torsoPoint([side * body.hipHalf * 0.15, body.hipY]);
        const b = torsoPoint([side * body.hipHalf * 1.05, body.hipY]);
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.quadraticCurveTo(b[0] + side * 4 * s + sway, (b[1] + tunicBottom) / 2, b[0] + side * 8 * s + sway, tunicBottom);
        ctx.lineTo(a[0] + sway, tunicBottom - 4 * s);
        ctx.closePath();
      }, shade(outfit.top, side < 0 ? 0.88 : 1));
    }
  }
  if (outfit.style === "jacket" || outfit.style === "aoBaBa") {
    ctx.beginPath();
    const a = torsoPoint([body.shoulderHalf * 0.15, top + 2 * s]);
    const b = torsoPoint([body.hipHalf * 0.3, body.hipY + 4 * s]);
    ctx.moveTo(...a);
    ctx.lineTo(...b);
    ctx.lineWidth = 2.5 * s;
    ctx.strokeStyle = shade(outfit.top, 0.6);
    ctx.stroke();
    for (let index = 1; index <= 3; index++) {
      const button = torsoPoint([body.shoulderHalf * 0.3, top + (body.hipY - top) * index / 4]);
      ctx.beginPath();
      ctx.arc(button[0], button[1], 2.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = outfit.accent;
      ctx.fill();
    }
  }
  if (outfit.style === "aoDai") {
    ctx.beginPath();
    const collar = torsoPoint([body.shoulderHalf * 0.2, top - 2 * s]);
    ctx.moveTo(collar[0] - 6 * s, collar[1]);
    ctx.quadraticCurveTo(collar[0] + 6 * s, collar[1] + 16 * s, collar[0] + 16 * s, collar[1] + 22 * s);
    ctx.lineWidth = 2.4 * s;
    ctx.strokeStyle = shade(outfit.top, 0.7);
    ctx.stroke();
  }

  // Cổ và đầu.
  stroke(ctx, [neck, add(neck, rotate([0, -10 * s], pose.lean))], 14 * s, skin);
  const { headRx: rx, headRy: ry } = body;
  blob(ctx, () => ctx.ellipse(head[0] - rx * 0.62, head[1] + ry * 0.12, rx * 0.2, ry * 0.26, 0, 0, Math.PI * 2), shade(skin, 0.92), 2.5);
  blob(ctx, () => ctx.ellipse(head[0], head[1], rx, ry, 0, 0, Math.PI * 2), skin);
  drawBeard(ctx, character, head);
  drawFace(ctx, character, pose, head);
  drawHairFront(ctx, character, head);
  drawHat(ctx, character, head);
  drawArm(shoulderFront, pose.armFront, 1, pose.hold.front);
  ctx.restore();
}
