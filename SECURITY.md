# Security policy

## Supported versions

TPRO Classio chưa có bản production ổn định. Chỉ revision mới nhất trên các
branch đang được duy trì mới nhận bản vá bảo mật.

## Báo cáo lỗ hổng

Không tạo public issue chứa lỗ hổng, thông tin người dùng, token, log nhạy cảm
hoặc hướng dẫn khai thác. Hãy dùng **GitHub Security Advisories → Report a
vulnerability** của repository. Nếu repository chưa hiển thị nút báo cáo riêng
tư, hãy liên hệ riêng với chủ repository qua hồ sơ GitHub và chỉ gửi chi tiết
sau khi đã thống nhất một kênh bảo mật; không chuyển sang public issue. Báo cáo
nên bao gồm:

- phiên bản/commit bị ảnh hưởng;
- điều kiện và bước tái hiện tối thiểu;
- tác động dự kiến;
- log hoặc ảnh đã che toàn bộ credential và dữ liệu cá nhân;
- đề xuất giảm thiểu nếu có.

Không truy cập, thay đổi hoặc tải dữ liệu không thuộc quyền của mình trong quá
trình kiểm tra.

## Xử lý secret bị lộ

Xóa chuỗi khỏi commit mới là chưa đủ vì nó còn trong Git history. Khi nghi ngờ
credential đã xuất hiện trong repository hoặc log:

1. Thu hồi/rotate credential ngay tại nhà cung cấp.
2. Thu hồi session/token liên quan.
3. Kiểm tra audit log để xác định phạm vi sử dụng.
4. Xóa credential khỏi repository và history theo quy trình đã thống nhất.
5. Quét lại toàn bộ history và xác minh ứng dụng dùng credential mới.
6. Ghi nhận sự cố mà không sao chép secret vào ticket/chat.

## Nguyên tắc phát hành

- Không merge khi CI hoặc security verifier thất bại.
- Không phát hành migration khi chưa có backup đã kiểm tra khôi phục.
- Không dùng dữ liệu production cho local hoặc staging.
- Không lưu `.env`, database dump, private key, service-role key hay OAuth
  client secret trong GitHub Actions artifact.
- Mọi ngoại lệ cho cảnh báo bảo mật phải có chủ sở hữu, lý do, biện pháp giảm
  thiểu và ngày xem xét lại.
