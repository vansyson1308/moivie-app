# Xưởng phim

Dây chuyền làm phim nhiều cảnh cho Agent, lưu toàn bộ tiến độ trong `film/project.json` của thư mục làm việc.

| Bước | Công cụ | Việc làm |
| --- | --- | --- |
| 1. Kịch bản theo chương | `filmPlan` (`chapters`) | Lưu từng chương: tiêu đề, tóm tắt, kịch bản. |
| 2. Hồ sơ nhân vật / bối cảnh | `filmPlan` (`characters`, `locations`) | Mô tả ngoại hình cố định, giọng đọc, ảnh tham chiếu. |
| 3. Danh sách cảnh | `filmPlan` (`shots`) | Hành động, cỡ cảnh, góc máy, chuyển động, ống kính, thời lượng, nối cảnh, lời thoại. |
| 4. Quay và duyệt | `filmShoot`, `filmPick` | Quay nhiều bản, xem tờ duyệt 4 khung, chọn bản đạt. |
| 5. Âm thanh | `filmVoice` | Đọc thoại tiếng Việt (khuyên dùng VieNeu-TTS), đo thời lượng. |
| 6. Ghép phim | `filmAssemble` | Chuẩn hóa, trộn thoại và nhạc nền, xuất MP4 kèm phụ đề tiếng Việt. |

`filmStatus` cho biết bước tiếp theo, nên dừng giữa chừng vẫn làm tiếp được. Mỗi bản quay được lưu ngay khi xong.

## Những ý tưởng được tích hợp

- **Bộ nhớ hình ảnh xuyên cảnh (StoryMem):** khi chọn bản quay, trích tối đa 3 khung khóa, bỏ khung gần trùng (băm 8×8 thay cho CLIP). Khi quay cảnh sau, gửi kèm theo thứ tự: khung nối tiếp, ảnh hồ sơ nhân vật/bối cảnh (neo danh tính), rồi các khung khóa có cùng nhân vật/bối cảnh gần nhất, trong giới hạn `settings.memorySize` và số ảnh mô hình nhận.
- **Sinh tiếp video và khẩu hình theo âm thanh (LongCat-Video):** cảnh `continuity: "continue"` bắt đầu từ khung cuối của cảnh trước. Cảnh dài hơn giới hạn mô hình được chia thành nhiều đoạn, mỗi đoạn nối từ khung cuối đoạn trước và nhận đúng cửa sổ thoại của nó. Nếu mô hình nhận âm thanh tham chiếu và thoại đã thu, dải thoại được gửi để khớp khẩu hình.
- **Ngôn ngữ máy quay và cổng năng lực mô hình (AIMovieStudio):** cỡ cảnh, góc máy, chuyển động, tốc độ, tiêu cự được dịch sang câu lệnh điện ảnh. Chế độ sinh, số ảnh tham chiếu và thời lượng được chọn theo khai báo của mô hình.
- **Chia cảnh → quay nhiều bản → chọn → ghép, có làm tiếp (KupkaProd):** mỗi prompt tự dựng lại toàn bộ thế giới. Tiêu chí duyệt: hỏng một mục hoặc tạm từ hai mục trở lên thì quay lại.

## Tệp tạo ra

- `film/takes/<cảnh>/`: các bản quay và tờ duyệt `.jpg`.
- `film/memory/`: khung khóa của bộ nhớ hình ảnh.
- `film/audio/<cảnh>/`: thoại từng câu và dải thoại đã ghép.
- `film/render/`: từng cảnh đã chuẩn hóa.
- `film/output/`: phim và phụ đề `.srt`.

Công cụ cần FFmpeg (cấu hình trong “Cài đặt → Chợ tiện ích”) và mô hình video/âm thanh đã cấu hình trong “Cài đặt → Mô hình đa phương tiện”.
