import { rename, rm } from "@toonflow/file";
import type { Renderer } from "./frame";
import type { CompiledShot } from "./timeline";

const ffmpegPath = () => process.env.FFMPEG_PATH || "ffmpeg";

export async function ffmpeg(args: string[], input?: (stdin: import("bun").FileSink) => Promise<void>) {
  const process = Bun.spawn([ffmpegPath(), "-hide_banner", "-loglevel", "error", "-y", ...args], { stdin: input ? "pipe" : "ignore", stdout: "ignore", stderr: "pipe" });
  if (input) {
    const stdin = process.stdin as import("bun").FileSink;
    await input(stdin);
    await stdin.end();
  }
  const code = await process.exited;
  if (code) throw new Error(`FFmpeg lỗi (mã ${code}): ${(await new Response(process.stderr).text()).slice(-1500)}`);
}

/** Dựng một góc máy thành tệp video: vẽ từng khung rồi đẩy thẳng vào x264. */
export async function encodeShot(renderer: Renderer, shot: CompiledShot, file: string, options: { fps: number; size: [number, number]; draft?: boolean; threads: number }) {
  const { fps, size } = options;
  const temporary = `${file}.part.mp4`;
  await ffmpeg([
    "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${size[0]}x${size[1]}`, "-r", String(fps), "-i", "-",
    "-c:v", "libx264", "-preset", options.draft ? "veryfast" : "fast", "-tune", "animation", "-crf", options.draft ? "27" : "18", "-threads", String(options.threads),
    "-pix_fmt", "yuv420p", "-an", temporary,
  ], async stdin => {
    for (let frame = 0; frame < Math.round(shot.duration * fps); frame++) {
      renderer.draw(shot.start + frame / fps + 0.0001);
      // ACT: data() trả vùng nhớ RGBA trực tiếp (nhân sẵn alpha); khung hình luôn phủ kín nền nên dùng như RGBA thường. getImageData chậm và rò bộ nhớ.
      stdin.write(renderer.canvas.data());
      await stdin.flush();
    }
  });
  await rm(file, { force: true });
  await rename(temporary, file);
}
