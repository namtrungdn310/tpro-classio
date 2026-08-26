/**
 * VietQR-supported bank and payment-rail catalog.
 *
 * Snapshot source: https://api.vietqr.io/v2/banks (refreshed 2026-08-21).
 * The provider warns that this list can change; keep the source date visible
 * so it can be reviewed when the payment catalog is refreshed.
 */
export type VietnamBank = {
  code: string;
  name: string;
  shortName: string;
  bin: string;
  transferSupported: boolean;
  lookupSupported: boolean;
};

export const VIETNAM_BANKS: readonly VietnamBank[] = [
  { code: "ICB", name: "Ngân hàng TMCP Công thương Việt Nam", shortName: "VietinBank", bin: "970415", transferSupported: true, lookupSupported: true },
  { code: "VCB", name: "Ngân hàng TMCP Ngoại Thương Việt Nam", shortName: "Vietcombank", bin: "970436", transferSupported: true, lookupSupported: true },
  { code: "BIDV", name: "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam", shortName: "BIDV", bin: "970418", transferSupported: true, lookupSupported: true },
  { code: "VBA", name: "Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam", shortName: "Agribank", bin: "970405", transferSupported: true, lookupSupported: true },
  { code: "OCB", name: "Ngân hàng TMCP Phương Đông", shortName: "OCB", bin: "970448", transferSupported: true, lookupSupported: true },
  { code: "MB", name: "Ngân hàng TMCP Quân đội", shortName: "MBBank", bin: "970422", transferSupported: true, lookupSupported: true },
  { code: "TCB", name: "Ngân hàng TMCP Kỹ thương Việt Nam", shortName: "Techcombank", bin: "970407", transferSupported: true, lookupSupported: true },
  { code: "ACB", name: "Ngân hàng TMCP Á Châu", shortName: "ACB", bin: "970416", transferSupported: true, lookupSupported: true },
  { code: "VPB", name: "Ngân hàng TMCP Việt Nam Thịnh Vượng", shortName: "VPBank", bin: "970432", transferSupported: true, lookupSupported: true },
  { code: "TPB", name: "Ngân hàng TMCP Tiên Phong", shortName: "TPBank", bin: "970423", transferSupported: true, lookupSupported: true },
  { code: "STB", name: "Ngân hàng TMCP Sài Gòn Thương Tín", shortName: "Sacombank", bin: "970403", transferSupported: true, lookupSupported: true },
  { code: "HDB", name: "Ngân hàng TMCP Phát triển Thành phố Hồ Chí Minh", shortName: "HDBank", bin: "970437", transferSupported: true, lookupSupported: true },
  { code: "VCCB", name: "Ngân hàng TMCP Bản Việt", shortName: "VietCapitalBank", bin: "970454", transferSupported: true, lookupSupported: true },
  { code: "SCB", name: "Ngân hàng TMCP Sài Gòn", shortName: "SCB", bin: "970429", transferSupported: true, lookupSupported: true },
  { code: "VIB", name: "Ngân hàng TMCP Quốc tế Việt Nam", shortName: "VIB", bin: "970441", transferSupported: true, lookupSupported: true },
  { code: "SHB", name: "Ngân hàng TMCP Sài Gòn - Hà Nội", shortName: "SHB", bin: "970443", transferSupported: true, lookupSupported: true },
  { code: "EIB", name: "Ngân hàng TMCP Xuất Nhập khẩu Việt Nam", shortName: "Eximbank", bin: "970431", transferSupported: true, lookupSupported: true },
  { code: "MSB", name: "Ngân hàng TMCP Hàng Hải Việt Nam", shortName: "MSB", bin: "970426", transferSupported: true, lookupSupported: true },
  { code: "CAKE", name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số CAKE by VPBank", shortName: "CAKE", bin: "546034", transferSupported: true, lookupSupported: true },
  { code: "Ubank", name: "TMCP Việt Nam Thịnh Vượng - Ngân hàng số Ubank by VPBank", shortName: "Ubank", bin: "546035", transferSupported: true, lookupSupported: true },
  { code: "VTLMONEY", name: "Tổng Công ty Dịch vụ số Viettel - Chi nhánh tập đoàn công nghiệp viễn thông Quân Đội", shortName: "ViettelMoney", bin: "971005", transferSupported: false, lookupSupported: true },
  { code: "TIMO", name: "Ngân hàng số Timo by Ban Viet Bank (Timo by Ban Viet Bank)", shortName: "Timo", bin: "963388", transferSupported: true, lookupSupported: false },
  { code: "VNPTMONEY", name: "VNPT Money", shortName: "VNPTMoney", bin: "971011", transferSupported: false, lookupSupported: true },
  { code: "SGICB", name: "Ngân hàng TMCP Sài Gòn Công Thương", shortName: "SaigonBank", bin: "970400", transferSupported: true, lookupSupported: true },
  { code: "BAB", name: "Ngân hàng TMCP Bắc Á", shortName: "BacABank", bin: "970409", transferSupported: true, lookupSupported: true },
  { code: "momo", name: "CTCP Dịch Vụ Di Động Trực Tuyến", shortName: "MoMo", bin: "971025", transferSupported: true, lookupSupported: true },
  { code: "PVDB", name: "Ngân hàng TMCP Đại Chúng Việt Nam Ngân hàng số", shortName: "PVcomBank Pay", bin: "971133", transferSupported: true, lookupSupported: true },
  { code: "PVCB", name: "Ngân hàng TMCP Đại Chúng Việt Nam", shortName: "PVcomBank", bin: "970412", transferSupported: true, lookupSupported: true },
  { code: "MBV", name: "Ngân hàng TNHH MTV Việt Nam Hiện Đại", shortName: "MBV", bin: "970414", transferSupported: true, lookupSupported: true },
  { code: "NCB", name: "Ngân hàng TMCP Quốc Dân", shortName: "NCB", bin: "970419", transferSupported: true, lookupSupported: true },
  { code: "SHBVN", name: "Ngân hàng TNHH MTV Shinhan Việt Nam", shortName: "ShinhanBank", bin: "970424", transferSupported: true, lookupSupported: true },
  { code: "ABB", name: "Ngân hàng TMCP An Bình", shortName: "ABBANK", bin: "970425", transferSupported: true, lookupSupported: true },
  { code: "VAB", name: "Ngân hàng TMCP Việt Á", shortName: "VietABank", bin: "970427", transferSupported: true, lookupSupported: true },
  { code: "NAB", name: "Ngân hàng TMCP Nam Á", shortName: "NamABank", bin: "970428", transferSupported: true, lookupSupported: true },
  { code: "PGB", name: "Ngân hàng TMCP Thịnh vượng và Phát triển", shortName: "PGBank", bin: "970430", transferSupported: true, lookupSupported: true },
  { code: "VIETBANK", name: "Ngân hàng TMCP Việt Nam Thương Tín", shortName: "VietBank", bin: "970433", transferSupported: true, lookupSupported: true },
  { code: "BVB", name: "Ngân hàng TMCP Bảo Việt", shortName: "BaoVietBank", bin: "970438", transferSupported: true, lookupSupported: true },
  { code: "SEAB", name: "Ngân hàng TMCP Đông Nam Á", shortName: "SeABank", bin: "970440", transferSupported: true, lookupSupported: true },
  { code: "COOPBANK", name: "Ngân hàng Hợp tác xã Việt Nam", shortName: "COOPBANK", bin: "970446", transferSupported: true, lookupSupported: true },
  { code: "LPB", name: "Ngân hàng TMCP Lộc Phát Việt Nam", shortName: "LPBank", bin: "970449", transferSupported: true, lookupSupported: true },
  { code: "KLB", name: "Ngân hàng TMCP Kiên Long", shortName: "KienLongBank", bin: "970452", transferSupported: true, lookupSupported: true },
  { code: "KBank", name: "Ngân hàng Đại chúng TNHH Kasikornbank", shortName: "KBank", bin: "668888", transferSupported: true, lookupSupported: true },
  { code: "MAFC", name: "Công ty Tài chính TNHH MTV Mirae Asset (Việt Nam) ", shortName: "MAFC", bin: "977777", transferSupported: false, lookupSupported: false },
  { code: "HLBVN", name: "Ngân hàng TNHH MTV Hong Leong Việt Nam", shortName: "HongLeong", bin: "970442", transferSupported: false, lookupSupported: true },
  { code: "KEBHANAHN", name: "Ngân hàng KEB Hana – Chi nhánh Hà Nội", shortName: "KEBHANAHN", bin: "970467", transferSupported: false, lookupSupported: false },
  { code: "KEBHANAHCM", name: "Ngân hàng KEB Hana – Chi nhánh Thành phố Hồ Chí Minh", shortName: "KEBHanaHCM", bin: "970466", transferSupported: false, lookupSupported: false },
  { code: "CITIBANK", name: "Ngân hàng Citibank, N.A. - Chi nhánh Hà Nội", shortName: "Citibank", bin: "533948", transferSupported: false, lookupSupported: false },
  { code: "CBB", name: "Ngân hàng Thương mại TNHH MTV Xây dựng Việt Nam", shortName: "CBBank", bin: "970444", transferSupported: false, lookupSupported: true },
  { code: "CIMB", name: "Ngân hàng TNHH MTV CIMB Việt Nam", shortName: "CIMB", bin: "422589", transferSupported: true, lookupSupported: true },
  { code: "DBS", name: "DBS Bank Ltd - Chi nhánh Thành phố Hồ Chí Minh", shortName: "DBSBank", bin: "796500", transferSupported: false, lookupSupported: false },
  { code: "Vikki", name: "Ngân hàng TNHH MTV Số Vikki", shortName: "Vikki", bin: "970406", transferSupported: false, lookupSupported: true },
  { code: "VBSP", name: "Ngân hàng Chính sách Xã hội", shortName: "VBSP", bin: "999888", transferSupported: false, lookupSupported: false },
  { code: "GPB", name: "Ngân hàng Thương mại TNHH MTV Dầu Khí Toàn Cầu", shortName: "GPBank", bin: "970408", transferSupported: false, lookupSupported: true },
  { code: "KBHCM", name: "Ngân hàng Kookmin - Chi nhánh Thành phố Hồ Chí Minh", shortName: "KookminHCM", bin: "970463", transferSupported: false, lookupSupported: false },
  { code: "KBHN", name: "Ngân hàng Kookmin - Chi nhánh Hà Nội", shortName: "KookminHN", bin: "970462", transferSupported: false, lookupSupported: false },
  { code: "WVN", name: "Ngân hàng TNHH MTV Woori Việt Nam", shortName: "Woori", bin: "970457", transferSupported: true, lookupSupported: true },
  { code: "VRB", name: "Ngân hàng Liên doanh Việt - Nga", shortName: "VRB", bin: "970421", transferSupported: false, lookupSupported: true },
  { code: "HSBC", name: "Ngân hàng TNHH MTV HSBC (Việt Nam)", shortName: "HSBC", bin: "458761", transferSupported: false, lookupSupported: true },
  { code: "IBK - HN", name: "Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh Hà Nội", shortName: "IBKHN", bin: "970455", transferSupported: false, lookupSupported: false },
  { code: "IBK - HCM", name: "Ngân hàng Công nghiệp Hàn Quốc - Chi nhánh TP. Hồ Chí Minh", shortName: "IBKHCM", bin: "970456", transferSupported: false, lookupSupported: false },
  { code: "IVB", name: "Ngân hàng TNHH Indovina", shortName: "IndovinaBank", bin: "970434", transferSupported: false, lookupSupported: true },
  { code: "UOB", name: "Ngân hàng United Overseas - Chi nhánh TP. Hồ Chí Minh", shortName: "UnitedOverseas", bin: "970458", transferSupported: false, lookupSupported: true },
  { code: "NHB HN", name: "Ngân hàng Nonghyup - Chi nhánh Hà Nội", shortName: "Nonghyup", bin: "801011", transferSupported: false, lookupSupported: false },
  { code: "SCVN", name: "Ngân hàng TNHH MTV Standard Chartered Bank Việt Nam", shortName: "StandardChartered", bin: "970410", transferSupported: false, lookupSupported: true },
  { code: "PBVN", name: "Ngân hàng TNHH MTV Public Việt Nam", shortName: "PublicBank", bin: "970439", transferSupported: false, lookupSupported: true },
] as const;

/**
 * A focused, practical bank list for manual payment accounts.  It deliberately
 * excludes e-wallets, niche institutions and overseas branches so the picker
 * stays quick to scan. The full VietQR catalog remains available for matching
 * provider responses.
 */
const POPULAR_VIETNAM_BANK_CODES = new Set([
  "ICB", "VCB", "BIDV", "VBA", "MB", "TCB", "ACB", "VPB", "TPB", "STB",
  "HDB", "VIB", "SHB", "OCB", "MSB", "EIB", "LPB", "SEAB", "NAB", "ABB",
]);

export const POPULAR_VIETNAM_BANKS = VIETNAM_BANKS.filter((bank) =>
  POPULAR_VIETNAM_BANK_CODES.has(bank.code),
);

/** Official bank logos crawled from the VietQR public bank catalog. */
export function getVietnamBankLogoPath(code: string) {
  return `/bank-logos/${encodeURIComponent(code)}.png`;
}
