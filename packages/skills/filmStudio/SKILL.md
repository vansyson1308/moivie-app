---
name: filmStudio
description: Xưởng phim tiếng Việt. Biến ý tưởng, truyện hoặc kịch bản thành phim nhiều cảnh theo dây chuyền kịch bản theo chương → hồ sơ nhân vật/bối cảnh → danh sách cảnh → quay nhiều bản và duyệt → thu thoại (VieNeu-TTS) → ghép phim, lưu tiến độ để làm tiếp. Dùng khi người dùng muốn làm phim, phim ngắn, phim truyện nhiều cảnh, hoặc tiếp tục dự án trong film/project.json.
metadata:
  version: "1.0.0"
  displayName: Xưởng phim tiếng Việt
  author: Toonflow
  github: https://github.com/HBAI-Ltd/Toonflow-app
---

# Xưởng phim tiếng Việt

Dây chuyền 6 bước, mỗi bước có đầu ra lưu trong `film/project.json` qua công cụ **Xưởng phim** (`filmStatus`, `filmPlan`, `filmShoot`, `filmPick`, `filmVoice`, `filmAssemble`). Công cụ lo phần máy móc: bộ nhớ hình ảnh, nối cảnh, chia đoạn, trộn tiếng, ghép phim. Phần sáng tác (kịch bản, hồ sơ, phân cảnh, chấm bản quay) là việc của bạn và theo quy tắc dưới đây.

## Bắt đầu hoặc làm tiếp

1. Gọi `filmStatus`. Nếu đã có dự án, làm đúng bước `next`, không làm lại phần đã xong, không ghi đè quyết định cũ của người dùng.
2. Nếu chưa có, hỏi gọn những gì ảnh hưởng kết quả mà không tự suy ra được: thời lượng mong muốn, tỉ lệ khung (16:9 hay 9:16), phong cách hình ảnh, số chương. Rồi `filmPlan` với `settings.title`, `style`, `ratio`.
3. Chọn mô hình bằng `listMediaModels`: video cho `settings.videoModel`, âm thanh cho `settings.audioModel` (ưu tiên VieNeu-TTS cho tiếng Việt). Không đoán ID.
4. Quay video tốn tiền: trước bước 4, báo số cảnh × số bản quay và xin người dùng đồng ý quay hàng loạt.

## Bước 1 · Kịch bản theo chương

- Mỗi chương là một hồi có mục tiêu, trở ngại, bước ngoặt. `script` viết như kịch bản: dòng bối cảnh, hành động nhìn thấy được, lời thoại nguyên văn.
- Giữ nguyên tình tiết, tên riêng, lời thoại của nguồn người dùng đưa; chỗ thiếu thì đánh dấu "cần xác nhận", không bịa thành sự thật.
- Truyện dài: chia chương trước, làm trọn chương 1 tới hết bước 4 để người dùng duyệt chất lượng rồi mới làm tiếp.

## Bước 2 · Hồ sơ nhân vật và bối cảnh

Hồ sơ là "neo danh tính" cho mọi cảnh, nên làm kỹ trước khi quay.

- `description` bằng tiếng Anh, 40–80 từ, chỉ những gì cố định và nhìn thấy được: tuổi, dáng, khuôn mặt, tóc, trang phục chính, phụ kiện, màu sắc. Không ghi cảm xúc hay hành động.
- Tạo ảnh hồ sơ bằng `generateImage`: chân dung chính diện nền trơn cho nhân vật, toàn cảnh rõ ánh sáng cho bối cảnh, cùng `settings.style`. Xem ảnh, đạt thì lưu đường dẫn vào `references` (ảnh đầu tiên là ảnh neo chính).
- Gán `voice` cho từng nhân vật nói (xem [âm thanh](references/sound.md)), `settings.narratorVoice` cho lời dẫn.

## Bước 3 · Danh sách cảnh

Đọc [quy tắc phân cảnh](references/shotList.md) trước khi viết. Điểm chính:

- Mỗi cảnh một ý: một hành động chính, một người nói. Hội thoại hai người dùng cảnh/nghịch cảnh (shot – reverse shot).
- `action` tiếng Anh, thì hiện tại, chỉ mô tả cái máy quay thấy. Mỗi cảnh tự đủ nghĩa; công cụ tự chép mô tả nhân vật/bối cảnh vào prompt.
- `continuity: "continue"` khi cảnh nối liền hành động của cảnh trước (cùng không gian, không nhảy thời gian); `"cut"` khi chuyển góc máy rõ, đổi bối cảnh hoặc nhảy thời gian.
- `duration` ≥ thời lượng thoại: khoảng 230 âm tiết/phút + 1 giây; `filmStatus` sẽ cảnh báo nếu thiếu. Cảnh dài hơn giới hạn của mô hình được tự chia đoạn nối tiếp.
- Thoại `dialogue` giữ nguyên văn tiếng Việt, `speaker` là id nhân vật hoặc `narrator`.

## Bước 4 · Quay và duyệt từng cảnh

- Quay theo thứ tự phim; cảnh `continue` cần cảnh trước đã được chọn bản.
- Nếu mô hình video nhận âm thanh tham chiếu, thu thoại (bước 5) cho cảnh có nhân vật nói **trước** khi quay để khớp khẩu hình.
- Sau `filmShoot`, mở tờ duyệt (`sheet`) của từng bản và chấm theo [tiêu chí duyệt](references/review.md). Đạt thì `filmPick`; không đạt thì `filmShoot` lại với `note` nêu lỗi cụ thể và cách sửa.
- Nói thật điều nhìn thấy. Tối đa 3 lượt quay lại một cảnh, sau đó hỏi người dùng: sửa phân cảnh, đổi mô hình hay chấp nhận.

## Bước 5 · Dựng âm thanh

- `filmVoice` thu mọi câu còn thiếu; câu sửa lời trong `filmPlan` sẽ mất bản thu cũ và cần thu lại.
- Nghe các câu bị cảnh báo thời lượng bất thường. Nếu thoại dài hơn cảnh, tăng `duration` và quay lại, hoặc chấp nhận để bước ghép giữ khung cuối.
- Nhạc nền là tùy chọn, chỉ dùng tệp người dùng cung cấp hoặc đã có quyền dùng.

## Bước 6 · Ghép phim

- `filmAssemble` khi mọi cảnh đã chọn bản. Báo đường dẫn phim, phụ đề `.srt`, thời lượng và mọi cảnh báo.
- Sửa một cảnh sau khi ghép: quay/chọn lại cảnh đó rồi ghép lại; các cảnh khác giữ nguyên.

## Không làm

- Không tuyên bố đã tạo, đã xem hay đã nghe thứ chưa thực sự có.
- Không nhân bản giọng người thật khi chưa có sự đồng ý của người đó.
- Không sửa tay `film/project.json`; luôn qua `filmPlan` để được kiểm tra chéo.
