# Đề xuất tối ưu & phát triển – ALAN Monitor

**Mục tiêu:** Không ảnh hưởng hiệu năng thiết bị thi đấu; giám sát & vận hành trơn tru; phục vụ vận hành giải đấu offline.

---

## A. Tác động lên thiết bị thi đấu (cần giảm tải)

| Nguồn | Tần suất | Đề xuất |
|-------|----------|---------|
| **UsageStatsManager.queryEvents(15s)** | Mỗi 2s | Nặng trên một số OEM. Cân nhắc: giữ 2s nhưng thu hẹp window 15s → 10s; hoặc tùy chọn "chế độ tiết kiệm" heartbeat 3–5s. |
| **NetworkInterface.getNetworkInterfaces()** | Mỗi 2s | Có thể cache `localIp` 10–30s, chỉ cập nhật khi mất kết nối hoặc định kỳ thưa hơn. |
| **BatteryManager / registerReceiver(ACTION_BATTERY_CHANGED)** | Mỗi 2s | Nhẹ; có thể cache 5s nếu cần. |
| **Heartbeat + mã hóa** | Mỗi 2s | Ổn; tránh giảm dưới 2s. Có thể thêm tùy chọn interval (2/3/5s) từ server hoặc cấu hình. |
| **Reconnect cố định 2s** | Khi mất kết nối | Thêm backoff (2s → 4s → 8s, max 30s) để tránh hammer server khi nhiều máy reconnect cùng lúc. |

---

## B. Tối ưu server & dashboard (vận hành trơn tru)

### Đã áp dụng / nên giữ
- Delta broadcast (`device_updated`, `alerts_updated`) thay vì full state mỗi heartbeat.
- Disconnect check 2s, ngưỡng 7s.
- Giới hạn alerts 500, trim khi vượt.

### Đã triển khai (phiên bản hiện tại)

1. **Network check:** Interval **5s** (mặc định); cấu hình qua env `NET_CHECK_INTERVAL_MS` (vd. 1000 nếu cần kiểm tra mỗi giây).
2. **Frontend – throttle render():** Debounce **150ms** (`scheduleRender()`); init/update_all vẫn gọi `render()` ngay. Giảm lag khi nhiều thiết bị.
3. **App – cache localIp:** Cache **20s**; gọi `NetworkInterface.getNetworkInterfaces()` thưa hơn, giảm tải thiết bị.
4. **App – reconnect backoff:** 2s → 4s → 8s → … max 30s; kết nối thành công thì reset về 2s. Tránh reconnect storm.

### Đề xuất triển khai tiếp

1. **Dashboard – log panel:** Giới hạn/paginate nhóm log khi rất nhiều thiết bị.
3. **ADB:** Chạy `adb` trong worker/queue hoặc `child_process` tách, tránh block event loop khi list/push/pull lâu.
4. **DB write:** Giữ debounce 5s; có thể chuyển sang write async (writeFile trong setImmediate) nếu `alerts` rất lớn.
5. **Dashboard – log panel:** Giới hạn số nhóm log hiển thị (ví dụ 50), "Xem thêm" khi có nhiều thiết bị vi phạm.

---

## C. Tính năng phục vụ vận hành giải đấu offline

### Giám sát & cảnh báo
- **Chế độ "Chỉ vi phạm":** Tab/filter chỉ hiển thị thiết bị đang vi phạm (warning) + log tương ứng.
- **Âm thanh / thông báo:** Tùy chọn beep hoặc notification khi có thiết bị mới vi phạm hoặc mất kết nối.
- **Ngưỡng cấu hình:** Disconnect (giây), heartbeat interval (giây) qua file config hoặc env để điều chỉnh theo từng địa điểm (WiFi yếu ↔ ổn định).

### Phiên làm việc & backup
- **Export/Import phiên:** Export toàn bộ trạng thái hiện tại (devices + slot + alerts + tableNames) ra JSON; import lại khi đổi máy hoặc backup giữa các ngày thi đấu.
- **Khôi phục sau restart:** Lưu snapshot `devices` (slot, seatLayout) vào db hoặc file; khi server khởi động lại vẫn giữ bố cục sân khấu (thiết bị vẫn cần kết nối lại để cập nhật realtime).

### Vận hành phòng điều khiển
- **Dashboard chỉ đọc:** Tài khoản/xem "observer" chỉ xem, không gán slot / clear log / đổi net config.
- **Ghi chú thiết bị:** Cho phép ghi chú (note) theo device (ví dụ "Máy dự bị bàn 3") lưu local hoặc server.
- **LAN Deployer:** Giữ như hiện tại; có thể thêm "deploy to many" (chọn nhiều thiết bị, push cùng file) cho vòng loại nhanh.

### Báo cáo & hậu cần
- **Export log theo ngày/giờ:** Lọc violation logs theo khoảng thời gian rồi export CSV.
- **In nhanh danh sách:** Trang in thân thiện cho danh sách thiết bị + slot + trạng thái (để trực trường dùng giấy).

---

## D. Thứ tự ưu tiên gợi ý

| Ưu tiên | Hạng mục | Lý do |
|--------|----------|--------|
| 1 | Throttle render() dashboard | Giảm lag khi nhiều thiết bị, không đụng app. |
| 2 | Network check 5s (hoặc env) | Giảm tải server, vẫn đủ cho giám sát mạng. |
| 3 | App: cache localIp 15–30s | Giảm tải thiết bị, ít ảnh hưởng độ chính xác. |
| 4 | Reconnect backoff trên app | Tránh reconnect storm khi WiFi tạm mất. |
| 5 | Filter "Chỉ vi phạm" + (tùy chọn) âm thanh | Phục vụ trực tiếp vận hành. |
| 6 | Export/Import phiên + snapshot devices | Backup và chuyển máy an toàn. |
| 7 | ADB không block main thread | Ổn định server khi dùng LAN Deployer nhiều. |

---

*Tài liệu dựa trên deep scan project; có thể bổ sung khi triển khai từng mục.*
