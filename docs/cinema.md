# Toonflow Cinema — điện ảnh biên dịch

[Mục lục tài liệu](./readme.md) · [Hướng dẫn cho agent](../packages/skills/cinema/SKILL.md) · Phim mẫu: [Chuyến đò cuối](../packages/cinema/examples/chuyenDoCuoi/film.ts), [Đèn Trung Thu](../packages/cinema/examples/denTrungThu/film.ts)

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
| Biên dịch | `src/timeline.ts` | Kiểm tra chéo, lập lịch nhịp, máy tự chia cảnh hội thoại (có L-cut), trạng thái thế giới theo thời gian, mốc cắt trên lưới khung hình |
| Diễn viên 2.5D | `src/character.ts`, `src/rig/paint.ts` | Khung xương 3D chiếu theo góc quay liên tục (chính diện, 3/4, nghiêng, sau lưng); bàn tay có ngón, 6 dáng tay; tô cel theo hướng sáng của cảnh, viền màu, viền ngược sáng; mắt hạnh nhân, tóc có lọn và vòng sáng; chân luôn chạm đất |
| Diễn xuất | `src/motion.ts` | 25 động tác cho tay trái/phải, quay người qua chính diện, dáng đi gập gối, vận tốc hình thang, quán tính tóc áo, gió lay, đầu và mắt nhìn người nói, nhấn đầu theo âm tiết mạnh |
| Khẩu hình | `src/lipSync.ts` | Tìm hạt nhân âm tiết trong giọng (lọc dải nguyên âm, kiểu de Jong–Wempe), căn với chữ bằng quy hoạch động neo dấu câu, ánh xạ phụ âm đầu – nguyên âm – âm cuối tiếng Việt sang 9 khẩu hình Preston Blair, làm mượt kiểu Rhubarb |
| Bối cảnh | `src/set.ts`, `src/props.ts` | Khoảng 30 mô-típ, 7 bảng màu theo giờ, thời tiết, tia nắng, bloom, phản chiếu mặt nước, chỉnh màu lift–gain, đạo cụ cầm tay lật theo hướng nhân vật |
| Máy quay | `src/camera.ts` | Cỡ cảnh tính từ khung xương thật, khoảng trống hướng nhìn, qua vai, góc thấp/cao/nghiêng, 12 chuyển động |
| Khung hình | `src/frame.ts` | Thị sai nhiều lớp, độ sâu trường ảnh, motion blur màn trập 180°, hòa hình/gạt/iris/qua đen, vignette, hạt phim, phụ đề, thẻ chương, danh đề |
| Âm thanh | `src/voice.ts`, `src/audio.ts` | VieNeu-TTS, nhạc tự sinh theo tâm trạng, tiếng nền nối cầu giữa các cảnh, tiếng động khớp hình (bước chân theo mặt nền, mái chèo, tiếp đất, áo quần, giấy), pan theo vị trí trên màn hình, vang phòng |
| Dựng | `src/render.ts`, `src/encode.ts`, `src/shotWorker.ts` | Dựng song song nhiều nhân CPU, bộ nhớ đệm theo lát nội dung từng góc máy (đoạn chuyển cảnh tách riêng), khổ 16:9 / 2,39:1 / 1,85:1 / dọc / vuông, 1080p hoặc 4K, chuẩn âm lượng −16 LUFS, tự kiểm số khung |
| Trong ứng dụng | `apps/server/src/utils/cinema`, `routes/cinema/run.ts`, `packages/tools/cinema`, `packages/nodes/cinemaNode`, `packages/skills/cinema` | API dựng phim truyền nhật ký qua SSE, công cụ `cinema` cho Agent, node **Phim** trên canvas, kỹ năng làm phim cho Agent, đóng gói desktop |

## Tinh hoa của bốn dự án, làm lại không cần API

