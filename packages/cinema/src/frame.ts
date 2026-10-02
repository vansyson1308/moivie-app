import { createCanvas, GlobalFonts, Path2D, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { resolve } from "node:path";
import { anchors, drawCharacter, type Pose } from "./character";
import { frameShot, moveEnd, viewAt, wideCenterY, wideHeight, type Subject, type View } from "./camera";
import type { FilmSpec } from "./film";
import { hashSeed, poseAt, random, screenSide } from "./motion";
import { createProps } from "./props";
import { drawElement, drawGround, drawInterior, drawSky, drawSun, drawWeather, elementDepth, lightingFor, palettes, type ElementSpec, type Light } from "./set";
import { elementOffset, stateAt, type CompiledScene, type CompiledShot, type Timeline } from "./timeline";

GlobalFonts.registerFromPath(resolve(import.meta.dirname, "../assets/fonts/beVietnamProExtraBold.ttf"), "Cinema");

const defaultWidth = 1920;

export interface Renderer { canvas: Canvas; draw(time: number): void; shotAt(time: number): CompiledShot }

export function createRenderer(spec: FilmSpec, timeline: Timeline, width: number, height: number): Renderer {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const layer = createCanvas(width, height);
  const layerCtx = layer.getContext("2d");
  // Lớp làm mờ (độ sâu trường ảnh) vẽ ở 1/4 độ phân giải rồi phóng to: rẻ hơn ~16 lần so với blur toàn khung.
  const soft = 4;
  const small = createCanvas(Math.ceil(width / soft), Math.ceil(height / soft));
  const smallCtx = small.getContext("2d");
  const blurred = createCanvas(small.width, small.height);
  const blurredCtx = blurred.getContext("2d");
  const props = createProps(spec.props);
  const paths = new Map<string, Path2D>();
  const path2d = (data: string) => paths.get(data) ?? paths.set(data, new Path2D(data)).get(data)!;
  const unit = height / wideHeight;
  const aspect = width / height;
  const views = new Map<number, [View, View]>();
  // Hạt phim và vignette tính sẵn một lần; mỗi khung chỉ còn hai lần phủ ảnh.
  const look = spec.options.look ?? {};
  const grains = Array.from({ length: (look.grain ?? 0.05) > 0 ? 4 : 0 }, (_, index) => {
    const tile = createCanvas(Math.ceil(width / 2), Math.ceil(height / 2));
    const tileCtx = tile.getContext("2d");
    const noise = tileCtx.createImageData(tile.width, tile.height);
    const rand = random(99 + index);
    for (let offset = 0; offset < noise.data.length; offset += 4) {
      const value = 128 + (rand() - 0.5) * 255;
      noise.data[offset] = value;
      noise.data[offset + 1] = value;
      noise.data[offset + 2] = value;
      noise.data[offset + 3] = 255;
    }
    tileCtx.putImageData(noise, 0, 0);
    return tile;
  });
  const vignette = createCanvas(width, height);
  const vignetteCtx = vignette.getContext("2d");
  const gradient = vignetteCtx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.max(width, height) * 0.75);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${look.vignette ?? 0.38})`);
  vignetteCtx.fillStyle = gradient;
  vignetteCtx.fillRect(0, 0, width, height);

  function shotAt(time: number) {
    let found = timeline.shots[0]!;
    for (const shot of timeline.shots) if (shot.start <= time) found = shot;
    return found;
  }

  function poses(scene: CompiledScene, t: number) {
    const ids = Object.keys(scene.initial);
    const speaker = scene.lines.find(line => line.speaker !== "narrator" && t >= line.start && t <= line.start + line.duration)?.speaker;
    const ride = (id: string, pose: Pose) => {
      const element = (scene.set.elements ?? []).find(item => item.id === scene.initial[id]!.ride);
      if (!element) return;
      pose.x += elementOffset(scene, element.id!, t);
      if (element.type === "boat") pose.y += (element.y ?? 12) - 30 * (element.scale ?? 1) + Math.sin(t * 1.6) * 3;
    };
    const pass = (positions: Record<string, number>) => Object.fromEntries(ids.map(id => {
      const character = timeline.characters[id]!;
      const pose = poseAt(character, stateAt(scene, id, t), scene.actions[id]!, scene.speech[id]!, { t, seed: hashSeed(`${character.id}:${scene.setId}`), positions, speaker, id });
      ride(id, pose);
      return [id, pose];
    }));
    const first = pass(Object.fromEntries(ids.map(id => [id, stateAt(scene, id, t).x])));
    return pass(Object.fromEntries(ids.map(id => [id, first[id]!.x])));
  }

  function subjects(scene: CompiledScene, all: Record<string, Pose>, ids: string[]): Subject[] {
    return ids.filter(id => all[id]).map(id => ({ id, anchors: anchors(timeline.characters[id]!, all[id]!), side: screenSide(all[id]!.yaw) }));
  }

  function view(shot: CompiledShot, scene: CompiledScene, t: number, current: Record<string, Pose>) {
    const setWidth = scene.set.width ?? defaultWidth;
    if (!views.has(shot.index)) {
      const local = shot.start - scene.start;
      const atStart = poses(scene, local + 0.01);
      const everyone = subjects(scene, atStart, Object.keys(atStart));
      const start = frameShot(shot.spec!, subjects(scene, atStart, shot.spec!.on), everyone, aspect, setWidth);
      views.set(shot.index, [start, moveEnd(shot.spec!, start, aspect)]);
    }
    const [start, end] = views.get(shot.index)!;
    const progress = (scene.start + t - shot.start) / Math.max(0.01, shot.duration);
    let follow: number | undefined;
    if (shot.spec!.move === "follow") {
      const target = subjects(scene, current, shot.spec!.on.length ? shot.spec!.on : Object.keys(current))[0];
      if (target) follow = target.anchors.feet[0] + target.side * start.height * aspect * 0.12;
    }
    return viewAt(shot.spec!, start, end, progress, t, follow);
  }

  function transform(target: SKRSContext2D, current: View, depth: number, setWidth: number, factor = 1) {
    const scale = unit * (1 + (wideHeight / current.height - 1) * depth);
    const center = setWidth / 2;
    target.resetTransform();
    target.scale(1 / factor, 1 / factor);
    target.translate(width / 2, height / 2);
    target.rotate(current.roll);
    target.translate(-width / 2, -height / 2);
    target.transform(scale, 0, 0, scale, width / 2 - scale * (center + (current.x - center) * depth), height / 2 - scale * (wideCenterY + (current.y - wideCenterY) * depth));
    return scale;
  }

  function project(current: View, depth: number, setWidth: number, x: number, y: number): [number, number, number] {
    const scale = unit * (1 + (wideHeight / current.height - 1) * depth);
    const center = setWidth / 2;
    return [width / 2 + scale * ((x - center) - (current.x - center) * depth), height / 2 + scale * ((y - wideCenterY) - (current.y - wideCenterY) * depth), scale];
  }

  function drawScene(shot: CompiledShot, scene: CompiledScene, time: number) {
    const t = time - scene.start;
    const set = scene.set;
    const setWidth = set.width ?? defaultWidth;
    const palette = palettes[set.time ?? "morning"];
    const current = poses(scene, t);
    const camera = view(shot, scene, t, current);
    const zoom = wideHeight / camera.height;
    const dof = shot.spec!.dof ?? zoom > 1.7;
    const lights: Light[] = [];
    const elements = (set.elements ?? []).map(element => {
      const offset = element.id ? elementOffset(scene, element.id, t) : 0;
      return { ...element, x: (element.x ?? setWidth / 2) + offset } as ElementSpec;
    });
    const context = (pass: "back" | "front") => ({ t, palette, time: set.time ?? "morning", pass, lights, width: setWidth });

    ctx.resetTransform();
    if (set.interior) {
      ctx.fillStyle = set.interior.wall ?? "#d9c6a5";
      ctx.fillRect(0, 0, width, height);
    } else {
      drawSky(ctx, palette, set.time ?? "morning", width, height, t);
      drawSun(ctx, palette, set.time ?? "morning", width, project(camera, 0.12, setWidth, 0, -150)[1], unit);
    }
    const depths = [...new Set([...(set.interior ? [0.92] : []), ...elements.map(elementDepth)])].filter(depth => depth < 1).sort((a, b) => a - b);
    // Mỗi lớp: vẽ phần tử → phủ màu chân trời theo độ xa → làm mờ khi máy quay cận → đặt lên khung.
    const paintLayer = (depth: number, draw: (target: SKRSContext2D) => void, haze: number, blur: number) => {
      const factor = blur > 0.4 ? soft : 1;
      const target = factor === 1 ? layerCtx : smallCtx;
      const surface = factor === 1 ? layer : small;
      target.resetTransform();
      target.clearRect(0, 0, surface.width, surface.height);
      transform(target, camera, depth, setWidth, factor);
      draw(target);
      if (haze > 0) {
        target.resetTransform();
        target.globalCompositeOperation = "source-atop";
        target.globalAlpha = haze;
        target.fillStyle = palette.haze;
        target.fillRect(0, 0, surface.width, surface.height);
        target.globalAlpha = 1;
        target.globalCompositeOperation = "source-over";
      }
      ctx.resetTransform();
      if (factor === 1) {
        ctx.drawImage(layer, 0, 0);
        return;
      }
      blurredCtx.resetTransform();
      blurredCtx.clearRect(0, 0, blurred.width, blurred.height);
      blurredCtx.filter = `blur(${Math.max(0.5, blur / soft).toFixed(2)}px)`;
      blurredCtx.drawImage(small, 0, 0);
      blurredCtx.filter = "none";
      ctx.imageSmoothingQuality = "medium";
      ctx.drawImage(blurred, 0, 0, width, height);
    };
    for (const depth of depths) {
      paintLayer(depth, target => {
        if (set.interior && depth === 0.92) drawInterior(target, set, setWidth);
        for (const element of elements.filter(item => elementDepth(item) === depth)) {
          drawElement(target, element, context("back"), path2d);
          drawElement(target, element, context("front"), path2d);
        }
      }, set.interior ? 0 : (1 - depth) * 0.5, dof ? Math.min(9, (zoom - 1.2) * 2.4 * (1 - depth)) * unit : 0);
    }

    transform(ctx, camera, 1, setWidth);
    drawGround(ctx, set, setWidth);
    const plane = elements.filter(item => elementDepth(item) === 1);
    for (const element of plane) drawElement(ctx, element, context("back"), path2d);
    const lighting = lightingFor(set);
    for (const [id, pose] of Object.entries(current)) drawCharacter(ctx, timeline.characters[id]!, pose, props, t, lighting);
    for (const element of plane) drawElement(ctx, element, context("front"), path2d);

    for (const element of elements.filter(item => elementDepth(item) > 1)) {
      const depth = elementDepth(element);
      paintLayer(depth, target => {
        drawElement(target, element, context("back"), path2d);
        drawElement(target, element, context("front"), path2d);
      }, 0, dof ? Math.min(8, (depth - 1) * 16) * unit : 0);
    }

    ctx.resetTransform();
    const screenLights: { x: number; y: number }[] = [];
    if (set.weather && set.weather !== "none") drawWeather(ctx, set.weather, width, height, t, screenLights);
    // Chỉnh màu theo giờ: tông màu (soft-light), bóng tối (multiply), rồi nguồn sáng phát quang (screen).
    if (palette.tintAlpha) {
      ctx.globalCompositeOperation = "soft-light";
      ctx.globalAlpha = palette.tintAlpha;
      ctx.fillStyle = palette.tint;
      ctx.fillRect(0, 0, width, height);
    }
    if (palette.dark && !set.interior) {
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = palette.dark;
      ctx.fillStyle = "#1c2450";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 1;
    for (const light of lights) {
      const [x, y, scale] = project(camera, light.depth, setWidth, light.x, light.y);
      const radius = light.radius * scale;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, light.color);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function wrap(text: string, maxWidth: number) {
    const lines: string[] = [];
    for (const word of text.split(/\s+/)) {
      const candidate = lines.length ? `${lines.at(-1)} ${word}` : word;
      if (lines.length && ctx.measureText(candidate).width <= maxWidth) lines[lines.length - 1] = candidate;
      else lines.push(word);
    }
    return lines;
  }

  function drawCard(shot: CompiledShot, time: number) {
    const local = time - shot.start;
    ctx.resetTransform();
    ctx.fillStyle = "#0d0b0a";
    ctx.fillRect(0, 0, width, height);
    const alpha = Math.min(1, local / 0.7, (shot.duration - local) / 0.7);
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const card = shot.card!;
    if (card.credits) {
      const lineHeight = height * 0.05;
      const offset = height * 0.9 - (local / shot.duration) * (card.credits.length * lineHeight + height * 0.6);
      card.credits.forEach((line, index) => {
        ctx.font = `${Math.round(height * (index === 0 ? 0.05 : 0.03))}px Cinema`;
        ctx.fillStyle = index === 0 ? "#f3e3c3" : "#cfc6b8";
        ctx.fillText(line, width / 2, offset + index * lineHeight * (index === 0 ? 1.6 : 1));
      });
    } else {
      ctx.font = `${Math.round(height * 0.062)}px Cinema`;
      ctx.fillStyle = "#f3e3c3";
      ctx.fillText(card.title, width / 2, height * (card.subtitle ? 0.46 : 0.5), width * 0.86);
      if (card.subtitle) {
        ctx.font = `${Math.round(height * 0.03)}px Cinema`;
        ctx.fillStyle = "#b9ad9c";
        ctx.fillText(card.subtitle, width / 2, height * 0.56, width * 0.86);
      }
    }
    ctx.globalAlpha = 1;
  }

  function finish(shot: CompiledShot, time: number) {
    ctx.resetTransform();
    ctx.drawImage(vignette, 0, 0);
    if (grains.length) {
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = look.grain ?? 0.05;
      ctx.imageSmoothingQuality = "low";
      // ACT: 4 mẫu hạt luân phiên 12 lần/giây; hạt đổi mỗi khung làm x264 chậm hẳn.
      ctx.drawImage(grains[Math.floor(time * 12) % grains.length]!, 0, 0, width, height);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    if (look.letterbox && width > height) {
      const bar = (height - width / 2.39) / 2;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, bar);
      ctx.fillRect(0, height - bar, width, bar);
    }
    // Chuyển cảnh mờ dần: vào từ đen ở góc máy có transition fade, ra đen trước thẻ chương.
    const next = timeline.shots[shot.index + 1];
    const local = time - shot.start;
    let fade = 0;
    if (shot.spec?.transition === "fade" || shot.spec?.transition === "fadeWhite" || (shot.index > 0 && timeline.shots[shot.index - 1]!.card)) fade = Math.max(fade, 1 - local / 0.6);
    if (next && (next.card || next.spec?.transition === "fade" || next.spec?.transition === "fadeWhite") && !shot.card) fade = Math.max(fade, 1 - (shot.duration - local) / 0.6);
    if (!next && !shot.card) fade = Math.max(fade, 1 - (shot.duration - local) / 0.8);
    if (fade > 0) {
      ctx.globalAlpha = Math.min(1, fade);
      ctx.fillStyle = shot.spec?.transition === "fadeWhite" || next?.spec?.transition === "fadeWhite" ? "#ffffff" : "#000000";
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    if (spec.options.subtitles !== false && !shot.card) {
      const line = timeline.lines.find(item => time >= item.start && time <= item.start + item.duration + 0.15);
      if (line) {
        const size = Math.round(Math.min(width, height * 1.6) * 0.03);
        ctx.font = `${size}px Cinema`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const rows = wrap(line.text, width * 0.84);
        const bottom = height * (width > height ? 0.93 : 0.87);
        rows.forEach((row, index) => {
          const y = bottom - (rows.length - 1 - index) * size * 1.3;
          ctx.lineWidth = size * 0.22;
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(10,8,6,0.9)";
          ctx.strokeText(row, width / 2, y);
          ctx.fillStyle = line.speaker === "narrator" ? "#f6e7c4" : "#ffffff";
          ctx.fillText(row, width / 2, y);
        });
      }
    }
  }

  return {
    canvas,
    shotAt,
    draw(time) {
      const shot = shotAt(time);
      if (shot.card) drawCard(shot, time);
      else drawScene(shot, timeline.scenes[shot.scene!]!, time);
      finish(shot, time);
    },
  };
}
