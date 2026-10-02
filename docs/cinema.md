# Toonflow Cinema — điện ảnh biên dịch

[Mục lục tài liệu](./readme.md) · [Hướng dẫn cho agent](../packages/cinema/SKILL.md) · [Phim mẫu](../packages/cinema/examples/chuyenDoCuoi/film.ts)

## Ý tưởng

Các công cụ làm phim AI hiện nay (Google Flow, Seedance, Veo…) **lấy mẫu điểm ảnh**: mỗi cảnh là một lần "gieo xúc xắc" trên máy chủ trả phí. Nhân vật đổi mặt giữa các cảnh, máy quay khó điều khiển chính xác, sửa một chi tiết phải sinh lại cả đoạn, và mỗi lần thử đều tốn tiền.

Toonflow Cinema đi hướng ngược lại, cùng triết lý với [srt-whiteboard-animation](https://github.com/vansyson1308/srt-whiteboard-animation): **AI viết, máy dựng**.

- **Agent lập trình** (Claude Code, Codex…) làm việc nó giỏi nhất: biên kịch, dàn dựng, chọn góc máy, viết thoại, duyệt kết quả. Toàn bộ phim được viết thành một tệp TypeScript `film.ts`.
- **Máy biên dịch** `film.ts` thành phim một cách tất định: diễn viên có khung xương, nhép miệng theo giọng thật, máy quay ảo nhiều lớp thị sai, ánh sáng theo giờ, thời tiết, nhạc tự sinh, trộn tiếng, phụ đề.
- **Không API key, không GPU, chi phí bằng 0.** Giọng đọc tiếng Việt bằng VieNeu-TTS chạy CPU. Dựng hình bằng Skia, mã hóa bằng FFmpeg.

## Dây chuyền

```text
Kịch bản theo chương ─► Hồ sơ diễn viên/bối cảnh ─► Danh sách cảnh ─► Dựng thử & duyệt ─► Dựng âm thanh ─► Ghép phim
 film.chapter/scene       film.cast / film.set        s.shot/say/act     cinema sheet/still   VieNeu + nhạc + nền   cinema render
                                                                         (agent xem ảnh, sửa mã, lặp lại)
```

| Khối | Tệp | Việc |
| --- | --- | --- |
| Ngôn ngữ kịch bản | `src/film.ts` | `createFilm`, `cast`, `set`, `prop`, `chapter`, `scene` → `shot`, `say`, `narrate`, `act`, `move`, `wait` |
| Biên dịch | `src/timeline.ts` | Kiểm tra chéo, lập lịch nhịp, máy tự chia cảnh hội thoại, trạng thái thế giới theo thời gian, mốc cắt trên lưới khung hình |
| Diễn viên số | `src/character.ts` | Nhân vật tham số: 8 kiểu tóc, 6 trang phục Việt, 4 loại nón mũ, râu, kính, 8 biểu cảm, 4 khẩu hình, nước mắt |
| Diễn xuất | `src/motion.ts` | 25 động tác, thở, chớp mắt theo lịch tất định, ánh nhìn về người nói, cử chỉ khi nói câu dài |
| Bối cảnh | `src/set.ts`, `src/props.ts` | Khoảng 30 mô-típ, 7 bảng màu theo giờ, thời tiết, nguồn sáng, đạo cụ cầm tay, vật thể agent tự vẽ bằng SVG path |
| Máy quay | `src/camera.ts` | Cỡ cảnh tính từ khung xương thật, khoảng trống hướng nhìn, qua vai, góc thấp/cao/nghiêng, 12 chuyển động |
| Khung hình | `src/frame.ts` | Thị sai nhiều lớp, phối cảnh không khí, độ sâu trường ảnh, chỉnh màu, vignette, hạt phim, phụ đề, thẻ chương, danh đề |
| Âm thanh | `src/voice.ts`, `src/audio.ts` | VieNeu-TTS (gọi trực tiếp trong Python hoặc qua máy chủ), đường bao giọng để nhép miệng, nhạc tự sinh theo tâm trạng, tiếng nền, tự hạ nhạc khi có thoại |
| Dựng | `src/render.ts`, `src/encode.ts`, `src/shotWorker.ts` | Dựng song song nhiều nhân CPU, bộ nhớ đệm theo nội dung từng góc máy, chuẩn âm lượng −16 LUFS, tự kiểm số khung |

## Tinh hoa của bốn dự án, làm lại không cần API

| Dự án | Ý tưởng gốc | Trong Toonflow Cinema |
| --- | --- | --- |
| [StoryMem](https://github.com/Kevin-thu/StoryMem) | Bộ nhớ khung hình xuyên cảnh để giữ nhân vật nhất quán | **Nhất quán theo cấu tạo**: nhân vật là một bộ tham số, không phải ảnh tham chiếu, nên khung thứ 1 và khung thứ 10.000 giống hệt nhau. "Ký ức" là trạng thái thế giới (vị trí, hướng, tư thế, đồ đang cầm) được biên dịch liên tục giữa các góc máy. |
| [LongCat-Video](https://github.com/meituan-longcat/LongCat-Video) | Sinh tiếp video; nhân vật chuyển động theo âm thanh | **Nối tiếp tuyệt đối**: một cảnh là một không gian liên tục, mọi góc máy cắt ra từ cùng một dòng thời gian nên không có điểm nối. **Hoạt hình theo âm thanh**: độ mở miệng theo đường bao năng lượng của giọng VieNeu 50 lần/giây, khẩu hình theo nguyên âm của từng âm tiết tiếng Việt, đầu nhấp và tay cử chỉ theo nhịp nói; nhiều người nói lần lượt, người nghe nhìn về người nói. |
| [AIMovieStudio v2](https://github.com/Heroesjouney/AIMovieStudiov2) | Dàn cảnh, máy quay, timeline | **Máy quay ảo thật**: cỡ cảnh được tính từ khung xương nhân vật, bố cục một phần ba với khoảng trống hướng nhìn, qua vai, góc thấp/cao/nghiêng, các chuyển động dolly, pan, tilt, crane, bám theo, máy cầm tay. Hậu cảnh nhiều lớp thị sai (multiplane), độ sâu trường ảnh, phối cảnh không khí. Quy tắc trục 180° tự đúng vì máy quay nhìn vào cùng một sân khấu. |
| [KupkaProd](https://github.com/Matticusnicholas/KupkaProd-Cinema-Pipeline) | Chia cảnh → quay nhiều bản → chọn → ghép, làm tiếp dự án | **Vòng duyệt gần như miễn phí**: `cinema sheet` dựng storyboard 3 khung mỗi góc máy trong vài giây để agent tự xem và chấm, sửa mã, dựng lại. **Làm tiếp dự án**: mỗi góc máy được nhớ đệm theo nội dung, sửa một cảnh chỉ dựng lại cảnh đó; giọng đọc nhớ đệm theo câu. |

Lồng tiếng giữ cách làm của srt-whiteboard-animation:

- VieNeu-TTS v3 Turbo chạy offline với 24 giọng có sẵn theo vùng miền và phong cách.
- Chế độ giọng câm để dựng nháp khi chưa cài.
- Phụ đề SRT và phụ đề in trên hình.

## Số liệu thực tế

Phim mẫu *Chuyến đò cuối* (77 giây, 3 cảnh, 14 góc máy, 13 câu thoại VieNeu thật) được đo trên máy 4 nhân CPU, không GPU:

| Việc | Thời gian |
| --- | --- |
| `cinema check` | dưới 1 giây (giọng đã nhớ đệm) |
| `cinema sheet` (storyboard toàn phim) | khoảng 6 giây |
| `cinema render --draft` (640×360) | khoảng 26 giây |
| `cinema render` (1920×1080, 24 hình/giây) | khoảng 2 phút 40 giây |
| Sửa một câu thoại rồi dựng lại bản nháp | khoảng 20 giây, chỉ dựng lại 7 góc máy của cảnh đó |

Đầu ra gồm:

- Video H.264 1080p.
- Âm thanh AAC 48 kHz stereo, chuẩn −16 LUFS.
- Tệp SRT.
- Báo cáo có kiểm tra số khung khớp thời lượng.

## Cách dùng

```bash
bun install
bun run cinema setup                                   # một lần: VieNeu-TTS (~1 GB)
bun run cinema render packages/cinema/examples/chuyenDoCuoi/film.ts
```

Với agent: giao cho nó [`packages/cinema/SKILL.md`](../packages/cinema/SKILL.md), hoặc gõ `/cinema` trong Claude Code, kèm ý tưởng hay truyện. Agent tự viết `projects/<tenPhim>/film.ts`, duyệt storyboard và giao phim.

## Giới hạn hiện tại và hướng phát triển

- Nhân vật vẽ ở góc 3/4 và lật trái phải, chưa có góc chính diện hay sau lưng; bàn tay là khối tròn. Có thể nâng cấp bằng nhiều góc nhìn cho mỗi bộ phận.
- Chuyển cảnh có cắt thẳng và mờ dần qua đen/trắng, chưa có hòa hình (dissolve) chồng hai cảnh.
- Nhép miệng theo năng lượng và nguyên âm, chưa căn thời điểm từng âm tiết. Có thể thêm bước căn âm tiết giống `anchor_words` của srt-whiteboard-animation.
- Bộ nhớ đệm tính theo cả cảnh: sửa một nhịp sẽ dựng lại các góc máy cùng cảnh.
- Chưa có giao diện trong ứng dụng Toonflow. Bộ dựng dùng API Canvas2D giống trình duyệt, nên có thể làm node xem trước trên canvas ở giai đoạn sau.
