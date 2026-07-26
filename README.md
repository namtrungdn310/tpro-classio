# TPRO Classio

[![CI](https://img.shields.io/github/actions/workflow/status/namtrungdn310/tpro-classio/ci.yml?branch=main&label=System%20quality&logo=github)](https://github.com/namtrungdn310/tpro-classio/actions/workflows/ci.yml)
[![CodeQL](https://img.shields.io/github/actions/workflow/status/namtrungdn310/tpro-classio/codeql.yml?branch=main&label=Security&logo=github)](https://github.com/namtrungdn310/tpro-classio/actions/workflows/codeql.yml)

**Nền tảng quản lý vận hành dành riêng cho TPRO English.**

TPRO Classio kết nối học viên, lớp học, đội ngũ, lịch giảng dạy và học phí trong
một không gian làm việc thống nhất. Sản phẩm được xây dựng để giảm thao tác thủ
công, hạn chế sai lệch dữ liệu và giúp người quản lý nắm bắt tình hình trung tâm
một cách nhanh chóng.

> **Trạng thái sản phẩm:** đang hoàn thiện và chuẩn bị kiểm định trên môi trường
> staging trước khi phát hành chính thức.

## Một nơi để vận hành toàn bộ trung tâm

Thay vì theo dõi dữ liệu qua nhiều bảng tính và công cụ rời rạc, TPRO Classio
tập trung các nghiệp vụ hằng ngày vào cùng một hệ thống:

- Hồ sơ học viên và thông tin liên hệ.
- Lớp học, giáo viên, trợ giảng và lịch học tuần.
- Học phí, kỳ thu, thanh toán và hoàn phí.
- Báo cáo vận hành và lịch sử nghiệp vụ.
- Tài khoản, phân quyền và bảo mật truy cập.

Thông tin được liên kết xuyên suốt giữa các phân hệ, giúp giảm nhập liệu lặp lại
và giữ dữ liệu nhất quán trong quá trình vận hành.

## Tổng quan trực quan

Màn hình Tổng quan giúp người quản lý theo dõi nhanh:

- Số học viên đang học.
- Số lớp đang hoạt động và số ca trong tuần.
- Quy mô đội ngũ giảng dạy.
- Lịch học theo ngày và theo khung giờ.
- Tình hình thu học phí và dòng tiền theo kỳ.

Các thông tin quan trọng được ưu tiên theo mức độ cần thiết, giúp người dùng
nhìn thấy tình trạng trung tâm mà không phải tổng hợp thủ công.

## Quản lý học viên

TPRO Classio hỗ trợ quản lý hồ sơ học viên theo đúng nhu cầu thực tế của trung
tâm:

- Thông tin cá nhân, trường học và ngày bắt đầu.
- Thông tin liên hệ của học viên và phụ huynh.
- Một học viên có thể tham gia nhiều lớp.
- Học phí riêng khi khác với mức học phí mặc định của lớp.
- Ẩn thông tin nhạy cảm khi xem danh sách hoặc xuất dữ liệu.
- Tra cứu và lọc nhanh trong từng lớp.

Dữ liệu liên quan tới lớp đang học, học phí và thời điểm bắt đầu được đồng bộ để
hạn chế sai lệch giữa các màn hình.

## Quản lý lớp học và lịch giảng dạy

Hệ thống phù hợp với các chương trình đang được triển khai tại TPRO English:

- Chương trình tiếng Anh phổ thông từ lớp 1 đến lớp 12.
- Ôn thi vào lớp 10 và ôn thi đại học.
- Luyện thi chuyên và học sinh giỏi.
- Các chương trình IELTS.
- Lớp học theo tháng hoặc theo khóa.

Mỗi lớp có thể có nhiều giáo viên hoặc trợ giảng. Lịch học được trình bày thống
nhất trên toàn hệ thống và có kiểm tra xung đột để hỗ trợ sắp xếp lịch chính xác.

## Quản lý học phí

Học phí là một trong những phân hệ cốt lõi của TPRO Classio:

- Theo dõi kỳ học phí, ngày bắt đầu và ngày đến hạn.
- Phân biệt khoản chưa báo, đã báo và đã nộp.
- Ghi nhận thanh toán bằng tiền mặt hoặc chuyển khoản.
- Hỗ trợ học phí theo tháng, theo khóa và mức phí riêng.
- Hoàn phí một phần hoặc toàn phần khi học viên dừng học.
- Lưu lý do, phương thức và lịch sử hoàn phí.
- Tạo nội dung thông báo Zalo phù hợp với từng học viên.

Mỗi nghiệp vụ tài chính đều được lưu lại để hỗ trợ kiểm tra, đối soát và xem báo
cáo về sau.

## Báo cáo và lịch sử vận hành

Nếu trang Học phí là nơi thực hiện nghiệp vụ, trang Báo cáo là nơi xem lại chi
tiết những gì đã xảy ra.

Người dùng có thể tra cứu dữ liệu theo thời gian, học viên, lớp học và loại thao
tác. Báo cáo chỉ cung cấp quyền xem, không cho phép thay đổi lịch sử đã ghi
nhận.

## Quản lý nhân sự

Phân hệ Nhân sự tập trung thông tin cần thiết cho hoạt động giảng dạy:

- Giáo viên và trợ giảng đang hoạt động.
- Thông tin liên hệ.
- Các lớp đang phụ trách.
- Trạng thái làm việc và lịch giảng dạy liên quan.

Thông tin lớp phụ trách được đồng bộ với phân hệ Lớp học để tránh phải cập nhật
ở nhiều nơi.

## Tài khoản và phân quyền

TPRO Classio phân tách rõ phạm vi sử dụng theo từng vai trò:

| Vai trò | Phạm vi sử dụng |
| --- | --- |
| `Viewer` | Xem dữ liệu được cấp quyền, bao gồm học phí và báo cáo |
| `Admin` | Quản lý hoạt động hằng ngày của trung tâm |
| `Dev` | Quản lý hệ thống, tài khoản và phân quyền |

Tài khoản mới chỉ được tạo thông qua lời mời. Người dùng phải hoàn tất xác minh
email, liên kết danh tính Google và thiết lập mã xác thực trước khi truy cập hệ
thống.

## Trải nghiệm được thiết kế cho công việc hằng ngày

Giao diện TPRO Classio ưu tiên sự rõ ràng, nhất quán và phản hồi nhanh:

- Tìm kiếm và bộ lọc theo đúng ngữ cảnh của từng trang.
- Hiệu ứng tải riêng cho từng màn hình.
- Thông báo lỗi rõ ràng, đặt gần nội dung cần xử lý.
- Trạng thái đang lưu, đang xóa và chưa lưu dễ nhận biết.
- Hỗ trợ điều hướng bàn phím cho các luồng nhập liệu thường xuyên.
- Bảng dữ liệu giữ tiêu đề cố định và tối ưu vùng hiển thị.
- Thông báo hệ thống không che khu vực người dùng đang thao tác.
- Chuyển trang và tải dữ liệu được tối ưu để giữ trải nghiệm liền mạch.

## Bảo mật và độ tin cậy

Sản phẩm được thiết kế theo nguyên tắc bảo vệ nhiều lớp:

- Đăng ký theo lời mời, không mở tạo tài khoản công khai.
- Xác thực đa yếu tố cho quá trình đăng nhập.
- Phân quyền được kiểm tra tại máy chủ.
- Phiên đăng nhập có thể được thu hồi theo thiết bị.
- Dữ liệu nghiệp vụ không được truy cập trực tiếp từ trình duyệt.
- Thông tin nhạy cảm không được đưa vào lịch sử truy cập hoặc log hệ thống.
- Kết nối dữ liệu ở môi trường triển khai sử dụng xác minh TLS đầy đủ.
- Lịch sử tài chính được bảo vệ khỏi việc chỉnh sửa hoặc xóa tùy ý.
- Các thay đổi được kiểm tra tự động về chất lượng, bảo mật và tính toàn vẹn.

## Định hướng phát hành

TPRO Classio đang được hoàn thiện theo từng phân hệ trước khi đưa vào sử dụng
chính thức. Mỗi phiên bản phải trải qua kiểm tra chức năng, phân quyền, dữ liệu,
hiệu năng và bảo mật trên môi trường staging độc lập.

Sản phẩm chỉ được đưa lên production khi các luồng quan trọng — đăng nhập, quản lý
học viên, lớp học, học phí, hoàn phí, báo cáo và đăng xuất — đã được kiểm chứng
đầy đủ trên đúng cấu hình triển khai thực tế.

---

**TPRO English · Classio**

*Quản lý trung tâm rõ ràng hơn, vận hành nhất quán hơn.*
