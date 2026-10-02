# Âm thanh tiếng Việt với VieNeu-TTS

## Cài đặt (một lần)

1. `pip install vieneu`. Lần chạy đầu tự tải khoảng 1 GB mô hình; chạy được bằng CPU.
2. Bật máy chủ chuẩn OpenAI: `python -m apps.openai_speech`, mặc định ở `http://127.0.0.1:8000`. Muốn đổi cổng thì đặt `PORT`; muốn khóa truy cập thì đặt `VIENEU_API_KEY`.
3. Trong “Cài đặt → Mô hình đa phương tiện”, mở nhà cung cấp **VieNeu-TTS (tiếng Việt)** và điền địa chỉ máy chủ.
4. Gọi `listMediaModels`, lưu `settings.audioModel = { providerId: "vieNeu", modelId: "vieneu-v3-turbo" }`.

Máy chủ CPU chỉ đọc một câu mỗi lúc; công cụ thu tuần tự nên không bị lỗi 429.

Nếu máy chủ không khởi động được và báo `External data path escapes model directory`, đó là do onnxruntime từ bản 1.23 trở lên chặn tệp mô hình nằm trong bộ nhớ đệm Hugging Face. Khi đó cài bản cũ hơn: `pip install "onnxruntime<1.23"`.

## Chọn giọng

Giọng có sẵn được liệt kê trong mô hình, kèm giới tính, vùng miền và phong cách:

| Phong cách | Giọng |
| --- | --- |
| Tự nhiên | Hải Đăng, Quốc Tuấn, Phạm Tuyên, Xuân Vĩnh, Trúc Ly, Đoan Trang, Ngọc Huyền, Quang Sơn (Trung), Ngọc Trân (Trung) |
| Kể chuyện / đọc truyện | Thiện Minh, Thanh Bình, Thiền Tâm Đức, Ngọc Linh, Quỳnh Anh, Thái Sơn (Nam), Thục Đoan (Nam), Mỹ Duyên (Nam), Kim Thanh (Nam), Đức Trí (Nam) |
| Tin tức | Minh Đức, Mai Anh, Minh Triết (Nam), Thùy Dung (Nam) |

- Lời dẫn: giọng kể chuyện, trầm, đều.
- Mỗi nhân vật một giọng riêng, hợp tuổi, giới tính và vùng miền trong truyện; hai nhân vật cùng cảnh không dùng giọng giống nhau.
- Giọng nhân bản (đăng ký qua `POST /v1/voices` của máy chủ) chỉ dùng khi người được nhân bản giọng đã đồng ý.

## Viết lời để đọc hay

- Lời dẫn khoảng 230 âm tiết/phút. Câu ngắn, mỗi câu một ý.
- Dấu câu là nhịp: dấu phẩy là ngắt ngắn, dấu chấm là nghỉ. Máy chủ bỏ qua tham số tốc độ, nên chỉnh nhịp bằng dấu câu và độ dài câu.
- Viết số, ngày tháng, đơn vị thành chữ khi dễ đọc sai, ví dụ "năm một chín bảy lăm".
- Tên nước ngoài giữ nguyên chính tả; nếu đọc sai thì viết phiên âm tiếng Việt trong lời thoại.
- Câu bị cảnh báo thời lượng bất thường (quá nhanh hoặc quá chậm so với khoảng 4,5 âm tiết/giây) thường là đọc sót hoặc lặp từ, nên thu lại.

## Trộn khi ghép phim

Thoại bắt đầu sau 0,3 giây, các câu cách nhau 0,25 giây. Âm thanh gốc của bản quay giảm xuống 35% khi có thoại. Nhạc nền mặc định ở mức 15%. Phụ đề lấy đúng thời điểm từng câu.
