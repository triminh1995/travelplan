# ✈️ Travel Plan — App kế hoạch du lịch

App web du lịch phong cách chibi: tìm thành phố → app soạn sẵn cẩm nang, gợi ý địa điểm có ảnh thật; lên lịch trình theo từng ngày, mẫu câu giao tiếp theo quốc gia, và danh sách chuẩn bị cho chuyến đi. Dữ liệu chuyến đi được lưu trên máy chủ (file `data/trips.json`).

## Tính năng chính

- **Trang chủ**: nhập ngày đi / ngày về (lịch chọn ngày tự thiết kế, có đánh dấu hôm nay), ô thành phố có gợi ý khi gõ (~190 thành phố), bấm Tìm kiếm là tạo chuyến và tự chuyển sang Lịch trình.
- **Lịch trình**: chọn thành phố theo lưới, chọn ngày theo lưới; mỗi ngày thêm được nhiều địa điểm cùng lúc từ danh sách gợi ý (có ảnh, cách đi, thời lượng), xem chi tiết từng nơi (hướng dẫn tham quan + ăn uống / vui chơi / mua sắm quanh đó), nút "Cẩm nang" mở cẩm nang thành phố, ghi lại **Nơi lưu trú** đã đặt trước, sửa ngày chuyến đi, xóa chuyến.
- **Cẩm nang đóng gói sẵn cho 22 thành phố**: Hà Nội, Đà Nẵng, Hội An, Huế, Nha Trang, Đà Lạt, TP. Hồ Chí Minh, Phú Quốc, Sa Pa, Cần Thơ, Tokyo, Kyoto, Osaka, Nara, Seoul, Busan, Bangkok, Chiang Mai, Singapore, Đài Bắc, Paris, London (172 địa điểm, ảnh thật từ Wikipedia). Thành phố khác vẫn tạo chuyến và tự thêm địa điểm được.
- **Giao tiếp**: mẫu câu theo quốc gia của chuyến đi (8 nước có sẵn: Nhật Bản, Hàn Quốc, Thái Lan, Trung Quốc, Đài Loan, Pháp, Đức, Anh) — có phiên âm, nghĩa tiếng Việt và nút loa đọc mẫu.
- **Chuẩn bị**: 6 nhóm sẵn (Giấy tờ quan trọng, Tiền và thẻ, Quần áo, Đồ điện tử, Vệ sinh và thuốc, Khác), tick hoàn thành, thanh tiến độ %, thêm/bớt mục và tạo nhóm mới — gắn theo từng chuyến đi.

## Cách đăng lên Render (giống app nhà thờ)

### Bước 1: Tạo repo GitHub mới

1. Vào https://github.com → đăng nhập → nút **New** (tạo repository mới).
2. Đặt tên repo, ví dụ: `travel-plan` → bấm **Create repository**.
3. Ở trang repo vừa tạo, bấm **uploading an existing file** rồi kéo–thả **toàn bộ file và thư mục trong gói này** vào (gồm `README.md`, `package.json`, `server.js`, thư mục `public/`, thư mục `data/`) → bấm **Commit changes**.
   - Lưu ý: phải giữ đúng cấu trúc — `server.js` nằm ở thư mục gốc của repo, `public/` và `data/` là thư mục con.

### Bước 2: Tạo Web Service trên Render

1. Vào https://render.com → đăng nhập → **New +** → **Web Service**.
2. Chọn **Build and deploy from a Git repository** → kết nối GitHub → chọn repo `travel-plan`.
3. Điền thông số:
   - **Name**: `travel-plan` (tên này sẽ thành địa chỉ `travel-plan.onrender.com`)
   - **Region**: Singapore (gần Việt Nam nhất)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: Free
4. Bấm **Create Web Service** và đợi Render build (vài phút). Xong sẽ có link dạng `https://travel-plan.onrender.com` — mở link đó trên iPhone, bấm nút Chia sẻ → **Thêm vào Màn hình chính** là dùng như một app riêng.

### Bước 3: Cập nhật bản mới sau này

Chỉ cần tải file mới đè lên GitHub (vào từng file → nút bút chì/Upload files → Commit), Render sẽ tự deploy lại nếu đã bật **Auto-Deploy** (Settings → Build & Deploy → Auto-Deploy: On).

## ⚠️ Lưu ý quan trọng về dữ liệu trên Render Free

- Gói Free của Render dùng ổ đĩa tạm: **dữ liệu chuyến đi (lưu trong `data/trips.json`) có thể bị mất khi service khởi động lại** (Render Free tự ngủ sau ~15 phút không dùng và khởi động lại khi có người vào; mỗi lần deploy lại cũng xóa dữ liệu cũ). Hãy coi app như cuốn sổ tay tạm cho từng chuyến đi; thông tin thật quan trọng (mã đặt phòng, vé) nên lưu thêm ở nơi khác.
- Lần mở đầu sau khi app "ngủ" sẽ chậm ~30–60 giây (Render đang khởi động lại), những lần sau nhanh bình thường.
- Nếu sau này muốn dữ liệu bền vững, cần nâng cấp Render trả phí (gắn thêm Persistent Disk) hoặc chuyển sang host khác có ổ đĩa cố định.

## Chạy thử trên máy tính (không bắt buộc)

Cần cài Node.js 18 trở lên, rồi trong thư mục dự án:

```
npm install   (app không dùng thư viện ngoài nên bước này gần như trống)
npm start
```

Mở http://localhost:3000 trên trình duyệt.

## Cấu trúc thư mục

```
travel-plan/
├─ README.md          ← file này
├─ package.json
├─ server.js          ← máy chủ Node.js thuần (không phụ thuộc gói ngoài)
├─ public/
│  ├─ index.html      ← toàn bộ giao diện (1 file)
│  ├─ assets/         ← ảnh chibi (máy bay, hình nền)
│  └─ data/           ← cẩm nang, danh sách thành phố, mẫu câu (đóng gói sẵn)
└─ data/
   └─ trips.json      ← dữ liệu chuyến đi (tự sinh khi chạy, không có trong gói)
```

Ảnh địa điểm và phần giới thiệu lấy từ Wikipedia (giấy phép CC BY-SA); nội dung cẩm nang, cách di chuyển và mẫu câu được biên soạn sẵn trong app.
