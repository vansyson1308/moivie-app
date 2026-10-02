# Xưởng phim tiếng Việt

[Mục lục tài liệu](./readme.md) · [README tiếng Việt](./readme/readmeVi.md)

Xưởng phim biến ý tưởng, truyện hoặc kịch bản thành phim nhiều cảnh có lời thoại tiếng Việt. Nó dựa trên nền Agent, công cụ và nhà cung cấp mô hình sẵn có của Toonflow, và gồm ba phần:

| Phần | Vị trí | Vai trò |
| --- | --- | --- |
| Công cụ **Xưởng phim** | [`packages/tools/filmStudio`](../packages/tools/filmStudio/readme.md) | Giữ trạng thái `film/project.json`, quay, chọn bản, thu thoại, ghép phim. Đây là phần máy móc, chạy giống nhau ở mọi lần. |
| Kỹ năng **Xưởng phim tiếng Việt** | [`packages/skills/filmStudio`](../packages/skills/filmStudio/SKILL.md) | Quy tắc sáng tác cho Agent ở từng bước: kịch bản, hồ sơ, phân cảnh, duyệt bản quay, âm thanh. |
| Nhà cung cấp **VieNeu-TTS** | [`packages/providers/src/media/vieNeu.ts`](../packages/providers/src/media/vieNeu.ts) | Đọc tiếng Việt bằng VieNeu-TTS chạy trên máy, qua API chuẩn OpenAI `POST /v1/audio/speech`. |

## Dây chuyền

```text
Kịch bản theo chương ─► Hồ sơ nhân vật/bối cảnh ─► Danh sách cảnh ─► Quay nhiều bản ─► Duyệt & chọn ─► Dựng âm thanh ─► Ghép phim
   filmPlan chapters      filmPlan characters/       filmPlan shots    filmShoot         filmPick        filmVoice        filmAssemble
                          locations + generateImage
                                    ▲                                     │                 │
                                    └──── bộ nhớ hình ảnh (memory) ◄──────┴─ khung khóa ◄───┘
```

Mọi bước đọc và ghi cùng một tệp `film/project.json`, được kiểm tra bằng Zod và ghi nguyên tử. Thứ tự được giữ như sau:

- Mỗi bản quay được lưu ngay khi xong, nên dừng giữa chừng không mất gì.
- `filmStatus` tính bước tiếp theo từ dữ liệu, nên Agent làm tiếp đúng chỗ mà không cần nhớ hội thoại cũ.
- Sửa kịch bản hay phân cảnh sẽ hủy bản phim đã xuất. Sửa lời một câu thoại chỉ làm mất bản thu của chính câu đó.

## Tinh hoa lấy từ bốn dự án

