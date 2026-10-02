---
name: cinema
description: Làm phim hoạt hình tiếng Việt hoàn toàn trên máy, không cần API key — agent viết kịch bản theo chương, dựng diễn viên/bối cảnh bằng mã, phân cảnh, đạo diễn máy quay và diễn xuất, lồng tiếng VieNeu-TTS, rồi tự dựng ra MP4 có phụ đề, nhạc nền, tiếng nền. Dùng khi người dùng muốn "làm phim", "phim hoạt hình", "phim ngắn có nhân vật và lời thoại", "chuyển truyện thành phim", hoặc sửa tiếp một phim trong projects/.
---

# Xưởng phim biên dịch — Toonflow Cinema

Bạn (agent) là **biên kịch + đạo diễn + họa sĩ + đạo diễn diễn xuất + đạo diễn lồng tiếng + dựng phim**. Bạn viết cả bộ phim thành **mã TypeScript**; máy biên dịch mã thành phim: nhân vật có khung xương, nhép miệng theo giọng thật, máy quay ảo có thị sai nhiều lớp, ánh sáng theo giờ, thời tiết, nhạc tự sinh, trộn tiếng, phụ đề, xuất MP4. Không gọi API tạo ảnh/video nào, chi phí bằng 0, kết quả lặp lại y hệt.

Vì phim là mã: **nhân vật không bao giờ "trôi" ngoại hình**, cảnh sau tự nối đúng vị trí cảnh trước, sửa một câu thoại chỉ đọc lại câu đó và chỉ dựng lại cảnh chứa nó.

Trả lời người dùng bằng ngôn ngữ của họ (mặc định tiếng Việt).

## Chuẩn bị (một lần)

```bash
bun install
bun run cinema setup      # cài VieNeu-TTS vào packages/cinema/.venv (~1 GB mô hình, chạy CPU)
```

Cần FFmpeg trong PATH (hoặc `FFMPEG_PATH`). Chưa cài VieNeu vẫn làm được: máy dùng **giọng câm** (thời lượng ước theo âm tiết, miệng vẫn nhép) để dựng nháp, cài xong thì dựng lại là có tiếng.

## Quy trình 6 bước

Mỗi phim là một thư mục riêng `projects/<tenPhim>/` (đã được Git bỏ qua, không commit). Mẫu đầy đủ: [`examples/chuyenDoCuoi/film.ts`](examples/chuyenDoCuoi/film.ts).

### 1. Kịch bản theo chương

Viết dàn ý trước khi viết mã: nhân vật muốn gì, cản trở là gì, thay đổi ra sao. Mỗi chương là một hồi; mỗi cảnh (scene) là một không gian–thời gian liên tục; trong cảnh có nhiều góc máy (shot).

- Phim ngắn 1–2 phút: 2–4 cảnh, 8–20 góc máy, 10–25 câu thoại.
- **Thoại là văn nói**, câu ngắn, mỗi câu một ý, viết số thành chữ khi cần đọc tự nhiên. Khoảng 230 âm tiết/phút.
- Lời dẫn (`narrate`) dùng tiết kiệm: mở truyện, chuyển thời gian, câu kết.
- Mỗi câu thoại phải làm thay đổi điều gì đó (tiết lộ, quyết định, cảm xúc). Cắt câu thừa.

### 2. Hồ sơ diễn viên và bối cảnh (viết bằng mã)

```ts
import { createFilm } from "@toonflow/cinema";

const film = createFilm({ title: "Tên phim", narrator: "Thiện Minh", music: "calm" });

film.cast({
  tu: { name: "Ông Tư", age: "elder", skin: "#c48a5c", beard: "goatee", hat: "nonLa",
        outfit: { style: "aoBaBa", top: "#5b4a3a", bottom: "#2a2522" }, voice: "Thái Sơn" },
  lan: { name: "Cô Lan", gender: "female", hair: { style: "long" },
         outfit: { style: "aoDai", top: "#f4f1ea", bottom: "#f4f1ea" }, voice: "Ngọc Linh" },
});

film.set("benDo", {
  width: 2400, time: "dawn", ground: "dirt", weather: "mist",
  elements: [
    { type: "mountains", seed: 4 }, { type: "river", y: -150, depth: 0.8 },
    { type: "pier", x: 1250, width: 560 }, { type: "boat", id: "do", x: 1700, y: 40 },
    { type: "reeds", x: 2150, width: 500 },   // depth > 1: tiền cảnh, tự mờ khi quay cận
  ],
});
```

