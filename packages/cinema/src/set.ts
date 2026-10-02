import type { SKRSContext2D } from "@napi-rs/canvas";
import { random } from "./motion";
import { darken, mixColor, type Lighting } from "./rig/paint";

export type TimeOfDay = "dawn" | "morning" | "noon" | "golden" | "dusk" | "night" | "overcast";
export type Weather = "none" | "mist" | "rain" | "snow" | "fireflies" | "petals" | "leaves";
export type Ambience = "none" | "river" | "wind" | "rain" | "night" | "room" | "sea" | "forest" | "market";

export interface ElementSpec {
  type: string;
  id?: string;
  x?: number;
  y?: number;
  depth?: number;
  scale?: number;
  width?: number;
  color?: string;
  seed?: number;
  flip?: boolean;
  /** Vẽ đè lên nhân vật (ví dụ mạn thuyền, cỏ tiền cảnh). */
  front?: boolean;
  /** type "path": dữ liệu SVG path do agent tự vẽ, toạ độ gốc ở chân vật thể. */
  path?: string;
  fill?: string;
  stroke?: string;
  /** type "sign": chữ trên biển hiệu. */
  text?: string;
}

export interface SetSpec {
  width?: number;
  time?: TimeOfDay;
  ground?: "grass" | "dirt" | "sand" | "wood" | "tile" | "stone" | "none";
  groundColor?: string;
  /** Nội thất: tường và sàn thay cho bầu trời. */
  interior?: { wall?: string; floor?: string };
  elements?: ElementSpec[];
  weather?: Weather;
  ambience?: Ambience;
}

/** lift/gain: chỉnh màu kiểu lift–gain của phòng màu: lift nâng vùng tối về một màu (đen mờ có sắc), gain nhuộm vùng sáng. */
export interface Palette { sky: [string, string, string]; haze: string; tint: string; tintAlpha: number; dark: number; sun?: [number, number, string]; lift: string; gain: string }

export const palettes: Record<TimeOfDay, Palette> = {
  dawn: { sky: ["#34406e", "#c68ca0", "#f7c894"], haze: "#e9c3ad", tint: "#ff9e7a", tintAlpha: 0.16, dark: 0.08, sun: [0.72, -260, "#ffe2b0"] , lift: "#241c3a", gain: "#fff0e2" },
  morning: { sky: ["#5f9fd8", "#a9d2f0", "#e4f2f8"], haze: "#d6e8f2", tint: "#fff3d6", tintAlpha: 0.08, dark: 0, sun: [0.8, -640, "#fff6d8"] , lift: "#0e1a24", gain: "#fffaf0" },
  noon: { sky: ["#3f87d4", "#88c2ef", "#cfe9fb"], haze: "#cfe3f1", tint: "#ffffff", tintAlpha: 0, dark: 0, sun: [0.55, -820, "#ffffff"] , lift: "#0a0f14", gain: "#ffffff" },
  golden: { sky: ["#5c6aa8", "#e79a6a", "#ffcf7d"], haze: "#f2bf8c", tint: "#ff9f43", tintAlpha: 0.22, dark: 0.05, sun: [0.25, -300, "#ffd98a"] , lift: "#2a1828", gain: "#ffe8c4" },
  dusk: { sky: ["#232650", "#9a4f78", "#ec8a62"], haze: "#b07386", tint: "#8a4fb0", tintAlpha: 0.2, dark: 0.22, sun: [0.15, -170, "#ffb07a"] , lift: "#1c1638", gain: "#ffdccc" },
  night: { sky: ["#070b1f", "#14204a", "#2a3a6c"], haze: "#25345e", tint: "#2a3f8f", tintAlpha: 0.42, dark: 0.45, sun: [0.75, -760, "#f4f1de"] , lift: "#06142a", gain: "#cfdcff" },
  overcast: { sky: ["#7f8b98", "#a9b3bd", "#cdd3d9"], haze: "#b9c1c8", tint: "#9aa7b4", tintAlpha: 0.15, dark: 0.12, lift: "#182028", gain: "#eef2f6" },
};

