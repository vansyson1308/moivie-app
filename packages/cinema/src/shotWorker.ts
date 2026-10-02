import { encodeShot } from "./encode";
import { createRenderer, type Renderer } from "./frame";
import type { FilmSpec } from "./film";
import type { Segment } from "./render";
import type { Timeline } from "./timeline";

declare const self: Worker;

interface Setup { spec: FilmSpec; timeline: Timeline; size: [number, number]; fps: number; draft?: boolean; threads: number }
let setup: Setup | undefined;
let renderer: Renderer | undefined;

// Mỗi luồng giữ một bộ dựng riêng và nhận lần lượt từng đoạn từ tiến trình chính.
self.onmessage = async (event: MessageEvent<{ setup?: Setup; job?: Segment }>) => {
  if (event.data.setup) {
    setup = event.data.setup;
    renderer = createRenderer(setup.spec, setup.timeline, ...setup.size);
    return;
  }
  const job = event.data.job!;
  const started = performance.now();
  try {
    await encodeShot(renderer!, job, setup!);
    self.postMessage({ done: true, seconds: (performance.now() - started) / 1000 });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
