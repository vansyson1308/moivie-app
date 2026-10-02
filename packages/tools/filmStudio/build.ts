import { createToolConfig } from "@toonflow/tools-scaffold";

await createToolConfig({
  name: "filmStudio",
  displayName: "Xưởng phim",
  description: "Làm phim theo dây chuyền: kịch bản theo chương → hồ sơ nhân vật/bối cảnh → danh sách cảnh → quay nhiều bản và duyệt → thu thoại tiếng Việt → ghép phim. Lưu tiến độ trong film/project.json để làm tiếp bất cứ lúc nào.",
  author: "Toonflow",
  github: "https://github.com/HBAI-Ltd/Toonflow-app",
  prompt: `Dự án phim nằm ở film/project.json. Khi tiếp tục, gọi filmStatus trước rồi làm đúng bước "next"; không làm lại phần đã xong.
Đi đúng thứ tự: chương kịch bản → hồ sơ nhân vật/bối cảnh có ảnh tham chiếu → danh sách cảnh → filmShoot rồi filmPick từng cảnh → filmVoice → filmAssemble. Hỏi người dùng trước khi quay hàng loạt vì quay video tốn chi phí.
Mô tả nhân vật, bối cảnh, action và style viết bằng tiếng Anh cho mô hình hình ảnh; lời thoại giữ nguyên văn tiếng Việt. Chép mô tả ngoại hình cố định, không viết "người đó".
Chọn mô hình bằng listMediaModels và lưu vào settings.videoModel/audioModel; không đoán ID mô hình. Ảnh tham chiếu phải là tệp có thật trong thư mục làm việc.
Sau filmShoot, xem tờ duyệt (sheet) của từng bản trước khi chọn; báo thật những gì thấy, không khen bản chưa xem.`,
  configRules: [],
}, import.meta.url);