/** Ánh sáng chiếu lên nhân vật theo giờ trong ngày: hướng từ vị trí mặt trời, màu bóng lấy từ bầu trời, nắng thấp thì có viền sáng. */
export function lightingFor(set: SetSpec): Lighting {
  const time = set.time ?? "morning";
  if (set.interior) return { dir: [0.55, -0.83], shade: "#5a3d4a", strength: 0.34 };
  const palette = palettes[time];
  const strength = { dawn: 0.38, morning: 0.32, noon: 0.34, golden: 0.42, dusk: 0.46, night: 0.5, overcast: 0.18 }[time];
  const [x, y] = palette.sun ? [(palette.sun[0] - 0.5) * 2.2, -Math.min(1.6, Math.max(0.35, -palette.sun[1] / 500))] : [0, -1];
  const length = Math.hypot(x, y);
  const low = time === "golden" || time === "dusk" || time === "dawn";
  return {
    dir: [x / length, y / length],
    shade: mixColor(darken(palette.sky[0], 0.2), "#3a2f5a", 0.35),
    strength,
    rim: low && palette.sun ? mixColor(palette.sun[2], "#ffffff", 0.2) : undefined,
  };
}

export interface DrawContext { t: number; palette: Palette; time: TimeOfDay; pass: "back" | "front"; lights: Light[]; width: number }
export interface Light { x: number; y: number; radius: number; color: string; depth: number }
type Motif = { depth: number; draw: (ctx: SKRSContext2D, element: ElementSpec, context: DrawContext) => void };

