import type { CharacterAnchors } from "./character";
import type { ShotSpec } from "./film";
import { lerp, smooth } from "./motion";

/** Khung nhìn của máy quay trong toạ độ thế giới: tâm (x, y) và chiều cao thấy được. */
export interface View { x: number; y: number; height: number; roll: number }

export const wideHeight = 1080;
/** Tâm dọc mặc định: mặt đất nằm ở khoảng 84% chiều cao khung toàn cảnh. */
export const wideCenterY = -wideHeight * 0.34;

export interface Subject { id: string; anchors: CharacterAnchors; facing: 1 | -1 }

function single(spec: ShotSpec, subject: Subject, partner: Subject | undefined, aspect: number): View {
  const { anchors } = subject;
  const height = anchors.feet[1] - anchors.top;
  const lead = partner ? Math.sign(partner.anchors.feet[0] - anchors.feet[0]) || subject.facing : subject.facing;
  const sizes: Record<string, [number, (h: number) => number, number]> = {
    full: [1.45, h => anchors.feet[1] - h * 0.42, 0.1],
    medium: [0.8, h => anchors.top + h * 0.4, 0.16],
    mediumClose: [0.55, h => anchors.top + h * 0.4, 0.18],
    closeUp: [0.36, h => anchors.head[1] + h * 0.06, 0.18],
    extremeCloseUp: [0.2, () => anchors.head[1], 0.08],
  };
  const [factor, center, leadRoom] = sizes[spec.size] ?? sizes.medium!;
  // Khổ dọc hẹp ngang: cỡ cảnh từ trung cận trở vào phải đủ bề ngang cho đầu và vai.
  const widthNeed = { medium: 0.55, mediumClose: 0.5, closeUp: 0.42, extremeCloseUp: 0.26 }[spec.size as string] ?? 0;
  const view = Math.max(height * factor, height * widthNeed / aspect);
  return { x: anchors.feet[0] + lead * view * aspect * leadRoom, y: center(view), height: view, roll: 0 };
}

/** Lấy khung theo cỡ cảnh, tính từ toạ độ thật của nhân vật trên sân khấu. */
export function frameShot(spec: ShotSpec, subjects: Subject[], everyone: Subject[], aspect: number, setWidth: number): View {
  const cast = subjects.length ? subjects : everyone;
  const centerX = cast.length ? cast.reduce((sum, item) => sum + item.anchors.feet[0], 0) / cast.length : setWidth / 2;
  let view: View;
  if (spec.size === "establishing" || spec.size === "wide" || spec.size === "auto" || !cast.length) {
    const height = spec.size === "establishing" ? wideHeight * 1.3 : wideHeight;
    view = { x: centerX, y: -height * 0.34, height, roll: 0 };
  } else if (spec.size === "twoShot") {
    const xs = cast.map(item => item.anchors.feet[0]);
    const tallest = Math.max(...cast.map(item => item.anchors.feet[1] - item.anchors.top));
    const width = Math.max(...xs) - Math.min(...xs) + tallest * 0.9;
    const height = Math.max(tallest * 1.35, width / aspect);
    view = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: Math.max(...cast.map(item => item.anchors.feet[1])) - height * 0.4, height, roll: 0 };
  } else if (spec.size === "overShoulder" && cast.length > 1) {
    const [speaker, listener] = cast as [Subject, Subject];
    // Người nói chiếm khoảng 1/3 khung, vai người nghe lấp ló ở mép đối diện.
    const height = (speaker.anchors.feet[1] - speaker.anchors.top) * 0.66;
    const gap = listener.anchors.feet[0] - speaker.anchors.feet[0];
    view = { x: speaker.anchors.feet[0] + Math.sign(gap) * height * aspect * 0.2, y: speaker.anchors.head[1] + height * 0.16, height, roll: 0 };
    if (Math.abs(gap) > height * aspect * 1.1) view = single({ ...spec, size: "mediumClose" }, speaker, listener, aspect);
  } else {
    view = single(spec, cast[0]!, cast[1], aspect);
  }
  if (spec.angle === "low") view.y += view.height * 0.1;
  if (spec.angle === "high") view.y -= view.height * 0.1;
  if (spec.angle === "dutch") view.roll = 0.07;
  return view;
}

/** Điểm cuối của chuyển động máy trong suốt góc máy. */
export function moveEnd(spec: ShotSpec, start: View, aspect: number): View {
  const end = { ...start };
  const width = start.height * aspect;
  switch (spec.move) {
    case "push": end.height *= 0.9; break;
    case "dollyIn": end.height *= 0.78; break;
    case "dollyOut": end.height *= 1.3; end.y -= start.height * 0.08; break;
    case "panLeft": end.x -= width * 0.28; break;
    case "panRight": end.x += width * 0.28; break;
    case "tiltUp": end.y -= start.height * 0.25; break;
    case "tiltDown": end.y += start.height * 0.25; break;
    case "craneUp": end.y -= start.height * 0.3; end.height *= 1.15; break;
    case "craneDown": end.y += start.height * 0.25; end.height *= 0.9; break;
    default: break;
  }
  return end;
}

export function viewAt(spec: ShotSpec, start: View, end: View, progress: number, time: number, follow?: number): View {
  const p = smooth(progress);
  const view: View = {
    x: lerp(start.x, end.x, p), y: lerp(start.y, end.y, p), height: lerp(start.height, end.height, p), roll: lerp(start.roll, end.roll, p),
  };
  if (spec.move === "follow" && follow !== undefined) view.x = follow;
  if (spec.move === "handheld" || spec.move === "follow") {
    // Máy cầm tay: rung nhẹ bằng tổng các sóng sin lệch pha (tất định).
    const amount = view.height * 0.006;
    view.x += (Math.sin(time * 1.7) + Math.sin(time * 2.9 + 1) * 0.6) * amount;
    view.y += (Math.sin(time * 2.3 + 2) + Math.sin(time * 3.7) * 0.5) * amount;
    view.roll += Math.sin(time * 1.1) * 0.004;
  }
  return view;
}