| Dự án | Điểm mạnh | Cách đưa vào Xưởng phim |
| --- | --- | --- |
| [AIMovieStudio v2](https://github.com/Heroesjouney/AIMovieStudiov2) | Dàn cảnh, máy quay, nhiều mô hình, timeline | Bảng **ngôn ngữ máy quay**: 12 cỡ cảnh, 6 góc máy, 18 chuyển động, tốc độ và tiêu cự, dịch thành câu lệnh điện ảnh. **Cổng năng lực mô hình**: chọn chế độ sinh, số ảnh tham chiếu và thời lượng theo khai báo `mode`/`durationResolutionMap` của từng mô hình, nên đổi nhà cung cấp không phải sửa dây chuyền. **Nối cảnh bằng khung cuối** (`-sseof -0.1`). Ghép bằng chuẩn hóa `scale/pad/fps` rồi concat. Node `director3dNode` có sẵn vẫn dùng được để dàn cảnh 3D trên canvas. |
| [LongCat-Video](https://github.com/meituan-longcat/LongCat-Video) | Sinh tiếp video, nhân vật chuyển động theo âm thanh | **Sinh tiếp**: cảnh dài hơn giới hạn mô hình được chia thành các đoạn bằng nhau. Mỗi đoạn bắt đầu từ khung cuối của đoạn trước và luôn kèm ảnh neo danh tính. Khi nối, bỏ phần chồng lấn. **Âm thanh theo đoạn**: dải thoại được cắt đúng cửa sổ thời gian của từng đoạn. **Khớp khẩu hình**: nếu mô hình nhận âm thanh tham chiếu và cảnh có nhân vật nói, công cụ gửi dải thoại đã ghép theo lượt (giống chế độ `add`). |
| [StoryMem](https://github.com/Kevin-thu/StoryMem) | Bộ nhớ hình ảnh xuyên cảnh, nhân vật nhất quán | **Ngân hàng ký ức**: chọn bản quay sẽ trích tối đa 3 khung khóa. Khung gần trùng với nhau hoặc với ký ức cũ bị bỏ, dùng băm 8×8 thay cho CLIP. Khi quay cảnh mới, tham chiếu được xếp theo thứ tự: khung nối tiếp → ảnh hồ sơ cố định (như các khung "neo" luôn giữ của StoryMem) → các khung khóa có cùng nhân vật hoặc bối cảnh, gần nhất trước. Tổng số không vượt `memorySize` và giới hạn của mô hình. Cờ `cut`/`continue` có cùng ý nghĩa như trong kịch bản StoryMem. |
| [KupkaProd Cinema Pipeline](https://github.com/Matticusnicholas/KupkaProd-Cinema-Pipeline) | Chia cảnh → quay nhiều bản → chọn → ghép, làm tiếp dự án | **Trạng thái bền** để làm tiếp. **Nhiều bản mỗi cảnh** kèm **tờ duyệt 4 khung**. **Luật chấm**: một mục kém hoặc từ hai mục tạm trở lên thì quay lại, và nhất quán nhân vật kém luôn bị loại. **Prompt tự đủ**: mỗi cảnh chép lại toàn bộ mô tả nhân vật, bối cảnh, phong cách và điều cần tránh. **Ước lượng thời lượng thoại** trước khi quay. Ghép bằng concat demuxer. |

Phần âm thanh làm giống dự án [srt-whiteboard-animation](https://github.com/vansyson1308/srt-whiteboard-animation):

- Giọng VieNeu có sẵn, kèm vùng miền và phong cách.
- Kiểm tra độ hợp lý của câu đọc, khoảng 4,5 âm tiết/giây, cảnh báo nếu lệch ra ngoài khoảng 0,55–1,8 lần.
- Phụ đề SRT ngắt dòng ở 42 ký tự.
- Nhân bản giọng chỉ khi người nói đã đồng ý.

## Cài đặt nhanh

1. **FFmpeg**: “Cài đặt → Chợ tiện ích → FFmpeg”.
2. **Mô hình video**: thêm nhà cung cấp trong “Cài đặt → Mô hình đa phương tiện”. Mô hình nhận nhiều ảnh tham chiếu (ví dụ Seedance) giữ nhân vật nhất quán tốt nhất.
3. **VieNeu-TTS**:
   - Chạy `pip install vieneu`, rồi `python -m apps.openai_speech`.
   - Điền địa chỉ máy chủ (mặc định `http://127.0.0.1:8000`) cho nhà cung cấp **VieNeu-TTS (tiếng Việt)**.
   - Bản cài mới tự có nhà cung cấp này. Bản cài cũ thì thêm bằng tệp nguồn `vieNeu.ts`.
4. **Mở một thư mục làm việc**, rồi gõ cho Agent, ví dụ: `/skill:filmStudio Làm phim ngắn 1 phút về chuyến đò cuối cùng của ông lái đò, tỉ lệ 9:16`.

## Thư mục dự án

```text
film/
  project.json        trạng thái dự án (settings, chapters, characters, locations, shots, memory, output)
  takes/<cảnh>/       các bản quay, tờ duyệt .jpg, parts/ cho cảnh nhiều đoạn
  memory/             khung khóa của bộ nhớ hình ảnh
  audio/<cảnh>/       thoại từng câu và voice.wav đã ghép
  render/             từng cảnh đã chuẩn hóa 25 fps
  output/             phim .mp4 (kèm phụ đề mềm) và .srt
```

## Giới hạn hiện tại

- Bộ nhớ hình ảnh dùng băm trung bình 8×8 để loại khung trùng. Cách này nhanh và không cần mô hình, nhưng kém tinh hơn so khớp ngữ nghĩa bằng CLIP như StoryMem. Có thể thay bằng embedding ảnh khi nhà cung cấp hỗ trợ.
- Các cảnh nối với nhau bằng cắt thẳng (hard cut), chưa có chuyển cảnh mờ dần.
- Mô hình chỉ nhận khung đầu (không nhận nhiều ảnh tham chiếu) sẽ nối cảnh được, nhưng không nhận được bộ nhớ hình ảnh.
- Trạng thái dự án chỉ được bảo vệ trong một tiến trình, không hỗ trợ hai máy chủ cùng sửa một dự án.
