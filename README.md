# ✈️ Travel Plan — App kế hoạch du lịch

App web du lịch phong cách chibi: tìm thành phố → app soạn sẵn cẩm nang, gợi ý địa điểm có ảnh thật; lên lịch trình theo từng ngày, mẫu câu giao tiếp theo quốc gia, và danh sách chuẩn bị cho chuyến đi. Dữ liệu chuyến đi được lưu trên máy chủ (file `data/trips.json`).

## Tính năng chính

- **Trang chủ**: nhập ngày đi / ngày về (lịch chọn ngày tự thiết kế, có đánh dấu hôm nay), ô thành phố có gợi ý khi gõ (~490 thành phố), bấm Tìm kiếm là tạo chuyến và tự chuyển sang Lịch trình.
- **Lịch trình**: chọn thành phố theo lưới, chọn ngày theo lưới; mỗi ngày thêm được nhiều địa điểm cùng lúc từ danh sách gợi ý (có ảnh, cách đi, thời lượng), xem chi tiết từng nơi (hướng dẫn tham quan + ăn uống / vui chơi / mua sắm quanh đó), nút "Cẩm nang" mở cẩm nang thành phố, ghi lại **Nơi lưu trú** đã đặt trước, sửa ngày chuyến đi, xóa chuyến.
- **Cẩm nang đóng gói sẵn cho 201 thành phố** thuộc 69 quốc gia khắp thế giới — riêng Trung Quốc có 27 thành phố (Bắc Kinh, Thượng Hải, Tây An, Thành Đô, Quế Lâm, Hàng Châu, Tô Châu, Nam Kinh, Trùng Khánh, Thâm Quyến, Quảng Châu, Côn Minh, Lhasa, Cáp Nhĩ Tân, Đại Liên, Hạ Môn, Trương Gia Giới, Lệ Giang, Đại Lý, Vũ Hán, Trường Sa, Phúc Châu, Thanh Đảo, Thẩm Dương, Hồng Kông, Hoàng Sơn, Cửu Trại Câu; thêm Ma Cao tính riêng) — tổng 1.260 địa điểm, đủ 1.260 ảnh thật từ Wikipedia (mọi địa điểm đều có ảnh, mọi thành phố đều có ảnh bìa, mỗi thành phố ít nhất 6 địa điểm kèm lịch trình gợi ý 3 ngày). Thành phố khác vẫn tạo chuyến và tự thêm địa điểm được.
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

## 🔐 Đăng nhập Google & mục Nhật ký (không bắt buộc)

App có thêm nút **Đăng nhập** (bằng tài khoản Google) và nút **Nhật ký** ở Trang chủ:

- Sau khi đăng nhập, nút Đăng nhập đổi thành **Đăng xuất** và hiện tên của bạn.
- Trong mục **Lịch trình**, mỗi thành phố có thêm nút **💾 Lưu**: bấm vào là lưu thành phố đó (kèm lịch trình từng ngày) vào **Nhật ký của chính tài khoản của bạn**. Mở nút **Nhật ký** ở Trang chủ để xem lại các thành phố đã lưu và xóa mục không cần nữa.
- Muốn dùng được đăng nhập Google, bạn cần **tự tạo một "khóa" Google OAuth** (miễn phí) theo hướng dẫn dưới đây rồi khai vào Render. Nếu chưa tạo khóa, nút Đăng nhập vẫn hiện nhưng bấm vào sẽ báo "Chưa cấu hình đăng nhập Google" — app vẫn dùng bình thường các tính năng khác.

### Bước 1: Tạo project trên Google Cloud

1. Vào https://console.cloud.google.com → đăng nhập bằng tài khoản Google của bạn.
2. Bấm vào ô chọn project ở góc trên → **New Project** → đặt tên, ví dụ `travel-plan` → **Create**.
3. Đợi vài giây rồi chọn đúng project vừa tạo ở ô chọn project.

### Bước 2: Cấu hình màn hình xin quyền (OAuth consent screen)