const ink = "#2b2522";
function outline(ctx: SKRSContext2D, fill: string, width = 3) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  ctx.stroke();
}
function ridge(ctx: SKRSContext2D, from: number, to: number, base: number, height: number, seed: number, roughness: number) {
  const rand = random(seed);
  const points: number[] = [];
  for (let index = 0; index <= 24; index++) points.push(rand());
  ctx.beginPath();
  ctx.moveTo(from, base + 900);
  ctx.lineTo(from, base);
  for (let index = 0; index <= 24; index++) {
    const x = from + (to - from) * index / 24;
    const y = base - height * (0.45 + 0.55 * Math.sin(index * 0.7 + seed) * 0.5 + points[index]! * roughness);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(to, base + 900);
  ctx.closePath();
}

const motifs: Record<string, Motif> = {
  mountains: { depth: 0.12, draw(ctx, element, { width, palette }) {
    const color = element.color ?? mixColor("#5f6f96", palette.haze, 0.35);
    ridge(ctx, -width, width * 2, -150, 520 * (element.scale ?? 1), element.seed ?? 3, 0.55);
    ctx.fillStyle = color;
    ctx.fill();
    ridge(ctx, -width, width * 2, -110, 330 * (element.scale ?? 1), (element.seed ?? 3) + 7, 0.4);
    ctx.fillStyle = mixColor(color, "#2c3a52", 0.25);
    ctx.fill();
  } },
  hills: { depth: 0.3, draw(ctx, element, { width }) {
    ridge(ctx, -width, width * 2, -60, 190 * (element.scale ?? 1), element.seed ?? 5, 0.25);
    ctx.fillStyle = element.color ?? "#6f9a5b";
    ctx.fill();
  } },
  forest: { depth: 0.35, draw(ctx, element, { width }) {
    const rand = random(element.seed ?? 11);
    ctx.fillStyle = element.color ?? "#3f6b4a";
    for (let x = -width; x < width * 2; x += 38 + rand() * 30) {
      const h = 120 + rand() * 120;
      ctx.beginPath();
      ctx.moveTo(x - 34, -40);
      ctx.lineTo(x, -40 - h);
      ctx.lineTo(x + 34, -40);
      ctx.fill();
    }
    ctx.fillRect(-width, -44, width * 3, 400);
  } },
  city: { depth: 0.25, draw(ctx, element, { width, time }) {
    const rand = random(element.seed ?? 21);
    for (let x = -width; x < width * 2; x += 60 + rand() * 50) {
      const w = 50 + rand() * 60;
      const h = 120 + rand() * 320;
      ctx.fillStyle = element.color ?? "#56607a";
      ctx.fillRect(x, -60 - h, w, h + 400);
      if (time === "night" || time === "dusk") {
        ctx.fillStyle = "rgba(255,214,120,0.85)";
        for (let wy = -60 - h + 14; wy < -70; wy += 22) for (let wx = x + 8; wx < x + w - 10; wx += 16) if (rand() < 0.35) ctx.fillRect(wx, wy, 7, 10);
      }
    }
  } },
  clouds: { depth: 0.05, draw(ctx, element, { width, t, time }) {
    const rand = random(element.seed ?? 9);
    ctx.fillStyle = time === "night" ? "rgba(70,80,120,0.5)" : time === "dawn" || time === "dusk" || time === "golden" ? "rgba(255,214,190,0.75)" : "rgba(255,255,255,0.85)";
    for (let index = 0; index < 7; index++) {
      const x = ((rand() * width * 2 + t * (8 + rand() * 10)) % (width * 2.4)) - width * 0.5;
      const y = -650 - rand() * 300;
      const s = 0.6 + rand() * 0.9;
      for (const [dx, dy, r] of [[0, 0, 50], [45, -18, 42], [90, 0, 46], [40, 10, 40]]) {
        ctx.beginPath();
        ctx.arc(x + dx! * s, y + dy! * s, r! * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } },
  sea: { depth: 0.2, draw(ctx, element, { width, t, palette }) {
    ctx.fillStyle = element.color ?? mixColor("#3b6f9a", palette.haze, 0.3);
    ctx.fillRect(-width, -150, width * 3, 900);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    for (let row = 0; row < 8; row++) {
      ctx.beginPath();
      for (let x = -width; x < width * 2; x += 90) {
        const y = -140 + row * 18 + Math.sin(x * 0.02 + t * 1.5 + row) * 3;
        ctx.moveTo(x + ((t * 20 + row * 30) % 90), y);
        ctx.lineTo(x + 30 + ((t * 20 + row * 30) % 90), y);
      }
      ctx.stroke();
    }
  } },
  river: { depth: 0.75, draw(ctx, element, { width, t, palette }) {
    const top = element.y ?? -120;
    const gradient = ctx.createLinearGradient(0, top, 0, 60);
    gradient.addColorStop(0, mixColor(element.color ?? "#5d8fb0", palette.haze, 0.45));
    gradient.addColorStop(1, element.color ?? "#3e6e8e");
    ctx.fillStyle = gradient;
    ctx.fillRect(-width, top, width * 3, 400);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 2.5;
    const rand = random(element.seed ?? 4);
    for (let index = 0; index < 60; index++) {
      const y = top + 10 + rand() * 160;
      const x = (rand() * width * 3 + t * (12 + (y - top) * 0.25)) % (width * 3) - width;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 20 + (y - top) * 0.25, y);
      ctx.stroke();
    }
  } },
  rice: { depth: 0.6, draw(ctx, element, { width, t }) {
    ctx.fillStyle = element.color ?? "#9cc46a";
    ctx.fillRect(-width, -80, width * 3, 500);
    ctx.strokeStyle = "rgba(60,100,40,0.45)";
    ctx.lineWidth = 2;
    for (let row = 0; row < 9; row++) {
      ctx.beginPath();
      for (let x = -width; x < width * 2; x += 14) {
        const y = -78 + row * 12;
        ctx.moveTo(x, y + 6);
        ctx.lineTo(x + Math.sin(t * 1.4 + x * 0.01) * 3, y - 4);
      }
      ctx.stroke();
    }
  } },
  tree: { depth: 0.85, draw(ctx, element, { t }) {
    const s = element.scale ?? 1;
    const x = element.x ?? 0;
    const sway = Math.sin(t * 0.9 + x) * 4 * s;
    ctx.beginPath();
    ctx.moveTo(x - 14 * s, 0);
    ctx.lineTo(x - 8 * s, -170 * s);
    ctx.lineTo(x + 8 * s, -170 * s);
    ctx.lineTo(x + 14 * s, 0);
    outline(ctx, "#6b4a33");
    const color = element.color ?? "#4f8a4c";
    for (const [dx, dy, r] of [[-55, -210, 70], [50, -220, 75], [0, -290, 85], [-20, -175, 60], [35, -170, 55]]) {
      ctx.beginPath();
      ctx.arc(x + dx! * s + sway, y(dy!, s), r! * s, 0, Math.PI * 2);
      outline(ctx, color, 2.5);
    }
    function y(value: number, scale: number) { return value * scale; }
  } },
  palm: { depth: 0.85, draw(ctx, element, { t }) {
    const s = element.scale ?? 1;
    const x = element.x ?? 0;
    ctx.beginPath();
    ctx.moveTo(x - 10 * s, 0);
    ctx.quadraticCurveTo(x + 10 * s, -200 * s, x + 30 * s, -380 * s);
    ctx.lineTo(x + 42 * s, -378 * s);
    ctx.quadraticCurveTo(x + 22 * s, -200 * s, x + 12 * s, 0);
    outline(ctx, "#8a6a45");
    for (let index = 0; index < 7; index++) {
      const angle = -Math.PI / 2 + (index - 3) * 0.5 + Math.sin(t + index) * 0.04;
      ctx.beginPath();
      ctx.moveTo(x + 36 * s, -380 * s);
      ctx.quadraticCurveTo(x + 36 * s + Math.cos(angle) * 90 * s, -380 * s + Math.sin(angle) * 60 * s - 30 * s, x + 36 * s + Math.cos(angle) * 170 * s, -380 * s + Math.sin(angle) * 110 * s + 40 * s);
      ctx.lineWidth = 16 * s;
      ctx.lineCap = "round";
      ctx.strokeStyle = element.color ?? "#3f8a4a";
      ctx.stroke();
    }
  } },
  bamboo: { depth: 0.7, draw(ctx, element, { t }) {
    const rand = random(element.seed ?? 8);
    const x0 = element.x ?? 0;
    for (let index = 0; index < 9; index++) {
      const x = x0 + (rand() - 0.5) * 220 * (element.scale ?? 1);
      const h = (380 + rand() * 260) * (element.scale ?? 1);
      const lean = Math.sin(t * 0.8 + index) * 6;
      ctx.lineWidth = 11;
      ctx.strokeStyle = element.color ?? "#6f9e4a";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.quadraticCurveTo(x, -h / 2, x + lean, -h);
      ctx.stroke();
      ctx.fillStyle = "#4f7e36";
      for (let leaf = 0; leaf < 6; leaf++) {
        const ly = -h * (0.45 + leaf * 0.09);
        ctx.beginPath();
        ctx.ellipse(x + lean * (leaf / 6) + (leaf % 2 ? 22 : -22), ly, 26, 7, leaf % 2 ? 0.4 : -0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } },
  house: { depth: 0.8, draw(ctx, element) {
    const s = element.scale ?? 1;
    const x = element.x ?? 0;
    const wall = element.color ?? "#e9d8b4";
    ctx.beginPath();
    ctx.rect(x - 150 * s, -170 * s, 300 * s, 170 * s);
    outline(ctx, wall);
    ctx.beginPath();
    ctx.moveTo(x - 190 * s, -165 * s);
    ctx.lineTo(x - 120 * s, -280 * s);
    ctx.lineTo(x + 120 * s, -280 * s);
    ctx.lineTo(x + 190 * s, -165 * s);
    ctx.closePath();
    outline(ctx, "#a4523a");
    ctx.strokeStyle = "rgba(60,20,10,0.35)";
    ctx.lineWidth = 2;
    for (let row = 1; row < 5; row++) {
      ctx.beginPath();
      ctx.moveTo(x - 190 * s + row * 14 * s, -165 * s - row * 23 * s);
      ctx.lineTo(x + 190 * s - row * 14 * s, -165 * s - row * 23 * s);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.rect(x - 30 * s, -120 * s, 60 * s, 120 * s);
    outline(ctx, "#7a4e30");
    for (const dx of [-100, 70]) {
      ctx.beginPath();
      ctx.rect(x + dx * s, -125 * s, 40 * s, 40 * s);
      outline(ctx, "#f3d27a", 2.5);
    }
  } },
  pagoda: { depth: 0.5, draw(ctx, element) {
    const s = element.scale ?? 1;
    const x = element.x ?? 0;
    for (let level = 0; level < 4; level++) {
      const w = (120 - level * 22) * s;
      const y = -level * 70 * s;
      ctx.beginPath();
      ctx.rect(x - w * 0.6, y - 60 * s, w * 1.2, 60 * s);
      outline(ctx, element.color ?? "#d8b98c", 2.5);
      ctx.beginPath();
      ctx.moveTo(x - w - 20 * s, y - 55 * s);
      ctx.quadraticCurveTo(x, y - 85 * s, x + w + 20 * s, y - 55 * s);
      ctx.lineTo(x + w - 10 * s, y - 72 * s);
      ctx.lineTo(x - w + 10 * s, y - 72 * s);
      ctx.closePath();
      outline(ctx, "#8e3b2e", 2.5);
    }
  } },
  pier: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    const w = element.width ?? 700;
    ctx.beginPath();
    ctx.rect(x - w / 2, -4, w, 26);
    outline(ctx, element.color ?? "#9b7350");
    ctx.strokeStyle = "rgba(60,35,20,0.5)";
    ctx.lineWidth = 2;
    for (let px = x - w / 2 + 40; px < x + w / 2; px += 40) {
      ctx.beginPath();
      ctx.moveTo(px, -4);
      ctx.lineTo(px, 22);
      ctx.stroke();
    }
    for (const px of [x - w / 2 + 20, x + w / 2 - 20]) {
      ctx.beginPath();
      ctx.rect(px - 8, 20, 16, 200);
      outline(ctx, "#7a5638");
    }
  } },
  boat: { depth: 1, draw(ctx, element, { pass, t }) {
    const s = element.scale ?? 1;
    const x = element.x ?? 0;
    const y = (element.y ?? 12) + Math.sin(t * 1.6) * 3;
    if (pass === "back") {
      ctx.beginPath();
      ctx.moveTo(x - 150 * s, y - 30 * s);
      ctx.quadraticCurveTo(x, y - 14 * s, x + 150 * s, y - 30 * s);
      ctx.lineTo(x + 140 * s, y - 20 * s);
      ctx.lineTo(x - 140 * s, y - 20 * s);
      ctx.closePath();
      outline(ctx, "#5a3a24", 2.5);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(x - 190 * s, y - 40 * s);
    ctx.quadraticCurveTo(x - 160 * s, y + 30 * s, x, y + 32 * s);
    ctx.quadraticCurveTo(x + 160 * s, y + 30 * s, x + 190 * s, y - 40 * s);
    ctx.quadraticCurveTo(x, y - 10 * s, x - 190 * s, y - 40 * s);
    outline(ctx, element.color ?? "#8a5a36");
    ctx.beginPath();
    ctx.moveTo(x - 170 * s, y - 18 * s);
    ctx.quadraticCurveTo(x, y + 8 * s, x + 170 * s, y - 18 * s);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(240,210,150,0.6)";
    ctx.stroke();
  } },
  table: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    const s = element.scale ?? 1;
    ctx.beginPath();
    ctx.rect(x - 110 * s, -125 * s, 220 * s, 18 * s);
    outline(ctx, element.color ?? "#8b5e3c");
    for (const dx of [-95, 85]) {
      ctx.beginPath();
      ctx.rect(x + dx * s, -108 * s, 12 * s, 108 * s);
      outline(ctx, "#6e4a2f");
    }
  } },
  chair: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    const s = element.scale ?? 1;
    const f = element.flip ? -1 : 1;
    ctx.beginPath();
    ctx.rect(x - 34 * s, -88 * s, 68 * s, 12 * s);
    outline(ctx, element.color ?? "#9a6b44");
    ctx.beginPath();
    ctx.rect(x - f * 34 * s - (f > 0 ? 0 : 10 * s), -190 * s, 10 * s, 190 * s);
    outline(ctx, "#7c5434");
    ctx.beginPath();
    ctx.rect(x + f * 28 * s - (f > 0 ? 0 : 10 * s), -78 * s, 10 * s, 78 * s);
    outline(ctx, "#7c5434");
  } },
  stool: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    ctx.beginPath();
    ctx.rect(x - 30, -84, 60, 14);
    outline(ctx, element.color ?? "#c0392b");
    for (const dx of [-26, 18]) {
      ctx.beginPath();
      ctx.rect(x + dx, -70, 8, 70);
      outline(ctx, element.color ?? "#c0392b");
    }
  } },
  lantern: { depth: 1, draw(ctx, element, { lights, t }) {
    const x = element.x ?? 0;
    const y = element.y ?? -260;
    ctx.beginPath();
    ctx.moveTo(x, y - 60);
    ctx.lineTo(x, y - 30);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, 22, 30, Math.sin(t * 1.2 + x) * 0.05, 0, Math.PI * 2);
    outline(ctx, element.color ?? "#e74c3c", 2.5);
    lights.push({ x, y, radius: 260, color: "rgba(255,190,90,0.5)", depth: 1 });
  } },
  lamp: { depth: 1, draw(ctx, element, { lights }) {
    const x = element.x ?? 0;
    const y = element.y ?? -140;
    ctx.beginPath();
    ctx.moveTo(x - 20, y);
    ctx.lineTo(x + 20, y);
    ctx.lineTo(x + 10, y - 30);
    ctx.lineTo(x - 10, y - 30);
    ctx.closePath();
    outline(ctx, element.color ?? "#f5d76e", 2.5);
    lights.push({ x, y: y - 15, radius: 300, color: "rgba(255,200,110,0.45)", depth: 1 });
  } },
  campfire: { depth: 1, draw(ctx, element, { lights, t }) {
    const x = element.x ?? 0;
    for (const dx of [-24, 0, 24]) {
      ctx.beginPath();
      ctx.rect(x + dx - 30, -12, 60, 10);
      outline(ctx, "#6b4a33", 2);
    }
    for (let index = 0; index < 3; index++) {
      const h = 60 + Math.sin(t * 9 + index * 2) * 14;
      ctx.beginPath();
      ctx.moveTo(x - 26 + index * 10, -10);
      ctx.quadraticCurveTo(x - 30 + index * 16, -h * 0.6, x - 8 + index * 10, -h);
      ctx.quadraticCurveTo(x + 10 + index * 6, -h * 0.5, x + 26 - index * 4, -10);
      ctx.fillStyle = ["#e74c3c", "#f39c12", "#f9e79f"][index]!;
      ctx.fill();
    }
    lights.push({ x, y: -40, radius: 420, color: "rgba(255,150,60,0.55)", depth: 1 });
  } },
  altar: { depth: 0.95, draw(ctx, element, { lights, t }) {
    const x = element.x ?? 0;
    ctx.beginPath();
    ctx.rect(x - 120, -150, 240, 150);
    outline(ctx, element.color ?? "#7b2d26");
    ctx.beginPath();
    ctx.rect(x - 40, -230, 80, 70);
    outline(ctx, "#d4b26a", 2.5);
    for (const dx of [-80, 80]) {
      ctx.beginPath();
      ctx.rect(x + dx - 6, -190, 12, 40);
      outline(ctx, "#f4e3c1", 2);
      ctx.beginPath();
      ctx.ellipse(x + dx, -198 + Math.sin(t * 10 + dx) * 1.5, 5, 9, 0, 0, Math.PI * 2);
      ctx.fillStyle = "#f7b733";
      ctx.fill();
      lights.push({ x: x + dx, y: -198, radius: 140, color: "rgba(255,180,80,0.4)", depth: 0.95 });
    }
  } },
  window: { depth: 0.9, draw(ctx, element, { palette }) {
    const x = element.x ?? 0;
    const y = element.y ?? -360;
    const sky = ctx.createLinearGradient(0, y - 90, 0, y + 90);
    sky.addColorStop(0, palette.sky[1]);
    sky.addColorStop(1, palette.sky[2]);
    ctx.beginPath();
    ctx.rect(x - 90, y - 90, 180, 180);
    outline(ctx, "#6e4a2f", 8);
    ctx.fillStyle = sky;
    ctx.fillRect(x - 86, y - 86, 172, 172);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#6e4a2f";
    ctx.beginPath();
    ctx.moveTo(x, y - 90);
    ctx.lineTo(x, y + 90);
    ctx.moveTo(x - 90, y);
    ctx.lineTo(x + 90, y);
    ctx.stroke();
  } },
  door: { depth: 0.9, draw(ctx, element) {
    const x = element.x ?? 0;
    ctx.beginPath();
    ctx.rect(x - 70, -300, 140, 300);
    outline(ctx, element.color ?? "#7a4e30", 4);
    ctx.beginPath();
    ctx.arc(x + 45, -150, 7, 0, Math.PI * 2);
    outline(ctx, "#e1b866", 2);
  } },
  frame: { depth: 0.9, draw(ctx, element) {
    const x = element.x ?? 0;
    const y = element.y ?? -420;
    ctx.beginPath();
    ctx.rect(x - 60, y - 75, 120, 150);
    outline(ctx, "#b8893a", 6);
    ctx.fillStyle = element.color ?? "#d9cbb0";
    ctx.fillRect(x - 52, y - 67, 104, 134);
  } },
  bed: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    ctx.beginPath();
    ctx.rect(x - 170, -90, 340, 50);
    outline(ctx, element.color ?? "#8b5e3c");
    ctx.beginPath();
    ctx.rect(x - 165, -112, 330, 26);
    outline(ctx, "#f0ead8");
    ctx.beginPath();
    ctx.rect(x - 170, -180, 20, 180);
    outline(ctx, "#6e4a2f");
  } },
  rock: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    const s = element.scale ?? 1;
    ctx.beginPath();
    ctx.moveTo(x - 70 * s, 0);
    ctx.quadraticCurveTo(x - 60 * s, -70 * s, x, -75 * s);
    ctx.quadraticCurveTo(x + 70 * s, -60 * s, x + 75 * s, 0);
    ctx.closePath();
    outline(ctx, element.color ?? "#8c8a86");
  } },
  bush: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    const s = element.scale ?? 1;
    for (const [dx, dy, r] of [[-40, -35, 40], [0, -55, 48], [42, -35, 38]]) {
      ctx.beginPath();
      ctx.arc(x + dx! * s, dy! * s, r! * s, 0, Math.PI * 2);
      outline(ctx, element.color ?? "#5c9450", 2.5);
    }
  } },
  reeds: { depth: 1.25, draw(ctx, element, { t }) {
    const rand = random(element.seed ?? 6);
    const x0 = element.x ?? 0;
    const w = element.width ?? 400;
    for (let index = 0; index < w / 9; index++) {
      const x = x0 - w / 2 + rand() * w;
      const h = (90 + rand() * 120) * (element.scale ?? 1);
      const bend = Math.sin(t * 1.3 + x * 0.02) * 10;
      ctx.beginPath();
      ctx.moveTo(x, 40);
      ctx.quadraticCurveTo(x + bend * 0.3, -h / 2, x + bend, -h);
      ctx.lineWidth = 4;
      ctx.strokeStyle = element.color ?? "#556b2f";
      ctx.stroke();
      if (rand() < 0.4) {
        ctx.beginPath();
        ctx.ellipse(x + bend, -h - 10, 4, 14, bend * 0.02, 0, Math.PI * 2);
        ctx.fillStyle = "#8b6b3e";
        ctx.fill();
      }
    }
  } },
  grass: { depth: 1.15, draw(ctx, element, { t }) {
    const rand = random(element.seed ?? 2);
    const x0 = element.x ?? 0;
    const w = element.width ?? 600;
    ctx.strokeStyle = element.color ?? "#4d7a3a";
    ctx.lineWidth = 3;
    for (let index = 0; index < w / 5; index++) {
      const x = x0 - w / 2 + rand() * w;
      const h = 20 + rand() * 40;
      ctx.beginPath();
      ctx.moveTo(x, 30);
      ctx.lineTo(x + Math.sin(t * 2 + x) * 4, 30 - h);
      ctx.stroke();
    }
  } },
  sign: { depth: 1, draw(ctx, element) {
    const x = element.x ?? 0;
    ctx.beginPath();
    ctx.rect(x - 6, -150, 12, 150);
    outline(ctx, "#6e4a2f");
    ctx.beginPath();
    ctx.rect(x - 110, -230, 220, 70);
    outline(ctx, element.color ?? "#f2e3c2");
    ctx.fillStyle = ink;
    ctx.font = "30px Cinema";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(element.text ?? "", x, -195, 200);
  } },
};

