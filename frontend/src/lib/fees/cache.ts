import type {
  FeeBatchActionResponse,
  FeeRecordListResponse,
  FeeRecordResponse,
} from "@/lib/types";

export function mergeFeeBatchActionResult(
  current: FeeRecordListResponse,
  result: FeeBatchActionResponse,
): FeeRecordListResponse {
  if (result.records.length === 0 && result.deleted_ids.length === 0) {
    return current;
  }

  const updatedById = new Map<string, FeeRecordResponse>(
    result.records.map((record) => [record.id, record]),
  );
  const deletedIds = new Set(result.deleted_ids);
  let changed = false;
  const records: FeeRecordResponse[] = [];

  for (const record of current.records) {
    if (deletedIds.has(record.id)) {
      changed = true;
      continue;
    }

    const updated = updatedById.get(record.id);
    if (updated) {
      records.push(updated);
      changed ||= updated !== record;
      continue;
    }

    records.push(record);
  }

  return changed ? { ...current, records } : current;
}
