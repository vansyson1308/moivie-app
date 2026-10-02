# Quy tắc phân cảnh

## Ngôn ngữ máy quay

Công cụ dịch các giá trị trong `camera` thành câu lệnh điện ảnh. Chọn có chủ đích, đừng để mặc định cho mọi cảnh.

| Trường | Giá trị | Dùng khi |
| --- | --- | --- |
| `size` | `establishing`, `extremeWide`, `wide` | Mở chương, đổi bối cảnh, cho thấy quy mô |
| | `full`, `medium`, `twoShot` | Hành động toàn thân, hai người tương tác |
| | `mediumClose`, `closeUp`, `extremeCloseUp` | Cảm xúc, câu thoại quan trọng, chi tiết |
| | `insert`, `overShoulder`, `pov` | Đồ vật then chốt, hội thoại, góc nhìn nhân vật |
| `angle` | `eyeLevel`, `low`, `high`, `overhead`, `dutch`, `ground` | Trung tính; uy quyền; yếu thế; toàn cục; bất an; kịch tính |
| `movement` | `static`, `dollyIn`, `dollyOut`, `panLeft`, `panRight`, `tiltUp`, `tiltDown`, `truckLeft`, `truckRight`, `craneUp`, `craneDown`, `orbitLeft`, `orbitRight`, `tracking`, `handheld`, `zoomIn`, `zoomOut`, `dollyZoom` | Mỗi cảnh một chuyển động; cảnh thoại nên `static` hoặc `dollyIn` chậm |
| `speed` | `slow`, `normal`, `fast` | |
| `lens` | 14–18 siêu rộng · 24–28 rộng · 35–50 chuẩn · 85–135 tele | Cận mặt dùng 85; toàn cảnh dùng 24–28 |

Phủ cảnh một trường đoạn theo nhịp: toàn cảnh → hai người → qua vai trái/phải → cận mặt → chi tiết. Giữ quy tắc trục 180°: trong một trường đoạn, nhân vật A luôn ở cùng một bên khung hình; vượt trục phải có cảnh trung gian.

## Thời lượng

- Thoại: số âm tiết ÷ 230 × 60 + 1 giây; cộng thêm thời gian cho hành động.
- Cảnh chỉ có hành động: 3–6 giây. Cảnh chèn, phản ứng: 2–3 giây.
- Tổng thời lượng chương ≈ tổng các cảnh; nếu người dùng đặt mục tiêu thời lượng, cân lại số cảnh thay vì kéo dài từng cảnh.

## Viết `action`

- Bắt đầu bằng khoảnh khắc đắt nhất của cảnh, rồi các nhịp hành động theo thời gian, ví dụ "0–2s … , 2–5s …".
- Chỉ mô tả cái thấy được: tư thế, hướng nhìn, đạo cụ trong tay, ai ở bên trái/phải khung hình.
- Không lặp mô tả ngoại hình (công cụ đã chèn), không thêm chữ trên hình, không nhạc.
- Cảnh `continue` mô tả tiếp diễn từ đúng tư thế cuối của cảnh trước; không đổi trang phục, đạo cụ, vị trí.

## Ví dụ

```json
{
  "id": "c1s03", "chapterId": "c1", "locationId": "benDo", "characterIds": ["lan"],
  "action": "Lan stops at the edge of the pier, clutching a small cloth bundle to her chest; 0-2s she looks down at the water, 2-5s she lifts her eyes toward the departing boat.",
  "camera": { "size": "closeUp", "angle": "eyeLevel", "movement": "dollyIn", "speed": "slow", "lens": 85 },
  "duration": 5, "continuity": "continue",
  "dialogue": [{ "speaker": "lan", "text": "Ông ơi, ông đi mạnh khỏe nhé." }]
}
```