1. Trong menu bên trái, vào **APIs & Services → OAuth consent screen**.
2. Chọn **External** → **Create**.
3. Điền: **App name**: `Travel Plan`; **User support email**: chọn email của bạn; ở cuối trang, **Developer contact information**: điền lại email của bạn.
4. Bấm **Save and Continue** liên tục qua các bước còn lại (Scopes, Test users — không cần thêm gì) → **Back to Dashboard**.

### Bước 3: Tạo khóa OAuth client ID

1. Vào **APIs & Services → Credentials** → **+ Create Credentials → OAuth client ID**.
2. **Application type**: chọn **Web application**. Đặt tên, ví dụ `Travel Plan Web`.
3. Ở mục **Authorized redirect URIs**, bấm **+ Add URI** và điền đúng địa chỉ app của bạn theo mẫu:

   ```
   https://travel-plan.onrender.com/auth/google/callback
   ```

   (Thay `travel-plan.onrender.com` bằng đúng địa chỉ web của bạn trên Render — phải khớp từng ký tự, kể cả phần `/auth/google/callback` ở cuối.)
4. Bấm **Create**. Google sẽ hiện ra **Your Client ID** và **Your Client Secret** — giữ hai mã này để dùng ở Bước 4 (đừng chia sẻ Client Secret cho người khác).

### Bước 4: Khai khóa vào Render

1. Vào https://render.com → mở Web Service của app → menu **Environment**.
2. Bấm **Add Environment Variable** và thêm lần lượt 3 biến:

   | Key | Value |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | Dán **Client ID** ở Bước 3 |
   | `GOOGLE_CLIENT_SECRET` | Dán **Client Secret** ở Bước 3 |
   | `BASE_URL` | Địa chỉ app, ví dụ `https://travel-plan.onrender.com` (không có dấu `/` ở cuối) |

3. Bấm **Save Changes** — Render sẽ tự khởi động lại app. Sau đó mở app, bấm **Đăng nhập** là đăng nhập bằng Google được.

> Ghi chú: dữ liệu Nhật ký lưu ở file `data/journal.json` trên server, tách riêng theo từng tài khoản Google. Cảnh báo mất dữ liệu trên Render Free ở mục dưới áp dụng cho cả file này.

## 📱 Ghim ra màn hình chính iPhone (dùng như app)

App đã hỗ trợ PWA/Add to Home Screen. Cách ghim:

1. Mở link app bằng **Safari** trên iPhone (phải là Safari, không dùng Chrome/trình duyệt trong ứng dụng khác).
2. Bấm nút **Chia sẻ** (biểu tượng hình vuông có mũi tên hướng lên) ở thanh dưới Safari.
3. Chọn **Thêm vào Màn hình chính** (Add to Home Screen) → bấm **Thêm**.

Xong! Trên màn hình chính sẽ có biểu tượng máy bay chibi tên **Travel Plan**; mở từ biểu tượng này app chạy toàn màn hình như app cài đặt, không còn thanh địa chỉ của Safari.

## ⚠️ Lưu ý quan trọng về dữ liệu trên Render Free

- Gói Free của Render dùng ổ đĩa tạm: **dữ liệu chuyến đi (lưu trong `data/trips.json`) và dữ liệu Nhật ký (lưu trong `data/journal.json`) có thể bị mất khi service khởi động lại** (Render Free tự ngủ sau ~15 phút không dùng và khởi động lại khi có người vào; mỗi lần deploy lại cũng xóa dữ liệu cũ). Hãy coi app như cuốn sổ tay tạm cho từng chuyến đi; thông tin thật quan trọng (mã đặt phòng, vé) nên lưu thêm ở nơi khác.
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
   ├─ trips.json      ← dữ liệu chuyến đi (tự sinh khi chạy, không có trong gói)
   └─ journal.json    ← dữ liệu Nhật ký theo tài khoản (tự sinh khi chạy, không có trong gói)
```

Ảnh địa điểm và phần giới thiệu lấy từ Wikipedia (giấy phép CC BY-SA); nội dung cẩm nang, cách di chuyển và mẫu câu được biên soạn sẵn trong app.
