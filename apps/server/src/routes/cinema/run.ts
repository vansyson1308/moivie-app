import { Router } from "express";
import { z } from "zod";
import { validateFields } from "@/lib/middleware";
import { success } from "@/lib/responseFormat";
import { validationOptions } from "@/lib/i18n";
import u from "@/utils";

const inputSchema = z.object({
  requestId: z.uuid(),
  directory: z.string().min(1).max(4096),
  command: z.enum(["check", "sheet", "still", "render", "setup", "voices", "cancel"]),
  film: z.string().min(1).max(4096).optional(),
  draft: z.boolean().optional(),
  shots: z.string().regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/).optional(),
  at: z.number().nonnegative().optional(),
  voice: z.enum(["vieneu", "silent"]).optional(),
}).strict();
// ACT: Bun SSE không chắc báo ngắt kết nối; huỷ tường minh bằng command "cancel" cùng requestId, trạng thái giữ trong tiến trình.
const requests = new Map<string, AbortController>();

export default Router().post("/", validateFields(inputSchema.shape), async (req, res) => {
  u.mcpControl.assertAppRequest(req);
  const { requestId, directory, command, ...request } = inputSchema.parse(req.body, validationOptions());
  const cwd = await u.workspace.resolveWorkspace(req, directory);
  const requestKey = `${cwd}\0${requestId}`;
  if (command === "cancel") {
    requests.get(requestKey)?.abort();
    res.json(success());
    return;
  }
  if (requests.has(requestKey)) throw Object.assign(new Error("Lệnh dựng phim đang chạy"), { status: 409 });
  const controller = new AbortController();
  requests.set(requestKey, controller);
  const close = () => controller.abort();
  res.once("close", close);
  req.once("aborted", close);
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = (event: Record<string, unknown>) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
  try {
    res.set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    heartbeat = setInterval(() => { if (!res.destroyed) res.write(": keepalive\n\n"); }, 1000);
    try {
      const result = await u.cinema.runCinema(cwd, { command, ...request }, line => send({ type: "log", line }), controller.signal);
      send({ type: "done", ...result, log: undefined });
    } catch (error) {
      // Đầu SSE đã gửi: lỗi đi trong luồng sự kiện (kể cả thiếu FFmpeg, mã FFMPEG_REQUIRED).
      const failure = error as Error & { code?: string; status?: number };
      send({ type: "error", message: failure.message, code: failure.code, status: failure.status });
    }
    res.end();
  } finally {
    if (requests.get(requestKey) === controller) requests.delete(requestKey);
    clearInterval(heartbeat);
    res.off("close", close);
    req.off("aborted", close);
  }
});
