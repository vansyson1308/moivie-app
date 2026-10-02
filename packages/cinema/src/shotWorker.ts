import { encodeShot } from "./encode";
import { createRenderer, type Renderer } from "./frame";
import type { FilmSpec } from "./film";
import type { Timeline } from "./timeline";

declare const self: Worker;

interface Setup { spec: FilmSpec; timeline: Timeline; size: [number, number]; fps: number; draft?: boolean; threads: number }
let setup: Setup | undefined;
let renderer: Renderer | undefined;

// Mỗi luồng giữ một bộ dựng riêng và nhận lần lượt từng góc máy từ tiến trình chính.
self.onmessage = async (event: MessageEvent<{ setup?: Setup; job?: { index: number; file: string } }>) => {
  if (event.data.setup) {
    setup = event.data.setup;
    renderer = createRenderer(setup.spec, setup.timeline, ...setup.size);
    return;
  }
  const job = event.data.job!;
  const started = performance.now();
  try {
    await encodeShot(renderer!, setup!.timeline.shots[job.index]!, job.file, setup!);
    self.postMessage({ done: job.index, seconds: (performance.now() - started) / 1000 });
  } catch (error) {
    self.postMessage({ failed: job.index, error: error instanceof Error ? error.message : String(error) });
  }
};
