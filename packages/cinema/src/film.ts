import type { CharacterSpec, Expression } from "./character";
import type { Mood } from "./audio";
import type { ActionName, ActionParams, Posture } from "./motion";
import type { SetSpec } from "./set";

export type ShotSize = "establishing" | "wide" | "full" | "medium" | "mediumClose" | "closeUp" | "extremeCloseUp" | "twoShot" | "overShoulder" | "auto";
export type CameraMove = "static" | "push" | "dollyIn" | "dollyOut" | "panLeft" | "panRight" | "tiltUp" | "tiltDown" | "craneUp" | "craneDown" | "follow" | "handheld";

export interface ShotOptions {
  /** Nhân vật được lấy khung; với overShoulder là [người nói, người nghe]. */
  on?: string | string[];
  angle?: "eyeLevel" | "low" | "high" | "dutch";
  move?: CameraMove;
  /** Giữ cảnh tối thiểu bao nhiêu giây. */
  duration?: number;
  transition?: "cut" | "fade" | "fadeWhite";
  /** Làm mờ hậu cảnh; mặc định bật ở cảnh cận. */
  dof?: boolean;
}

export interface ShotSpec extends Omit<ShotOptions, "on"> { size: ShotSize; on: string[] }

export interface Placement {
  x: number;
  facing?: "left" | "right";
  posture?: Posture;
  expression?: Expression;
  hold?: string;
  /** Đứng trên một vật thể di chuyển được (ví dụ thuyền) và đi theo nó. */
  ride?: string;
  lookAt?: string;
}

interface Timing { with?: boolean; delay?: number }
export type Beat =
  | { kind: "shot"; spec: ShotSpec }
  | ({ kind: "say"; who: string; text: string; emotion?: Expression } & Timing)
  | ({ kind: "narrate"; text: string } & Timing)
  | ({ kind: "act"; who: string; action: ActionName; params: ActionParams } & Timing)
  | { kind: "wait"; seconds: number }
  | ({ kind: "move"; id: string; to: number; duration: number } & Timing);

export interface SceneSpec { kind: "scene"; set: string; cast: Record<string, Placement>; beats: Beat[]; music?: Mood }
export interface CardSpec { kind: "card"; title: string; subtitle?: string; seconds: number; music?: Mood }
export type Sequence = SceneSpec | CardSpec;

export interface FilmOptions {
  title: string;
  format?: "landscape" | "portrait" | "square";
  /** Giọng VieNeu-TTS cho lời dẫn. */
  narrator?: string;
  subtitles?: boolean;
  credits?: boolean;
  /** Nhạc nền mặc định của các cảnh. */
  music?: Mood;
  author?: string;
  look?: { grain?: number; vignette?: number; letterbox?: boolean };
}

export interface PropSpec { path: string; fill?: string; stroke?: string; scale?: number; angle?: number; glow?: string }

export interface FilmSpec {
  options: FilmOptions;
  characters: Record<string, CharacterSpec>;
  sets: Record<string, SetSpec>;
  props: Record<string, PropSpec>;
  sequence: Sequence[];
}

export interface SceneBuilder {
  /** Cắt sang một góc máy mới; các nhịp sau thuộc về góc máy này. "auto" để máy tự chia cảnh theo lời thoại. */
  shot(size: ShotSize, options?: ShotOptions): SceneBuilder;
  /** Nhân vật nói (lồng tiếng VieNeu, nhép miệng theo giọng). */
  say(who: string, text: string, options?: { emotion?: Expression } & Timing): SceneBuilder;
  /** Lời dẫn ngoài hình. */
  narrate(text: string, options?: Timing): SceneBuilder;
  /** Diễn xuất: walk, run, turn, sit, kneel, stand, nod, shake, bow, wave, point, handToChest, cry, laugh, think, shrug, embrace, row, give, pickUp, putDown, jump, look, emote. */
  act(who: string, action: ActionName, params?: ActionParams & Timing): SceneBuilder;
  wait(seconds: number): SceneBuilder;
  /** Di chuyển vật thể có id (thuyền, xe…), người đứng trên nó đi theo. */
  move(id: string, options: { to: number; duration: number } & Timing): SceneBuilder;
}

export interface Film {
  spec: FilmSpec;
  cast(characters: Record<string, CharacterSpec>): Film;
  set(id: string, spec: SetSpec): Film;
  prop(id: string, spec: PropSpec): Film;
  /** Thẻ tiêu đề chương. */
  chapter(title: string, subtitle?: string, seconds?: number): Film;
  scene(set: string, cast: Record<string, Placement>, build: (scene: SceneBuilder) => void, options?: { music?: Mood }): Film;
}

export function createFilm(options: FilmOptions): Film {
  const spec: FilmSpec = { options, characters: {}, sets: {}, props: {}, sequence: [] };
  const film: Film = {
    spec,
    cast(characters) { Object.assign(spec.characters, characters); return film; },
    set(id, set) { spec.sets[id] = set; return film; },
    prop(id, prop) { spec.props[id] = prop; return film; },
    chapter(title, subtitle, seconds = 3.2) { spec.sequence.push({ kind: "card", title, subtitle, seconds }); return film; },
    scene(set, cast, build, sceneOptions) {
      const beats: Beat[] = [];
      const builder: SceneBuilder = {
        shot(size, shotOptions = {}) {
          const { on, ...rest } = shotOptions;
          beats.push({ kind: "shot", spec: { size, on: on === undefined ? [] : Array.isArray(on) ? on : [on], ...rest } });
          return builder;
        },
        say(who, text, sayOptions = {}) { beats.push({ kind: "say", who, text, ...sayOptions }); return builder; },
        narrate(text, narrateOptions = {}) { beats.push({ kind: "narrate", text, ...narrateOptions }); return builder; },
        act(who, action, params = {}) {
          const { with: together, delay, ...rest } = params;
          beats.push({ kind: "act", who, action, params: rest, with: together, delay });
          return builder;
        },
        wait(seconds) { beats.push({ kind: "wait", seconds }); return builder; },
        move(id, moveOptions) { beats.push({ kind: "move", id, ...moveOptions }); return builder; },
      };
      build(builder);
      spec.sequence.push({ kind: "scene", set, cast, beats, music: sceneOptions?.music });
      return film;
    },
  };
  return film;
}