/** Vẽ vật thể tự do bằng SVG path do agent viết. */
function drawPath(ctx: SKRSContext2D, element: ElementSpec, path2d: (path: string) => import("@napi-rs/canvas").Path2D) {
  ctx.save();
  ctx.translate(element.x ?? 0, element.y ?? 0);
  ctx.scale((element.flip ? -1 : 1) * (element.scale ?? 1), element.scale ?? 1);
  const shape = path2d(element.path ?? "");
  if (element.fill !== "none") {
    ctx.fillStyle = element.fill ?? element.color ?? "#999";
    ctx.fill(shape);
  }
  if (element.stroke !== "none") {
    ctx.lineWidth = 3 / (element.scale ?? 1);
    ctx.lineJoin = "round";
    ctx.strokeStyle = element.stroke ?? ink;
    ctx.stroke(shape);
  }
  ctx.restore();
}

export function elementDepth(element: ElementSpec) {
  return element.depth ?? motifs[element.type]?.depth ?? 1;
}

export const motifNames = [...Object.keys(motifs), "path"];

export function drawElement(ctx: SKRSContext2D, element: ElementSpec, context: DrawContext, path2d: (path: string) => import("@napi-rs/canvas").Path2D) {
  if (element.type === "path") {
    if (context.pass === (element.front ? "front" : "back")) drawPath(ctx, element, path2d);
    return;
  }
  const motif = motifs[element.type];
  if (!motif) return;
  // Thuyền tự chia lớp: lòng thuyền sau nhân vật, mạn thuyền trước nhân vật.
  if (element.type === "boat" || context.pass === (element.front ? "front" : "back")) motif.draw(ctx, element, context);
}

