import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { access } from "@toonflow/file";
import type { CinemaRequest, CinemaResult } from "@toonflow/tools-scaffold/runtime";
import conf from "@/utils/conf";
import { createWorkspaceFfmpeg, getStatus } from "@/utils/ffmpeg";
import { isWithin, resolveWorkspacePath } from "@/utils/workspace/files";

export type { CinemaRequest, CinemaResult };

/** Bộ dựng phim chạy như một tiến trình bun riêng (cần canvas gốc và luồng phụ, không gói được vào server). */
function cliPath() {
  const root = process.env.TOONFLOW_CINEMA_ROOT;
  return root ? join(resolve(root), "cli.ts") : Bun.resolveSync("@toonflow/cinema/cli", import.meta.dirname);
}

// ACT: mỗi workspace chỉ dựng một phim cùng lúc (khoá trong tiến trình, như các thao tác tệp khác của server).
const running = new Set<string>();

/**
 * Chạy một lệnh của bộ dựng trong workspace: kiểm tra kịch bản, storyboard, khung hình, dựng phim hoặc cài giọng đọc.
 * Từng dòng nhật ký được gửi qua onLine; kết quả là các tệp trong workspace mà lệnh đã tạo (đường dẫn tương đối).
 */
export async function runCinema(cwd: string, request: CinemaRequest, onLine: (line: string) => void, signal: AbortSignal): Promise<CinemaResult> {
  const args: string[] = [request.command];
  if (request.command !== "setup" && request.command !== "voices") {
    if (!request.film) throw Object.assign(new Error("Thiếu đường dẫn film.ts trong workspace"), { status: 400 });
    args.push((await resolveWorkspacePath(cwd, request.film)).path);
  }
  if (request.draft) args.push("--draft");
  if (request.shots) args.push("--shots", request.shots);
  if (request.at !== undefined) args.push("--at", String(request.at));
  if (request.voice) args.push("--voice", request.voice);
  const env: Record<string, string | undefined> = { ...process.env };
  if (request.command === "render") {
    // Báo thiếu FFmpeg theo cùng cơ chế của ứng dụng (mở hướng dẫn cài trong chợ plugin).
    await createWorkspaceFfmpeg(cwd, signal);
    const { tools } = await getStatus();
    env.FFMPEG_PATH = tools.ffmpeg.path ?? undefined;
    env.FFPROBE_PATH = tools.ffprobe.path ?? undefined;
  }
  // Bản đóng gói: thư mục bộ dựng chỉ đọc, môi trường Python của VieNeu đặt trong thư mục dữ liệu.
  if (process.env.TOONFLOW_CINEMA_ROOT) env.CINEMA_VENV ??= join(dirname(conf.path), "cinema", "venv");
  if (running.has(cwd)) throw Object.assign(new Error("Workspace đang dựng một phim khác"), { status: 409 });
  running.add(cwd);
  try {
    const child = Bun.spawn([process.execPath, cliPath(), ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
    const stop = () => child.kill();
    signal.addEventListener("abort", stop, { once: true });
    const lines: string[] = [];
    const outputs = new Set<string>();
    const read = async (stream: ReadableStream<Uint8Array>) => {
      let buffer = "";
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        buffer += decoder.decode(chunk, { stream: true });
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop()!;
        for (const line of parts) {
          const path = line.replace(/^[^/\\A-Za-z]+/u, "").trim();
          if (isAbsolute(path) && isWithin(cwd, path) && await access(path).then(() => true, () => false)) outputs.add(relative(cwd, path).replaceAll("\\", "/"));
          // Nhật ký hiển thị đường dẫn tương đối trong workspace cho gọn.
          const shown = line.replaceAll(`${cwd}${sep}`, "");
          lines.push(shown);
          onLine(shown);
        }
      }
      if (buffer) { lines.push(buffer); onLine(buffer); }
    };
    await Promise.all([read(child.stdout), read(child.stderr)]);
    const code = await child.exited;
    signal.removeEventListener("abort", stop);
    signal.throwIfAborted();
    if (code) throw Object.assign(new Error(lines.filter(Boolean).slice(-8).join("\n") || `Bộ dựng phim lỗi (mã ${code})`), { status: 422 });
    return { outputs: [...outputs], log: lines.join("\n") };
  } finally {
    running.delete(cwd);
  }
}
