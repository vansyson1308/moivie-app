# Tiêu chí duyệt bản quay

Mở tờ duyệt 4 khung (`sheet`) của từng bản; khi cần, so với ảnh hồ sơ nhân vật và khung cuối của cảnh trước. Chấm mỗi mục **tốt / tạm / kém**:

| Mục | Câu hỏi |
| --- | --- |
| Khớp nội dung | Đúng nhân vật, đúng hành động, đúng đạo cụ như `action`? |
| Chuyển động | Cử động tự nhiên, không méo tay chân, không giật, không biến dạng? |
| Nhất quán nhân vật | Khuôn mặt, tóc, trang phục khớp ảnh hồ sơ và các cảnh trước? |
| Đúng cỡ cảnh | Cỡ cảnh, góc máy, chuyển động đúng `camera`? |
| Liền mạch | Với cảnh `continue`: vị trí, ánh sáng, trang phục nối đúng khung cuối cảnh trước? |

**Luật:** có một mục **kém**, hoặc từ hai mục **tạm** trở lên, là **không đạt**. Nhất quán nhân vật **kém** luôn là không đạt.

Khi nhiều bản cùng đạt, chọn bản có nhất quán nhân vật tốt nhất, rồi đến chuyển động. Ghi lý do chọn vào `note` của `filmPick` nếu có điều đáng lưu ý.

Khi quay lại, `note` phải nói lỗi cụ thể và cách sửa, ví dụ "the boat drifted out of frame; keep the boat centered in the background". Nếu cùng một lỗi lặp lại sau hai lượt, sửa gốc trong `filmPlan`: mô tả rõ hơn, đổi cỡ cảnh, tách cảnh, hoặc bổ sung ảnh hồ sơ.