| Dự án | Ý tưởng gốc | Trong Toonflow Cinema |
| --- | --- | --- |
| [StoryMem](https://github.com/Kevin-thu/StoryMem) | Bộ nhớ khung hình xuyên cảnh để giữ nhân vật nhất quán | **Nhất quán theo cấu tạo**: nhân vật là một bộ tham số, không phải ảnh tham chiếu, nên khung thứ 1 và khung thứ 10.000 giống hệt nhau. "Ký ức" là trạng thái thế giới (vị trí, hướng, tư thế, đồ đang cầm) được biên dịch liên tục giữa các góc máy. |
| [LongCat-Video](https://github.com/meituan-longcat/LongCat-Video) | Sinh tiếp video; nhân vật chuyển động theo âm thanh | **Nối tiếp tuyệt đối**: một cảnh là một không gian liên tục, mọi góc máy cắt ra từ cùng một dòng thời gian nên không có điểm nối. **Hoạt hình theo âm thanh**: khẩu hình căn đúng thời điểm từng âm tiết tìm được trong chính giọng VieNeu (môi khép đúng lúc "m, b, p", tròn môi ở "o, u", mở rộng ở "a"), độ mở theo năng lượng giọng, đầu nhấn theo âm tiết mạnh, tay cử chỉ ở câu dài; người nghe quay đầu nhìn người nói. |
| [AIMovieStudio v2](https://github.com/Heroesjouney/AIMovieStudiov2) | Dàn cảnh, máy quay, timeline | **Máy quay ảo thật**: diễn viên 2.5D quay mọi góc nên máy đặt ở đâu cũng có hình đúng; cỡ cảnh được tính từ khung xương nhân vật, bố cục một phần ba với khoảng trống hướng nhìn, qua vai, góc thấp/cao/nghiêng, các chuyển động dolly, pan, tilt, crane, bám theo, máy cầm tay. Hậu cảnh nhiều lớp thị sai (multiplane), độ sâu trường ảnh, phối cảnh không khí. Quy tắc trục 180° tự đúng vì máy quay nhìn vào cùng một sân khấu. |
| [KupkaProd](https://github.com/Matticusnicholas/KupkaProd-Cinema-Pipeline) | Chia cảnh → quay nhiều bản → chọn → ghép, làm tiếp dự án | **Vòng duyệt gần như miễn phí**: `cinema sheet` dựng storyboard 3 khung mỗi góc máy trong vài giây để agent tự xem và chấm, sửa mã, dựng lại. **Làm tiếp dự án**: mỗi góc máy được nhớ đệm theo lát nội dung thực sự xuất hiện trong nó; sửa một câu thoại chỉ dựng lại góc máy chứa câu đó; giọng đọc nhớ đệm theo câu. |

Lồng tiếng giữ cách làm của srt-whiteboard-animation:

- VieNeu-TTS v3 Turbo chạy offline với 24 giọng có sẵn theo vùng miền và phong cách.
- Chế độ giọng câm để dựng nháp khi chưa cài.
- Phụ đề SRT và phụ đề in trên hình.

## Số liệu thực tế

Đo trên máy 4 nhân CPU, không GPU, với phim mẫu *Chuyến đò cuối*:
- 83 giây, khổ scope 2,39:1;
- 3 cảnh, 14 góc máy;
- 13 câu thoại VieNeu thật.

| Việc | Thời gian |
| --- | --- |
| `cinema check` (đã có giọng, gồm căn khẩu hình) | khoảng 1 giây |
| `cinema sheet` (storyboard toàn phim) | khoảng 6 giây |
| `cinema render --draft` (640×268) | khoảng 37 giây |
| `cinema render` (1920×804, motion blur) | khoảng 2 phút 50 giây; số khung 1993/1993, −17 LUFS |
| Sửa một câu thoại rồi dựng lại bản nháp | khoảng 17 giây, chỉ dựng lại góc máy chứa câu đó và đoạn chuyển cảnh liền sau |

Phim mẫu thứ hai *Đèn Trung Thu* là cảnh đêm có đèn ông sao phát sáng, quay lưng rồi quay mặt, chạy tới ôm:
- 59 giây, khổ 2,39:1, 2 cảnh, 12 góc máy, 8 câu thoại VieNeu;
- dựng bản cuối mất 1 phút 44 giây;
- số khung 1408/1408, −18,4 LUFS.

Đầu ra gồm:

- Video H.264 (1080p hoặc 4K, các khổ 16:9, 2,39:1, 1,85:1, dọc, vuông).
- Âm thanh AAC 48 kHz stereo, chuẩn −16 LUFS.
- Tệp SRT.
- Báo cáo có kiểm tra số khung khớp thời lượng.

## Cách dùng

```bash
bun install
bun run cinema setup                                   # một lần: VieNeu-TTS (~1 GB)
bun run cinema render packages/cinema/examples/chuyenDoCuoi/film.ts
```

Với agent: giao cho nó [`packages/skills/cinema/SKILL.md`](../packages/skills/cinema/SKILL.md), hoặc gõ `/cinema` trong Claude Code, kèm ý tưởng hay truyện. Agent tự viết `projects/<tenPhim>/film.ts`, duyệt storyboard và giao phim.

## Trong ứng dụng Toonflow

- **Agent của app** có công cụ `cinema` và kỹ năng `cinema`:
  - viết `film.ts` vào workspace;
  - tự chạy `check` → `sheet` (đọc ảnh storyboard để tự sửa) → `render`.
  - Bản cài cũ chưa có kỹ năng thì gọi công cụ với `command: "guide"` để đọc hướng dẫn.
- **Node Phim** trên canvas: nhập đường dẫn `film.ts`, bấm Storyboard, Nháp hoặc Bản cuối, xem nhật ký dựng và kết quả ngay trên node. Đầu ra nối được sang các node video, ảnh.
- **API** `POST /api/cinema/run`:
  - nhận `{ requestId, directory, command, film, draft?, shots?, at?, voice? }`;
  - trả sự kiện SSE `log` / `done` (kèm `outputs`) / `error`;
  - gửi `command: "cancel"` với cùng `requestId` để dừng.
- **FFmpeg** lấy theo cấu hình trong chợ plugin; thiếu FFmpeg thì app hiện hướng dẫn cài như các tính năng khác.
- **Bản desktop** chép kèm bộ dựng cùng phụ thuộc gốc của nền tảng (`apps/desktop/scripts/stageCinema.ts`); môi trường Python của VieNeu đặt trong thư mục dữ liệu.
