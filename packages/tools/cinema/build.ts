import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "cinema",
  displayName: "Xưởng phim Toonflow Cinema",
  description: "Dựng phim hoạt hình tiếng Việt hoàn toàn trên máy từ kịch bản film.ts trong workspace: kiểm tra, storyboard, khung hình, dựng nháp và bản cuối có lồng tiếng VieNeu.",
  author: "Toonflow",
  github: "https://github.com/vansyson1308/moivie-app",
  prompt: `Làm phim theo kỹ năng "cinema" (chưa có kỹ năng thì gọi cinema với command "guide" để đọc hướng dẫn): viết kịch bản film.ts trong workspace bằng công cụ ghi tệp, rồi dùng công cụ cinema để check → sheet (đọc ảnh storyboard và tự sửa) → render với draft → render bản cuối.
Đường dẫn film luôn là đường dẫn tương đối trong workspace. Chỉ báo phim đã xong sau khi lệnh render trả về tệp mp4.`,
  configRules: [],
}, import.meta.url);
