import type {
  FeeTransactionBatchResponse,
  FeeTransactionListResponse,
} from "@/lib/types";

export function verifyFeeTransactionHistory(
  response: FeeTransactionListResponse,
  requestedRecordId: string,
) {
  if (normalizeId(response.fee_record_id) !== normalizeId(requestedRecordId)) {
    throw new Error("Lịch sử giao dịch không khớp với khoản học phí đã yêu cầu.");
  }
  return response;
}

export function verifyFeeTransactionBatch(
  response: FeeTransactionBatchResponse,
  requestedRecordIds: string[],
) {
  const expected = new Set(requestedRecordIds.map(normalizeId));
  if (expected.size !== requestedRecordIds.length) {
    throw new Error("Danh sách khoản học phí xuất giao dịch bị trùng lặp.");
  }

  const actual = new Set<string>();
  for (const history of response.histories) {
    const recordId = normalizeId(history.fee_record_id);
    if (!expected.has(recordId) || actual.has(recordId)) {
      throw new Error("Dữ liệu lịch sử giao dịch trả về không hợp lệ.");
    }
    actual.add(recordId);
  }

  if (actual.size !== expected.size) {
    throw new Error("Dữ liệu lịch sử giao dịch trả về chưa đầy đủ.");
  }
  return response;
}

function normalizeId(value: string) {
  return value.toLowerCase();
}
