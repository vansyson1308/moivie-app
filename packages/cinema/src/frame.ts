import { createCanvas, GlobalFonts, Path2D, type Canvas, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { resolve } from "node:path";
import { anchors, drawCharacter, rig, type Pose } from "./character";
import { frameShot, moveEnd, viewAt, wideCenterY, wideHeight, type Subject, type View } from "./camera";
import type { FilmSpec } from "./film";
import { hashSeed, poseAt, random, screenSide } from "./motion";
import { createProps } from "./props";
import { drawElement, drawGround, drawInterior, drawSky, drawSun, drawWeather, elementDepth, lightingFor, palettes, type ElementSpec, type Light } from "./set";
import { elementOffset, stateAt, transitionLength, type CompiledScene, type CompiledShot, type Timeline } from "./timeline";

GlobalFonts.registerFromPath(resolve(import.meta.dirname, "../assets/fonts/beVietnamProExtraBold.ttf"), "Cinema");

const defaultWidth = 1920;

export interface Renderer {
  canvas: Canvas;
  draw(time: number): void;
  shotAt(time: number): CompiledShot;
  /** Vị trí ngang của nhân vật trên màn hình lúc time (−1 mép trái … +1 mép phải), undefined khi không có trong cảnh. */
  locate(id: string, time: number): number | undefined;
  /** Đặt khung 3D cho lần vẽ kế tiếp (theo số thứ tự góc máy); góc máy có khung 3D thì không vẽ cảnh 2D. */
  usePlates(plates: Map<number, Image>): void;
  /** Trạng thái sân khấu lúc time nhìn qua máy quay của shot (mặc định góc máy đang chiếu): dữ liệu cho bộ dựng 3D. */
  stage(time: number, shot?: CompiledShot): Stage | undefined;
}

/** Ảnh chụp sân khấu tại một thời điểm: máy quay, tư thế và khung xương từng diễn viên, vị trí vật thể đang di chuyển. */
export interface Stage {
  setId: string;
  setWidth: number;
  t: number;
  camera: View;
  shot: { size: string; angle?: string; dof?: boolean };
  actors: { id: string; pose: Pose; joints: Record<string, [number, number, number]>; head: [number, number, number]; torso: number[] }[];
  offsets: Record<string, number>;
}

/** motionBlur: dựng thêm khung phụ trong màn trập 180° khi hình chuyển động nhanh (tắt ở bản nháp). */
export function createRenderer(spec: FilmSpec, timeline: Timeline, width: number, height: number, options: { motionBlur?: boolean; fps?: number } = {}): Renderer {
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
  // Khung của góc máy trước, giữ lại để hòa hình / gạt / mở vòng tròn sang góc máy mới.
  const under = createCanvas(width, height);
  const underCtx = under.getContext("2d");
  // Tâm vòng iris: gương mặt nhân vật chính của góc máy vừa vẽ (toạ độ màn hình).
  let focus: [number, number] = [width / 2, height / 2];
  // Motion blur chỉ cho lớp diễn viên: hậu cảnh (phần đắt nhất, có làm mờ độ sâu) vẽ một lần.
  const actors = createCanvas(width, height);
  const actorsCtx = actors.getContext("2d");
  const accumulator = createCanvas(width, height);
  const accumulatorCtx = accumulator.getContext("2d");
  const fps = options.fps ?? 24;
  const props = createProps(spec.props);
  const paths = new Map<string, Path2D>();
  const path2d = (data: string) => paths.get(data) ?? paths.set(data, new Path2D(data)).get(data)!;
  const unit = height / wideHeight;
  const aspect = width / height;
  const views = new Map<number, [View, View]>();
  // Khung 3D của khung hình đang vẽ, theo số thứ tự góc máy (góc máy hiện tại và góc máy trước khi đang hòa hình).
  let plates = new Map<number, Image>();
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
    let sun: ReturnType<typeof drawSun>;
    if (set.interior) {
      ctx.fillStyle = set.interior.wall ?? "#d9c6a5";
      ctx.fillRect(0, 0, width, height);
    } else {
      drawSky(ctx, palette, set.time ?? "morning", width, height, t);
      sun = drawSun(ctx, palette, set.time ?? "morning", width, project(camera, 0.12, setWidth, 0, -150)[1], unit);
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
    // Bóng phản chiếu trên mặt nước: thuyền và người trên thuyền lật quanh mép nước, mờ dần, gợn theo sóng.
    for (const boat of plane.filter(item => item.type === "boat")) {
      const scale = boat.scale ?? 1;
      const water = (boat.y ?? 12) + Math.sin(t * 1.6) * 3 + 26 * scale;
      const riders = Object.entries(current).filter(([id]) => scene.initial[id]!.ride === boat.id);
      ctx.save();
      const below = new Path2D();
      below.rect((boat.x ?? 0) - 400 * scale, water, 800 * scale, 500 * scale);
      ctx.clip(below);
      ctx.translate(0, water * 2);
      ctx.scale(1, -1);
      ctx.globalAlpha = 0.22;
      drawElement(ctx, boat, context("front"), path2d);
      for (const [id, pose] of riders) drawCharacter(ctx, timeline.characters[id]!, { ...pose, x: pose.x + Math.sin(t * 2.3) * 2 }, props, t, lightingFor(set));
      ctx.restore();
    }
    for (const element of plane) drawElement(ctx, element, context("back"), path2d);
    const lighting = lightingFor(set);
    const lead = current[shot.spec!.on[0] ?? ""] ?? Object.values(current)[0];
    const leadId = shot.spec!.on[0] ?? Object.keys(current)[0];
    if (lead && leadId) {
      const head = anchors(timeline.characters[leadId]!, lead).head;
      const [x, y] = project(camera, 1, setWidth, head[0], head[1]);
      focus = [Math.min(width, Math.max(0, x)), Math.min(height, Math.max(0, y))];
    } else {
      focus = [width / 2, height / 2];
    }
    // Màn trập 180°: khi diễn viên dịch nhanh trên màn hình, chia nửa khung thành n ≤ 4 khung phụ (mỗi khung phụ dịch ≤ ~4 điểm ảnh
    // ở 1080p) và lấy trung bình trong không gian nhân sẵn alpha (cộng "lighter" với trọng số 1/n).
    // ACT: hậu cảnh không nhoè theo máy quay; nếu cần nhoè khi lia nhanh thì làm mờ có hướng cho các lớp nền.
    const samples = options.motionBlur ? Math.min(4, Math.ceil(motion(shot, scene, t) / (4 * height / 1080))) : 1;
    if (samples > 1) {
      accumulatorCtx.resetTransform();
      accumulatorCtx.clearRect(0, 0, width, height);
      for (let index = 0; index < samples; index++) {
        const at = t + (index / (samples - 1) - 0.5) * 0.5 / fps;
        const moment = poses(scene, at);
        actorsCtx.resetTransform();
        actorsCtx.clearRect(0, 0, width, height);
        transform(actorsCtx, view(shot, scene, at, moment), 1, setWidth);
        for (const [id, pose] of Object.entries(moment)) drawCharacter(actorsCtx, timeline.characters[id]!, pose, props, at, lighting);
        actorsCtx.resetTransform();
        accumulatorCtx.globalCompositeOperation = "lighter";
        accumulatorCtx.globalAlpha = 1 / samples;
        accumulatorCtx.drawImage(actors, 0, 0);
      }
      accumulatorCtx.globalCompositeOperation = "source-over";
      accumulatorCtx.globalAlpha = 1;
      ctx.resetTransform();
      ctx.drawImage(accumulator, 0, 0);
      transform(ctx, camera, 1, setWidth);
    } else {
      for (const [id, pose] of Object.entries(current)) drawCharacter(ctx, timeline.characters[id]!, pose, props, t, lighting);
    }
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
    // Tia nắng: vài dải sáng toả từ mặt trời khi nắng xiên (bình minh, chiều vàng, hoàng hôn), xoay rất chậm.
    if (sun && (set.time === "dawn" || set.time === "golden" || set.time === "dusk" || set.time === "morning")) {
      ctx.globalCompositeOperation = "screen";
      const reach = Math.hypot(width, height) * 1.1;
      const rays = random(hashSeed(scene.setId));
      for (let index = 0; index < 9; index++) {
        const angle = Math.PI * (0.15 + 0.7 * (index + rays() * 0.6) / 9) + Math.sin(t * 0.05 + index) * 0.03;
        const spread = 0.025 + rays() * 0.035;
        // Gốc tia mờ (không lộ đỉnh quạt), đậm nhất cách mặt trời một đoạn rồi tan dần; cận cảnh hậu cảnh đã mờ thì tia nhạt hơn.
        const strength = Math.round((set.time === "morning" ? 0x1c : 0x30) * (dof ? 0.45 : 1)).toString(16).padStart(2, "0");
        const gradient = ctx.createRadialGradient(sun.x, sun.y, sun.radius, sun.x, sun.y, reach);
        gradient.addColorStop(0, "rgba(0,0,0,0)");
        gradient.addColorStop(0.18, sun.color.length === 7 ? `${sun.color}${strength}` : sun.color);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.moveTo(sun.x, sun.y);
        ctx.lineTo(sun.x + Math.cos(angle - spread) * reach, sun.y + Math.sin(angle - spread) * reach);
        ctx.lineTo(sun.x + Math.cos(angle + spread) * reach, sun.y + Math.sin(angle + spread) * reach);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    }
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
    bloom(set.time === "night" || set.time === "dusk" ? 0.45 : 0.28);
    // Chỉnh màu lift–gain: đen nâng lên thành màu tối có sắc (không bao giờ đen kịt), vùng sáng nhuộm theo giờ.
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.lift;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = palette.gain;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
  }

  /** Bloom: tách vùng rất sáng ở 1/4 độ phân giải, làm nhoè rồi cộng sáng lại — ánh sáng "loang" như qua ống kính thật. */
  function bloom(strength: number) {
    smallCtx.resetTransform();
    smallCtx.clearRect(0, 0, small.width, small.height);
    smallCtx.filter = "brightness(0.7) contrast(5)";
    smallCtx.drawImage(canvas, 0, 0, small.width, small.height);
    smallCtx.filter = "none";
    blurredCtx.resetTransform();
    blurredCtx.clearRect(0, 0, blurred.width, blurred.height);
    blurredCtx.filter = `blur(${(height / 1080 * 7).toFixed(1)}px)`;
    blurredCtx.drawImage(small, 0, 0);
    blurredCtx.filter = "none";
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = strength;
    ctx.imageSmoothingQuality = "medium";
    ctx.drawImage(blurred, 0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  /**
   * Khung 3D từ Blender (plate) thay cho cảnh vẽ 2D: ánh sáng và màu đã tính vật lý trong Cycles, ở đây chỉ phủ thời tiết
   * (đom đóm, mưa...) và bloom ống kính; chuyển cảnh, phụ đề, hạt phim vẫn qua cùng một đường như bản 2D.
   * ACT: tâm vòng iris giữ giữa khung với plate; muốn bám mặt nhân vật thì chiếu toạ độ đầu qua máy quay 3D.
   */
  function drawPlate(shot: CompiledShot, time: number, plate: Image) {
    const set = timeline.scenes[shot.scene!]!.set;
    ctx.resetTransform();
    ctx.drawImage(plate, 0, 0, width, height);
    focus = [width / 2, height / 2];
    if (set.weather && set.weather !== "none") drawWeather(ctx, set.weather, width, height, time - timeline.scenes[shot.scene!]!.start, []);
    bloom(set.time === "night" || set.time === "dusk" ? 0.3 : 0.18);
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
    const dip = (item?: CompiledShot) => item?.spec?.transition === "fade" || item?.spec?.transition === "fadeWhite";
    if (dip(shot) || (shot.index > 0 && timeline.shots[shot.index - 1]!.card)) fade = Math.max(fade, 1 - local / (transitionLength(shot) || 0.6));
    if (next && (next.card || dip(next)) && !shot.card) fade = Math.max(fade, 1 - (shot.duration - local) / (transitionLength(next) || 0.6));
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

  function drawRaw(shot: CompiledShot, time: number) {
    const plate = plates.get(shot.index);
    if (shot.card) drawCard(shot, time);
    else if (plate) drawPlate(shot, time, plate);
    else drawScene(shot, timeline.scenes[shot.scene!]!, time);
  }

  /**
   * Chuyển cảnh chồng hình diễn ra trong những khung đầu của góc máy mới: góc máy cũ được vẽ tiếp (cảnh của nó vẫn
   * chạy theo thời gian) rồi trộn với góc máy mới. Mỗi góc máy vẫn là một tệp độc lập, ghép nối không cần mã hoá lại.
   */
  function blend(shot: CompiledShot, time: number) {
    const kind = shot.spec?.transition;
    const length = transitionLength(shot);
    const previous = timeline.shots[shot.index - 1];
    const local = time - shot.start;
    if (!previous || !length || local >= length || (kind !== "dissolve" && kind !== "wipe" && kind !== "iris")) return;
    const p = local / length;
    const eased = p * p * (3 - 2 * p);
    const [fx, fy] = focus;
    underCtx.resetTransform();
    underCtx.drawImage(canvas, 0, 0);
    drawRaw(previous, time);
    // Lúc này canvas là góc máy cũ, under là góc máy mới: đặt góc máy mới lên trên theo mặt nạ của kiểu chuyển.
    ctx.resetTransform();
    ctx.save();
    if (kind === "dissolve") {
      ctx.globalAlpha = eased;
      ctx.drawImage(under, 0, 0);
    } else if (kind === "wipe") {
      // Gạt theo hướng nhìn của nhân vật chính, mép gạt mềm.
      const subject = shot.spec!.on[0];
      const scene = shot.scene === undefined ? undefined : timeline.scenes[shot.scene];
      const toLeft = subject && scene ? Math.sin(stateAt(scene, subject, time - scene.start).yaw) < 0 : false;
      const edge = width * 0.06;
      const reach = (width + edge * 2) * eased - edge;
      const x = toLeft ? width - reach : reach;
      const mask = ctx.createLinearGradient(x - edge, 0, x + edge, 0);
      mask.addColorStop(0, toLeft ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)");
      mask.addColorStop(1, toLeft ? "rgba(0,0,0,1)" : "rgba(0,0,0,0)");
      underCtx.globalCompositeOperation = "destination-in";
      underCtx.fillStyle = mask;
      underCtx.fillRect(0, 0, width, height);
      underCtx.globalCompositeOperation = "source-over";
      ctx.drawImage(under, 0, 0);
    } else {
      const radius = Math.hypot(Math.max(fx, width - fx), Math.max(fy, height - fy)) * eased;
      const circle = new Path2D();
      circle.arc(fx, fy, Math.max(0.5, radius), 0, Math.PI * 2);
      ctx.clip(circle);
      ctx.drawImage(under, 0, 0);
    }
    ctx.restore();
  }

  /** Độ dịch chuyển lớn nhất của diễn viên trên màn hình (điểm ảnh) trong nửa khung hình: đầu, hai tay, chân. */
  function motion(shot: CompiledShot, scene: CompiledScene, t: number) {
    const setWidth = scene.set.width ?? defaultWidth;
    const points = (at: number) => {
      const current = poses(scene, at);
      const camera = view(shot, scene, at, current);
      return Object.entries(current).flatMap(([id, pose]) => {
        const marks = anchors(timeline.characters[id]!, pose);
        return [marks.head, marks.hands.front, marks.hands.back, marks.feet].map(([x, y]) => project(camera, 1, setWidth, x, y));
      });
    };
    const [a, b] = [points(t - 0.25 / fps), points(t + 0.25 / fps)];
    return a.reduce((most, point, index) => Math.max(most, Math.hypot(point[0] - b[index]![0], point[1] - b[index]![1])), 0);
  }

  return {
    canvas,
    shotAt,
    usePlates(next) {
      plates = next;
    },
    stage(time, chosen) {
      const shot = chosen ?? shotAt(time);
      if (shot.card || shot.scene === undefined) return undefined;
      const scene = timeline.scenes[shot.scene]!;
      const t = time - scene.start;
      const current = poses(scene, t);
      const camera = view(shot, scene, t, current);
      const b = (id: string) => timeline.characters[id]!.body;
      const actors = Object.entries(current).map(([id, pose]) => {
        const { joints, headCenter, torso } = rig(timeline.characters[id]!, pose);
        // Hệ toạ độ thân sau khi cúi/nghiêng/thở: gốc tại hông, ba trục x (trái), y (xuống), z (trước) — bộ dựng 3D đặt khối thân theo đó.
        const origin = torso([0, b(id).hipY, 0]);
        const axis = (p: [number, number, number]) => torso(p).map((value, index) => value - origin[index]!);
        return {
          id, pose, joints: joints as Record<string, [number, number, number]>, head: headCenter,
          torso: [...origin, ...axis([1, b(id).hipY, 0]), ...axis([0, b(id).hipY - 1, 0]).map(value => -value), ...axis([0, b(id).hipY, 1])],
        };
      });
      const offsets = Object.fromEntries((scene.set.elements ?? []).filter(element => element.id).map(element => [element.id!, elementOffset(scene, element.id!, t)]));
      return { setId: scene.setId, setWidth: scene.set.width ?? defaultWidth, t, camera, shot: { size: shot.spec!.size, angle: shot.spec!.angle, dof: shot.spec!.dof }, actors, offsets };
    },
    locate(id, time) {
      const shot = shotAt(time);
      if (shot.card) return undefined;
      const scene = timeline.scenes[shot.scene!]!;
      const t = time - scene.start;
      const current = poses(scene, t);
      if (!current[id]) return undefined;
      const camera = view(shot, scene, t, current);
      const head = anchors(timeline.characters[id]!, current[id]!).head;
      return project(camera, 1, scene.set.width ?? defaultWidth, head[0], head[1])[0] / width * 2 - 1;
    },
    draw(time) {
      const shot = shotAt(time);
      drawRaw(shot, time);
      blend(shot, time);
      finish(shot, time);
    },
  };
}
