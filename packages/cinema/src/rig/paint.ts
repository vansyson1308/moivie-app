import { Path2D, type SKRSContext2D } from "@napi-rs/canvas";

export type Point = [number, number];

/** Ánh sáng chính của cảnh tác động lên nhân vật (toạ độ màn hình). */
export interface Lighting {
  /** Vector đơn vị từ vật thể hướng về nguồn sáng. */
  dir: Point;
  /** Màu pha vào vùng tối (bóng nghiêng về lạnh). */
  shade: string;
  /** Độ đậm của bóng 0..1. */
  strength: number;
  /** Màu viền sáng khi ngược sáng (để trống nếu không có). */
  rim?: string;
}

export const defaultLighting: Lighting = { dir: [-0.6, -0.8], shade: "#4a4e8a", strength: 0.32 };

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.startsWith("rgb")
    ? hex.match(/\d+/g)!.slice(0, 3).map(Number)
    : [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16));
  return [value[0]!, value[1]!, value[2]!];
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === x ? (y - z) / d + (y < z ? 6 : 0) : max === y ? (z - x) / d + 2 : (x - y) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[f(0), f(8), f(4)].map(value => value.toString(16).padStart(2, "0")).join("")}`;
}

export function mixColor(a: string, b: string, t: number) {
  const [x, y] = [hexToRgb(a), hexToRgb(b)];
  return `#${x.map((value, index) => Math.round(value + (y[index]! - value) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Màu viền: cùng sắc với màu nền nhưng tối và đậm hơn (viền màu thay cho viền đen). */
export function lineColor(fill: string) {
  const [h, s, l] = rgbToHsl(hexToRgb(fill));
  return hslToHex((h + 350) % 360, Math.min(1, s * 0.9 + 0.12), Math.min(0.24, l * 0.36));
}

/** Màu vùng tối: tối hơn, lệch sắc về phía màu bóng của cảnh (thường lạnh). */
export function shadeColor(fill: string, lighting: Lighting) {
  const [h, s, l] = rgbToHsl(hexToRgb(fill));
  const toned = hslToHex(h, Math.min(1, s * 1.05), l * (1 - lighting.strength * 0.9));
  return mixColor(toned, lighting.shade, lighting.strength * 0.35);
}

export function lighten(fill: string, amount: number) {
  const [h, s, l] = rgbToHsl(hexToRgb(fill));
  return hslToHex(h, s, Math.min(0.97, l + (1 - l) * amount));
}

export function darken(fill: string, amount: number) {
  const [h, s, l] = rgbToHsl(hexToRgb(fill));
  return hslToHex(h, s, l * (1 - amount));
}

export function capsule(path: Path2D, a: Point, b: Point, radius: number) {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
  path.moveTo(a[0] + Math.cos(angle + Math.PI / 2) * radius, a[1] + Math.sin(angle + Math.PI / 2) * radius);
  path.arc(a[0], a[1], radius, angle + Math.PI / 2, angle + Math.PI * 1.5);
  path.arc(b[0], b[1], radius, angle - Math.PI / 2, angle + Math.PI / 2);
  path.closePath();
  return path;
}

/** Diện tích có dấu (y hướng xuống): dương = cùng chiều với ellipse()/arc() mặc định. */
function signedArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const [a, b] = [points[index]!, points[(index + 1) % points.length]!];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area;
}

/** Đường cong mượt đi qua các điểm (spline Catmull-Rom). Hình khép kín luôn được đặt cùng chiều quay để các mảnh hợp lại không đục lỗ nhau theo luật nonzero. */
export function smoothPath(points: Point[], closed = true, path = new Path2D()) {
  if (closed && signedArea(points) < 0) points = [...points].reverse();
  const count = points.length;
  const at = (index: number) => points[closed ? (index + count) % count : Math.max(0, Math.min(count - 1, index))]!;
  path.moveTo(...points[0]!);
  for (let index = 0; index < (closed ? count : count - 1); index++) {
    const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
    path.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1],
    );
  }
  if (closed) path.closePath();
  return path;
}

function shifted(shape: Path2D, offset: Point) {
  const path = new Path2D();
  path.addPath(shape, { a: 1, b: 0, c: 0, d: 1, e: offset[0], f: offset[1] } as never);
  return path;
}

/**
 * Tô một khối kiểu cel bằng các lần cắt lồng nhau (mỗi clip là một phép giao, đúng cả với hình hợp từ nhiều mảnh chồng nhau):
 * viền ngoài → ánh viền phía khuất (khi ngược sáng) → vùng tối → vùng sáng chính → dải sáng phía nguồn sáng.
 * Vùng sáng = khối ∩ (khối dịch về phía nguồn sáng) nên bóng ôm đúng theo hình.
 */
export function paintShape(ctx: SKRSContext2D, shape: Path2D, fill: string, lighting: Lighting, options: { depth?: number; line?: number; lineFill?: string; noShade?: boolean; highlight?: number; shadow?: string } = {}) {
  const depth = options.depth ?? 6;
  const [dx, dy] = lighting.dir;
  const line = options.line ?? 2.6;
  if (line > 0) {
    // Nét dày vẽ trước, phần trong bị tô đè: chỉ còn đường bao ngoài, không lộ đường nối giữa các mảnh.
    ctx.lineWidth = line * 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = options.lineFill ?? lineColor(fill);
    ctx.stroke(shape);
  }
  if (options.noShade || lighting.strength <= 0) {
    ctx.fillStyle = fill;
    ctx.fill(shape);
    return;
  }
  ctx.save();
  ctx.clip(shape);
  if (lighting.rim) {
    // Viền ngược sáng: dải mảnh phía khuất sáng, pha màu nền để là ánh sáng chứ không thành nét vẽ.
    ctx.fillStyle = mixColor(fill, lighting.rim, 0.45);
    ctx.fill(shape);
    ctx.clip(shifted(shape, [dx * depth * 0.22, dy * depth * 0.22]));
  }
  ctx.fillStyle = options.shadow ? mixColor(options.shadow, shadeColor(fill, lighting), Math.max(0, lighting.strength - 0.32)) : shadeColor(fill, lighting);
  ctx.fill(shape);
  ctx.clip(shifted(shape, [dx * depth, dy * depth]));
  if (options.highlight) {
    ctx.fillStyle = mixColor(fill, lighten(fill, 0.4), options.highlight);
    ctx.fill(shape);
    ctx.clip(shifted(shape, [-dx * depth * 0.45, -dy * depth * 0.45]));
  }
  ctx.fillStyle = fill;
  ctx.fill(shape);
  ctx.restore();
}