- Chọn màu trang phục tương phản nhau giữa các nhân vật; giọng hợp tuổi, giới, vùng miền (`bun run cinema voices`).
- Toạ độ thế giới: mặt đất `y = 0`, người lớn cao khoảng 336, khung toàn cảnh 16:9 thấy khoảng 1920 × 1080 đơn vị. Đặt nhân vật cách nhau 250–450 khi nói chuyện.
- `depth` < 1 là hậu cảnh (càng nhỏ càng xa, trôi chậm khi máy lia, nhạt dần theo không khí), 1 là sân khấu, > 1 là tiền cảnh.
- Thiếu vật thể thì tự vẽ: `{ type: "path", path: "M0,0 L40,-120 L80,0 Z", fill: "#c0392b", x: 900, depth: 1 }` (gốc toạ độ ở chân vật thể). Đạo cụ cầm tay riêng: `film.prop("keo", { path: "...", fill: "#..." })`.

### 3. Danh sách cảnh: dàn dựng, diễn xuất, máy quay

```ts
film.chapter("Chương 1", "Bến sông");          // thẻ tiêu đề

film.scene("benDo", {
  tu: { x: 1660, facing: "left", posture: "sit", ride: "do", hold: "oar" },
  lan: { x: 300, facing: "right" },
}, s => {
  s.shot("establishing", { move: "panRight" })
    .narrate("Ở bến sông này, suốt bốn mươi năm, ông Tư chèo đò.");
  s.shot("full", { on: "lan", move: "follow" })
    .act("lan", "walk", { to: 1360 });
  s.shot("auto")                                 // máy tự chia: qua vai → cận người nói
    .say("lan", "Ông Tư ơi, cho con qua sông với!", { emotion: "happy" })
    .act("tu", "stand")
    .say("tu", "Lên đi con.", { emotion: "tender" });
  s.shot("closeUp", { on: "lan", move: "push" })
    .say("lan", "Con vẫn cần mà ông.", { emotion: "sad" });
}, { music: "sad" });

export default film;
```

- Các nhịp chạy **nối tiếp**; thêm `{ with: true, delay: 0.5 }` để chạy song song với nhịp ngay trước (ví dụ vừa chèo vừa có lời dẫn, thuyền trôi trong lúc vẫy tay).
- Một cảnh nên mở bằng toàn cảnh (`establishing`/`wide`) để khán giả biết ai ở đâu; sau đó mới vào cận.
- `shot("auto")` hợp cho hội thoại dài; tự đặt góc máy khi cần ý đồ (phản ứng, chi tiết, cú lật).
- Cảnh xúc động: `closeUp` + `push`/`dollyIn`, góc `low` cho nhân vật mạnh mẽ, `high` cho nhân vật yếu thế, `handheld` cho căng thẳng.

### 4. Dựng thử và duyệt (vòng lặp chính)

```bash
bun run cinema check  projects/<ten>/film.ts           # lỗi kịch bản, danh sách góc máy, thời lượng
bun run cinema sheet  projects/<ten>/film.ts           # storyboard: 3 khung mỗi góc máy → out/sheet-*.png
bun run cinema still  projects/<ten>/film.ts --at 12.5 # một khung 1080p để soi kỹ
bun run cinema render projects/<ten>/film.ts --draft --shots 3-6   # xem thử vài góc máy, 640×360
```

**Mở từng trang `sheet-*.png` bằng công cụ đọc ảnh** và tự chấm như đạo diễn — đây là bước "quay nhiều bản rồi chọn" của phim thật, nhưng gần như miễn phí:

| Soát | Câu hỏi |
| --- | --- |
| Bố cục | Nhân vật chính có trong khung, không bị cắt mặt? Chừa khoảng trống phía hướng nhìn? Phụ đề không che mặt? |
| Liên tục | Vị trí, hướng mặt, đạo cụ trong tay nối đúng giữa các góc máy? |
| Diễn xuất | Biểu cảm hợp lời thoại? Người nghe có phản ứng? Động tác có lặp đơ? |
| Nhịp | Góc máy dưới 1,2 giây có gây giật? Cảnh nào kéo dài không có gì xảy ra? |
| Ánh sáng | Giờ trong ngày hợp tâm trạng (bình minh: hy vọng, chiều vàng: hoài niệm, đêm: cô đơn)? |

Sửa mã → chạy lại `sheet`. Góc máy không đổi sẽ không bị dựng lại.

### 5. Dựng âm thanh

- Lồng tiếng: tự động bằng VieNeu-TTS theo `voice` của từng nhân vật, `narrator` cho lời dẫn; được nhớ đệm theo nội dung câu.
- Nhạc nền: tự sinh theo tâm trạng (`calm`, `sad`, `tense`, `hopeful`, `playful`, `epic`, `none`), đặt ở `createFilm({ music })` hoặc từng `scene(..., { music })`. Các cảnh liền nhau cùng tâm trạng dùng chung một bản nhạc; nhạc tự hạ khi có thoại.
- Tiếng nền: suy từ bối cảnh (sông, mưa, đêm, phòng kín…) hoặc đặt `ambience` trong `film.set`.

### 6. Ghép phim