export function drawSky(ctx: SKRSContext2D, palette: Palette, time: TimeOfDay, width: number, height: number, t: number) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, palette.sky[0]);
  gradient.addColorStop(0.55, palette.sky[1]);
  gradient.addColorStop(1, palette.sky[2]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (time === "night") {
    const rand = random(17);
    for (let index = 0; index < 160; index++) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * (1 + rand() * 3) + index);
      ctx.fillStyle = `rgba(255,255,240,${0.3 + twinkle * 0.6})`;
      ctx.fillRect(rand() * width, rand() * height * 0.7, 2, 2);
    }
  }
}

export function drawSun(ctx: SKRSContext2D, palette: Palette, time: TimeOfDay, width: number, horizonY: number, scale: number) {
  if (!palette.sun) return;
  const [fx, dy, color] = palette.sun;
  const x = width * fx;
  const y = horizonY + dy * scale;
  const radius = (time === "night" ? 38 : 55) * scale;
  const glow = ctx.createRadialGradient(x, y, radius * 0.5, x, y, radius * 6);
  glow.addColorStop(0, color.length === 7 ? `${color}aa` : color);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius * 6, y - radius * 6, radius * 12, radius * 12);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  return { x, y, radius, color };
}

const groundColors = { grass: "#7aa35a", dirt: "#a9845c", sand: "#e3cf9f", wood: "#9b7350", tile: "#c9b79c", stone: "#9a968e", none: "#000000" };

