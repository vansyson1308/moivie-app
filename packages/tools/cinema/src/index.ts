import { z } from "zod";
import type { ToolPlugin } from "@toonflow/tools-scaffold/runtime";
// Hướng dẫn làm phim nhúng vào công cụ lúc build: bản cài cũ chưa có kỹ năng "cinema" vẫn đọc được bằng lệnh guide.
import guide from "../../../skills/cinema/SKILL.md" with { type: "text" };

const configSchema = z.strictObject({});
const runSchema = z.strictObject({
  command: z.enum(["guide", "check", "sheet", "still", "render", "setup", "voices"])
    .describe("guide: đọc hướng dẫn làm phim đầy đủ (gọi trước tiên nếu chưa có kỹ năng cinema); check: soát kịch bản và in danh sách góc máy; sheet: storyboard 3 khung mỗi góc máy; still: một khung hình; render: dựng phim; setup: cài giọng VieNeu (một lần); voices: liệt kê giọng"),
  film: z.string().optional().describe("đường dẫn film.ts trong workspace, ví dụ phimCuaToi/film.ts (bắt buộc trừ setup, voices)"),
  draft: z.boolean().optional().describe("render: bản nháp 640×360 để duyệt nhanh"),
  shots: z.string().regex(/^\d+(-\d+)?(,\d+(-\d+)?)*$/).optional().describe("chỉ dựng/duyệt các góc máy chọn, ví dụ 3,5-7"),
  at: z.number().nonnegative().optional().describe("still: thời điểm (giây)"),
  voice: z.enum(["vieneu", "silent"]).optional().describe("silent: giọng câm để dựng nháp khi chưa cài VieNeu"),
});

const plugin: ToolPlugin = {
  validateConfig: config => configSchema.parse(config),
  createTools(context) {
    return [{
      name: "cinema",
      label: "Dựng phim",
      description: "Chạy bộ dựng phim Toonflow Cinema trên film.ts của workspace. Trả về nhật ký và các tệp đã tạo (storyboard PNG, khung hình, MP4, SRT, báo cáo).",
      promptSnippet: "Dùng cinema để kiểm tra, duyệt storyboard và dựng phim từ film.ts.",
      promptGuidelines: [
        "Sau mỗi lần sheet, đọc từng ảnh storyboard trong outputs để tự soát bố cục, liên tục, diễn xuất rồi sửa film.ts trước khi render.",
        "render bản cuối có thể mất vài phút; dùng draft và shots khi đang duyệt.",
      ],
      parameters: z.toJSONSchema(runSchema, { io: "input", target: "draft-07" }),
      executionMode: "sequential",
      async execute(_id, params, signal, onUpdate) {
        const { command, ...request } = runSchema.parse(params);
        if (command === "guide") return { content: [{ type: "text", text: guide }], details: {} };
        if (!context.cinema) throw new Error("Phiên bản Toonflow này chưa có bộ dựng phim");
        const lines: string[] = [];
        const result = await context.cinema({ command, ...request }, line => {
          lines.push(line);
          onUpdate?.({ content: [{ type: "text", text: lines.slice(-12).join("\n") }], details: { running: true } });
        }, signal);
        // ACT: nhật ký dựng có thể dài; gửi phần cuối cho mô hình, tệp kết quả đầy đủ nằm trong details.
        return { content: [{ type: "text", text: `${result.log.split("\n").slice(-40).join("\n")}\n\nTệp đã tạo:\n${result.outputs.join("\n") || "(không có)"}` }], details: result };
      },
    }];
  },
};

export default plugin;
