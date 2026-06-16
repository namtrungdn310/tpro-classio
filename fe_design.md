# TPRO Classio - Frontend Design Guide

Tai lieu nay la nguon tham chieu khi thiet ke va sua giao dien TPRO Classio. Moi thay doi UI trong cac phase sau phai duoc doi chieu voi file nay; neu quy tac giao dien thay doi, cap nhat file nay trong cung lan sua code.

## 1. Dinh Huong San Pham

- TPRO Classio la web app noi bo cho trung tam tieng Anh, uu tien quan ly hoc vien, lop hoc, hoc phi va bao cao doanh thu.
- Nguoi dung chinh chi gom Admin va Viewer; giao dien can nhanh, ro rang, it thao tac thua.
- Day la cong cu van hanh hang ngay, khong phai landing page. Man hinh dau tien sau dang nhap phai la dashboard lam viec, khong co hero marketing.
- Ngon ngu UI, validation, toast, empty state va loi phai la tieng Viet.

## 2. Nguyen Tac Tong The

- Bang du lieu la UI chinh cho Lop hoc, Hoc vien, Hoc phi va Bao cao.
- Bo cuc can gon, scan nhanh, uu tien thao tac lap lai: tim kiem, loc, sua inline, xac nhan, xuat file.
- Khong dung gradient, bong do nang, hieu ung trang tri, blob/orb, anh stock, card marketing.
- Khong long card trong card. Card chi dung cho metric, item lap lai, dialog/modal hoac mobile card thay bang.
- Trang quan tri dung spacing chat vua phai; khong dung heading qua lon trong panel, table, dialog.
- Toan bo thao tac nguy hiem hoac dao trang thai quan trong can co confirm dialog dung ngu canh.

## 3. Mau Sac Va Thuong Hieu

- Nen chinh: trang hoac xam rat nhat.
- Chu chinh: den/xam dam.
- Vien, duong ke, header table: xam trung tinh nhe.
- Accent theo dev plan: `#1F5C2E`, dung cho nut chinh, active tab, focus ring hoac diem nhan han che.
- Logo su dung trong frontend la ban trang den trong `frontend/public/logo-bw.png` va ban crop cho UI tai `frontend/public/logo-mark-bw.png`; chi dung o vi tri nhan dien nho nhu navbar, login, favicon/PWA icon sau nay.
- Trang thai:
  - Da nop / PAID: xanh ro nhung tiet che.
  - Chua nop / UNPAID: do canh bao de nhan dien nhanh.
  - Inactive / muted rows: xam nhe, giam do tuong phan vua du de doc.
- Khong tao UI mot mau; neu mot man hinh bi doc sac, them neutral surfaces, text hierarchy va status colors dung muc.

## 4. Typography Va Dinh Dang

- Font sans-serif mac dinh cua stack Next.js/Tailwind la du; uu tien de doc tren mobile.
- Khong scale font theo viewport width.
- Letter spacing giu `0`, khong dung tracking am.
- Tien te hien thi dang `1.200.000d`.
- Ky hoc thang hien thi dang `Thang 6/2025` khi du lieu la `2025-06`.
- Text trong nut, badge, table cell khong duoc tran container; neu dai thi xuong dong hoac truncate co tooltip khi can.

## 5. Layout Ung Dung

- Sau dang nhap co top navbar:
  - Ben trai: ten ung dung `TPRO Classio`.
  - Ben phai: email nguoi dung va nut dang xuat.
- Co tab bar ngang cho desktop: `Tong quan`, `Hoc vien`, `Lop hoc`, `Hoc phi`, `Bao cao`.
- Protected routes nam trong dashboard layout; khi het session hoac 401 thi redirect `/login` kem thong bao tieng Viet.
- Mobile duoi 768px:
  - An cot khong thiet yeu.
  - Uu tien bottom tab bar voi icon cho cac route chinh.
  - Touch target toi thieu 44px.
  - Fee table co the stack thanh card de thao tac tick/sua inline de hon.

## 6. Component Rules

- Dung shadcn/ui style `new-york`, theme neutral.
- Dung lucide icons trong nut icon khi co icon phu hop.
- Nut icon phai co tooltip hoac accessible label neu y nghia khong hien nhien.
- Dung segmented controls/tabs cho che do xem, dropdown/menu cho tap lua chon, checkbox/toggle cho trang thai nhi phan, input/stepper cho so tien.
- Dialog dung cho them/sua/ghi danh/thiet lap danh sach thu.
- AlertDialog dung cho xoa/deactivate, huy xac nhan thanh toan, va cac thao tac co rui ro.
- Toast ngan gon, tieng Viet, bao ro ket qua: da luu, da tao N phieu, loi mang, khong co quyen.