export function drawGround(ctx: SKRSContext2D, spec: SetSpec, width: number) {
  const ground = spec.ground ?? (spec.interior ? "wood" : "grass");
  if (ground === "none") return;
  const color = spec.groundColor ?? spec.interior?.floor ?? groundColors[ground];
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, mixColor(color, "#1d1a17", 0.35));
  ctx.fillStyle = gradient;
  ctx.fillRect(-width, 0, width * 3, 900);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 2;
  if (ground === "wood" || ground === "tile") {
    for (let y = 30; y < 400; y += 40) {
      ctx.beginPath();
      ctx.moveTo(-width, y);
      ctx.lineTo(width * 2, y);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.moveTo(-width, 0);
  ctx.lineTo(width * 2, 0);
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(43,37,34,0.6)";
  ctx.stroke();
}

export function drawInterior(ctx: SKRSContext2D, spec: SetSpec, width: number) {
  const wall = spec.interior?.wall ?? "#d9c6a5";
  const gradient = ctx.createLinearGradient(0, -1200, 0, 0);
  gradient.addColorStop(0, mixColor(wall, "#2b2522", 0.25));
  gradient.addColorStop(1, wall);
  ctx.fillStyle = gradient;
  ctx.fillRect(-width, -1600, width * 3, 1600);
  ctx.fillStyle = mixColor(wall, "#2b2522", 0.3);
  ctx.fillRect(-width, -40, width * 3, 40);
}

/** Thời tiết và hạt bay, vẽ theo toạ độ màn hình. */
export function drawWeather(ctx: SKRSContext2D, weather: Weather, width: number, height: number, t: number, lights: { x: number; y: number }[]) {
  const rand = random(31);
  if (weather === "mist") {
    for (let index = 0; index < 4; index++) {
      const y = height * (0.45 + index * 0.13);
      const shift = ((t * (12 + index * 6)) % width);
      const gradient = ctx.createLinearGradient(0, y - 80, 0, y + 80);
      gradient.addColorStop(0, "rgba(255,255,255,0)");
      gradient.addColorStop(0.5, `rgba(240,240,245,${0.06 + index * 0.025})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.save();
      ctx.translate(shift, 0);
      ctx.fillRect(-width, y - 80, width * 3, 160);
      ctx.restore();
    }
  } else if (weather === "rain") {
    ctx.strokeStyle = "rgba(200,215,235,0.45)";
    ctx.lineWidth = Math.max(1, height / 600);
    ctx.beginPath();
    for (let index = 0; index < 260; index++) {
      const x = (rand() * width + t * 300) % width;
      const y = (rand() * height + t * 1400 * (0.8 + rand() * 0.4)) % height;
      ctx.moveTo(x, y);
      ctx.lineTo(x - height * 0.01, y + height * 0.04);
    }
    ctx.stroke();
  } else if (weather === "snow" || weather === "petals" || weather === "leaves") {
    const colors = weather === "snow" ? ["#ffffff"] : weather === "petals" ? ["#f7b2c4", "#f9d5df"] : ["#d9822b", "#c0392b", "#e1b12c"];
    for (let index = 0; index < 90; index++) {
      const speed = 30 + rand() * 50;
      const x = (rand() * width + Math.sin(t + index) * 30 + t * 20) % width;
      const y = (rand() * height + t * speed * (height / 700)) % height;
      ctx.fillStyle = colors[index % colors.length]!;
      ctx.beginPath();
      ctx.ellipse(x, y, height / 260, weather === "snow" ? height / 260 : height / 520, t + index, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (weather === "fireflies") {
    for (let index = 0; index < 40; index++) {
      const x = rand() * width + Math.sin(t * 0.7 + index) * 40;
      const y = height * (0.4 + rand() * 0.5) + Math.cos(t * 0.9 + index) * 30;
      const glow = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + index));
      lights.push({ x, y });
      ctx.fillStyle = `rgba(230,255,140,${glow})`;
      ctx.beginPath();
      ctx.arc(x, y, height / 300, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