```bash
bun run cinema render projects/<ten>/film.ts
```

Ra `out/<ten>.mp4` (1080p, 24 hình/giây, chuẩn âm lượng −16 LUFS), `out/<ten>.srt` và `out/<ten>-report.json`. Đọc báo cáo: `frames` phải bằng `expectedFrames`. Dựng song song trên nhiều nhân CPU; phim 1 phút mất khoảng 2–3 phút trên máy 4 nhân. Gửi người dùng tệp MP4, SRT, thời lượng, danh sách cảnh và những chỗ bạn đã tự sửa sau khi duyệt.

## Tra cứu nhanh

**Diễn viên** (`film.cast`): `name`, `age` (child/adult/elder), `gender`, `build` (slim/average/heavy), `skin`, `hair: { style, color }` (short, sidePart, long, bun, ponytail, bald, curly, bob), `beard` (none, mustache, goatee, full), `outfit: { style, top, bottom, accent }` (shirt, aoDai, aoBaBa, dress, jacket, robe), `hat` (none, nonLa, cap, khanDong, beret), `hatColor`, `glasses`, `scale`, `voice`.

**Bối cảnh** (`film.set`): `width`, `time` (dawn, morning, noon, golden, dusk, night, overcast), `ground` (grass, dirt, sand, wood, tile, stone, none), `groundColor`, `interior: { wall, floor }`, `weather` (mist, rain, snow, fireflies, petals, leaves), `ambience` (river, wind, rain, night, room, sea, forest, market, none), `elements`.

**Vật thể** (`elements[].type`): hậu cảnh `mountains`, `hills`, `forest`, `city`, `clouds`, `sea`, `river`, `rice`, `bamboo`, `pagoda`; sân khấu `tree`, `palm`, `house`, `pier`, `boat`, `table`, `chair`, `stool`, `lantern`, `lamp`, `campfire`, `altar`, `window`, `door`, `frame`, `bed`, `rock`, `bush`, `sign` (có `text`); tiền cảnh `reeds`, `grass`; tự vẽ `path`. Trường chung: `id`, `x`, `y`, `depth`, `scale`, `width`, `color`, `seed`, `flip`, `front`.

**Vị trí ban đầu** (`scene` cast): `x`, `facing` (left/right), `posture` (stand/sit/kneel), `expression`, `hold` (đạo cụ), `ride` (id vật thể để đi theo, ví dụ thuyền), `lookAt`.

**Diễn xuất** (`act`): `walk`/`run` `{ to }`, `turn` `{ at? }`, `sit`, `kneel`, `stand`, `nod`, `shake`, `bow`, `wave`, `point` `{ at }`, `handToChest`, `cry`, `laugh`, `think`, `shrug`, `embrace`, `row`, `give` `{ at, prop }`, `pickUp` `{ prop }`, `putDown`, `jump`, `look` `{ at }`, `emote` `{ expression }`; mọi động tác nhận `duration`.

**Biểu cảm**: neutral, happy, sad, angry, surprised, scared, thinking, tender. **Đạo cụ có sẵn**: oar, letter, flower, lantern, bag, book, cup, stick, umbrella, phone, bowl, fan, basket.

**Góc máy** (`shot`): cỡ `establishing`, `wide`, `full`, `medium`, `mediumClose`, `closeUp`, `extremeCloseUp`, `twoShot`, `overShoulder` (`on: [người nói, người nghe]`), `auto`; `move`: static, push, dollyIn, dollyOut, panLeft, panRight, tiltUp, tiltDown, craneUp, craneDown, follow, handheld; `angle`: eyeLevel, low, high, dutch; `transition`: cut, fade, fadeWhite; `dof`; `duration`.

**Phim** (`createFilm`): `title`, `format` (landscape, portrait cho TikTok, square), `narrator`, `music`, `subtitles`, `credits`, `author`, `look: { grain, vignette, letterbox }`.

## Xử lý sự cố

| Triệu chứng | Cách xử lý |
| --- | --- |
| `Kịch bản có lỗi` | đọc từng dòng: thiếu nhân vật trong cast của cảnh, id vật thể sai, đạo cụ chưa khai báo |
| VieNeu báo `External data path escapes model directory` | `packages/cinema/.venv/bin/pip install "onnxruntime<1.23"` (setup đã ghim sẵn) |
| Không có mạng / chưa cài giọng | `--voice silent` để dựng nháp đúng nhịp |
| Muốn dùng máy chủ VieNeu riêng | `VIENEU_URL=http://127.0.0.1:8000` (máy chủ `python -m apps.openai_speech`) |
| Nhân vật ra khỏi khung | kiểm tra `x` so với `width` của bối cảnh; dùng `twoShot`/`wide` thay vì cận |
| Dựng chậm | dùng `--draft` và `--shots` khi duyệt; đặt `CINEMA_WORKERS` để đổi số luồng |
