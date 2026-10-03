import { Path2D, type SKRSContext2D } from "@napi-rs/canvas";
import type { PropDrawer } from "./character";
import type { PropSpec } from "./film";

type Point = [number, number];
const ink = "#2b2522";

function paint(ctx: SKRSContext2D, fill: string, width = 2.5) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = width;
  ctx.strokeStyle = ink;
  ctx.lineJoin = "round";
  ctx.stroke();
}

function held(draw: (ctx: SKRSContext2D, s: number, t: number) => void, upright = false, follow = 1): PropDrawer {
  return (ctx, hand: Point, angle, scale, t, mirror) => {
    ctx.save();
    ctx.translate(hand[0], hand[1]);
    // Đạo cụ quay theo hướng nhân vật: nhìn sang trái thì lật ngang.
    ctx.scale(mirror, 1);
    if (!upright) ctx.rotate(0.15 - angle * mirror * follow);
    draw(ctx, scale, t);
    ctx.restore();
  };
}

const builtIn: Record<string, PropDrawer> = {
  // Tay nắm gần đầu cán, lưỡi chèo hướng xuống nước.
  oar: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-4 * s, -30 * s, 8 * s, 250 * s);
    paint(ctx, "#a07a4f");
    ctx.beginPath();
    ctx.ellipse(0, 235 * s, 13 * s, 36 * s, 0, 0, Math.PI * 2);
    paint(ctx, "#8a6440");
  }, false, 0.35),
  stick: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-3.5 * s, -20 * s, 7 * s, 170 * s);
    paint(ctx, "#7a5638");
  }, true),
  letter: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-6 * s, -2 * s, 34 * s, 24 * s);
    paint(ctx, "#f5efe0");
    ctx.beginPath();
    ctx.moveTo(-6 * s, -2 * s);
    ctx.lineTo(11 * s, 12 * s);
    ctx.lineTo(28 * s, -2 * s);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }, true),
  flower: held((ctx, s, t) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4 * s, -55 * s);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = "#4f8a3c";
    ctx.stroke();
    for (let petal = 0; petal < 6; petal++) {
      const a = petal / 6 * Math.PI * 2 + t * 0.2;
      ctx.beginPath();
      ctx.ellipse(4 * s + Math.cos(a) * 9 * s, -60 * s + Math.sin(a) * 9 * s, 7 * s, 5 * s, a, 0, Math.PI * 2);
      paint(ctx, "#f4a7b9", 1.5);
    }
    ctx.beginPath();
    ctx.arc(4 * s, -60 * s, 5 * s, 0, Math.PI * 2);
    paint(ctx, "#f7d154", 1.5);
  }, true),
  lantern: held((ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 20 * s);
    ctx.lineWidth = 2;
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 42 * s, 17 * s, 23 * s, 0, 0, Math.PI * 2);
    paint(ctx, "#e74c3c");
  }, true),
  bag: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-18 * s, 10 * s, 40 * s, 34 * s);
    paint(ctx, "#8e5b3a");
    ctx.beginPath();
    ctx.arc(2 * s, 10 * s, 12 * s, Math.PI, 0);
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }, true),
  book: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-4 * s, -6 * s, 30 * s, 38 * s);
    paint(ctx, "#2e6f95");
  }, true),
  cup: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-2 * s, -22 * s, 20 * s, 24 * s);
    paint(ctx, "#f1ead8");
  }, true),
  bowl: held((ctx, s) => {
    ctx.beginPath();
    ctx.arc(10 * s, -6 * s, 18 * s, 0, Math.PI);
    ctx.closePath();
    paint(ctx, "#f1ead8");
  }, true),
  phone: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-2 * s, -26 * s, 16 * s, 28 * s);
    paint(ctx, "#2c3e50");
  }, true),
  umbrella: held((ctx, s) => {
    ctx.beginPath();
    ctx.rect(-2 * s, -150 * s, 4 * s, 150 * s);
    paint(ctx, "#5d4037");
    ctx.beginPath();
    ctx.moveTo(-90 * s, -140 * s);
    ctx.quadraticCurveTo(0, -230 * s, 90 * s, -140 * s);
    ctx.closePath();
    paint(ctx, "#c0392b");
  }, true),
  fan: held((ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 45 * s, -Math.PI * 0.85, -Math.PI * 0.15);
    ctx.closePath();
    paint(ctx, "#e8c07a");
  }, true),
  basket: held((ctx, s) => {
    ctx.beginPath();
    ctx.moveTo(-26 * s, 14 * s);
    ctx.lineTo(28 * s, 14 * s);
    ctx.lineTo(20 * s, 48 * s);
    ctx.lineTo(-18 * s, 48 * s);
    ctx.closePath();
    paint(ctx, "#c49a5a");
    ctx.beginPath();
    ctx.arc(1 * s, 14 * s, 22 * s, Math.PI, 0);
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }, true),
};

/** Đạo cụ cầm tay: thư viện có sẵn và đạo cụ agent tự vẽ bằng SVG path. */
export function createProps(custom: Record<string, PropSpec>): Record<string, PropDrawer> {
  const props = { ...builtIn };
  for (const [id, spec] of Object.entries(custom)) {
    const shape = new Path2D(spec.path);
    // ACT: tâm và bán kính quầng sáng ước từ các số trong path (đủ cho đạo cụ khép kín đơn giản).
    const numbers = (spec.path.match(/-?\d*\.?\d+/g) ?? ["0", "0"]).map(Number);
    const xs = numbers.filter((_, index) => index % 2 === 0);
    const ys = numbers.filter((_, index) => index % 2 === 1);
    const center: Point = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    props[id] = held((ctx, _s, t) => {
      ctx.rotate(spec.angle ?? 0);
      ctx.scale(spec.scale ?? 1, spec.scale ?? 1);
      if (spec.glow) {
        // Đạo cụ phát sáng (đèn lồng, nến): quầng sáng cộng màu, chập chờn nhẹ.
        const radius = size * (2.2 + Math.sin(t * 7) * 0.08);
        const halo = ctx.createRadialGradient(center[0], center[1], 0, center[0], center[1], radius);
        halo.addColorStop(0, spec.glow);
        halo.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = halo;
        ctx.fillRect(center[0] - radius, center[1] - radius, radius * 2, radius * 2);
        ctx.globalCompositeOperation = "source-over";
      }
      ctx.fillStyle = spec.fill ?? "#cccccc";
      ctx.fill(shape);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = spec.stroke ?? ink;
      ctx.stroke(shape);
    }, true);
  }
  return props;
}