## 7. Bang Du Lieu

- Table la mac dinh cho desktop.
- Header can ro, cot can dung ten Viet theo tai lieu:
  - Lop hoc: `Ten lop`, `Loai`, `Hoc phi goc`, `So hoc vien`, `Trang thai`, `Thao tac`.
  - Hoc vien: `Ho ten`, `Nam sinh`, `Truong`, `Lop dang hoc`, `Phu huynh`, `SDT`, `Ten Zalo`, `HP thang nay`, `Thao tac`.
  - Hoc phi: `Hoc vien`, `Lop`, `HP goc`, `Giam`, `Ly do`, `Thuc thu`, `Trang thai`, `Ngay nop`, `Xac nhan`.
- Filter row nam tren table: search, dropdown lop/type/status, period selector neu can.
- Viewer khong thay nut them/sua/xoa/thiet lap/xac nhan/chinh giam; chi thay du lieu va nut xuat file neu tinh nang cho phep.
- PAID rows trong bang hoc phi co the muted de scan, nhung so tien va trang thai van phai doc duoc.
- Inline edit trong bang hoc phi luu khi Enter hoac blur; hien pending state nhe va toast ket qua.

## 8. Luong Hoc Phi Can Giu Dung

- Thiet lap danh sach thu:
  - Admin chon period + lop.
  - Hien preview truoc khi tao, gom so phieu se tao va so phieu bi bo qua.
  - Confirm xong moi insert batch.
  - Toast dang `Da thiet lap N phieu hoc phi`.
- Xac nhan da nop:
  - Click checkbox/circle tick tren dong UNPAID.
  - Optimistic UI doi sang PAID, paid_date la ngay hien tai.
  - Neu API loi, rollback ve UNPAID va toast loi.
- Huy xac nhan:
  - Click tick tren dong PAID.
  - Hien AlertDialog `Bo xac nhan thanh toan?`.
  - Confirm xong doi ve UNPAID, xoa paid_date/paid_amount.

## 9. Empty, Loading, Error

- Moi route co loading skeleton phu hop voi bo cuc that.
- Empty state phai co cau tieng Viet ngan va action chinh neu Admin co quyen.
- Loi API phai hien bang toast tieng Viet; khong de raw exception hien len UI.
- Session het han: redirect `/login`, thong bao nguoi dung can dang nhap lai.
- Render free tier co the wake up cham; UI nen co loading state binh tinh, khong coi delay dau tien la loi ngay.

## 10. Dashboard Va Bao Cao

- Dashboard gom 4 metric chinh: `Tong hoc vien`, `Da thu`, `Con thieu`, `Ti le thu`.
- Bieu do doanh thu theo lop dung phong cach toi gian, mau xam/neutral, khong trang tri nang.
- Bao cao chua nop phai de giao vien doc va nhan Zalo:
  - Phu huynh noi bat.
  - Ten hoc vien, lop, Zalo, SDT, so tien con thieu, ly do giam neu co.
  - So tien chua nop dung mau do tiet che.
- Print/PDF phai an nav, nut, filter; header in la `TPRO English - Danh sach chua nop hoc phi thang X/Y`.

## 11. Responsive Va PWA

- Hoat dong tot tu 375px tro len.
- Khong overflow ngang tren mobile, tru khi bang du lieu co pattern scroll ro rang va can thiet.
- Cac thao tac hay dung tren mobile phai nam trong tam cham, khong nho hon 44px.
- PWA dung `name: TPRO Classio`, `short_name: TPRO`, `display: standalone`, `theme_color: #ffffff`, `start_url: /`.

## 12. Checklist Truoc Khi Hoan Thanh UI

- UI tieng Viet day du.
- Admin/Viewer hien dung quyen.
- Bang/filter/action khop yeu cau trong `doc/`.
- Khong gradient, khong heavy shadow, khong trang tri thua.
- Mobile 375px khong tran chu, khong overlap, nut cham du lon.
- Loading, empty, error state co mat.
- Toast/confirm dung cho cac luong hoc phi quan trong.
- Neu thay doi quy tac giao dien, da cap nhat file `fe_design.md`.
