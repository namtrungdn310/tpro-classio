import { buildStudentFeeGroups } from "@/lib/fees/view-model";
import type {
  ClassFeeSummary,
  FeeSummaryMetrics,
  FeeTab,
  UnpaidStage,
} from "@/lib/fees/types";
import type { FeeRecordResponse } from "@/lib/types";
import { getClassSortKey } from "@/lib/utils/class-groups";
import {
  prepareSearchCorpus,
  type PreparedSearchCorpus,
} from "@/lib/utils/search";

export type IndexedFeeRecord = {
  record: FeeRecordResponse;
  searchCorpus: PreparedSearchCorpus;
};

type FeeClass = {
  id: string;
  name: string;
};

type DeriveFeeViewModelOptions = {
  activeTab: FeeTab;
  classId: string;
  indexedRecords: IndexedFeeRecord[];
  matchesFeeSearch: (corpus: PreparedSearchCorpus) => boolean;
  unpaidStage: UnpaidStage;
  classes: FeeClass[];
};

export function indexFeeRecords(records: FeeRecordResponse[]): IndexedFeeRecord[] {
  return records.map((record) => ({
    record,
    searchCorpus: prepareSearchCorpus([
      record.student_name,
      record.class_name,
      record.student_phone,
      record.student_zalo,
      record.parent_phone,
      record.parent_zalo,
      record.final_amount,
      record.refunded_amount,
      record.net_collected_amount,
    ]),
  }));
}

export function deriveFeeViewModel({
  activeTab,
  classId,
  indexedRecords,
  matchesFeeSearch,
  unpaidStage,
  classes,
}: DeriveFeeViewModelOptions) {
  const records = indexedRecords.map(({ record }) => record);
  const searchedRecords = indexedRecords
    .filter(({ searchCorpus }) => matchesFeeSearch(searchCorpus))
    .map(({ record }) => record);

  const classFilteredRecords =
    classId === ""
      ? searchedRecords
      : searchedRecords.filter((record) => record.class_id === classId);

  let total = 0;
  let grossCollected = 0;
  let netCollected = 0;
  let refunded = 0;
  let outstanding = 0;
  let unnotified = 0;
  let notified = 0;
  let paid = 0;

  for (const record of records) {
    total += record.final_amount;

    if (record.notification_state === "PAID") {
      paid += 1;
      grossCollected += record.paid_amount ?? record.final_amount;
      refunded += record.refunded_amount;
      netCollected += record.net_collected_amount;
      continue;
    }

    outstanding += record.final_amount;
    if (record.notification_state === "UNNOTIFIED") {
      unnotified += 1;
    } else {
      notified += 1;
    }
  }

  const unnotifiedRecords: FeeRecordResponse[] = [];
  const notifiedUnpaidRecords: FeeRecordResponse[] = [];
  const paidRecords: FeeRecordResponse[] = [];
  for (const record of classFilteredRecords) {
    if (record.notification_state === "PAID") {
      paidRecords.push(record);
    } else if (record.notification_state === "NOTIFIED_UNPAID") {
      notifiedUnpaidRecords.push(record);
    } else {
      unnotifiedRecords.push(record);
    }
  }

  const paidGroups = buildStudentFeeGroups(paidRecords);
  const unnotifiedGroups = buildStudentFeeGroups(unnotifiedRecords);
  const notifiedUnpaidGroups = buildStudentFeeGroups(notifiedUnpaidRecords);

  const activeGroups =
    activeTab === "paid"
      ? paidGroups
      : unpaidStage === "unnotified"
        ? unnotifiedGroups
        : notifiedUnpaidGroups;
  const visibleGroups =
    activeTab === "unpaid" && !classId
      ? [...activeGroups].sort(
          (first, second) =>
            second.total_amount - first.total_amount ||
            (first.due_date ?? "9999-12-31").localeCompare(
              second.due_date ?? "9999-12-31",
            ) ||
            first.student_name.localeCompare(second.student_name, "vi"),
        )
      : activeGroups;

  const summary: FeeSummaryMetrics = {
    total,
    grossCollected,
    netCollected,
    unnotified,
    notified,
    paid,
    refunded,
    recordCount: records.length,
    outstanding,
  };

  return {
    classFeeSummaries: buildClassFeeSummaries(records, classes),
    summary,
    visibleGroups,
  };
}

export function buildClassFeeSummaries(
  records: FeeRecordResponse[],
  classes: FeeClass[],
): ClassFeeSummary[] {
  const summaries = new Map<
    string,
    {
      id: string;
      name: string;
      totalAmount: number;
      paidStudentIds: Set<string>;
      unpaidStudentIds: Set<string>;
    }
  >();

  for (const class_ of classes) {
    summaries.set(class_.id, {
      id: class_.id,
      name: class_.name,
      paidStudentIds: new Set(),
      totalAmount: 0,
      unpaidStudentIds: new Set(),
    });
  }

  for (const record of records) {
    const current = summaries.get(record.class_id) ?? {
      id: record.class_id,
      name: record.class_name,
      paidStudentIds: new Set<string>(),
      totalAmount: 0,
      unpaidStudentIds: new Set<string>(),
    };

    current.totalAmount += record.final_amount;
    if (record.notification_state === "PAID") {
      current.paidStudentIds.add(record.student_id);
    } else {
      current.unpaidStudentIds.add(record.student_id);
    }

    summaries.set(record.class_id, current);
  }

  return Array.from(summaries.values())
    .map((summary) => ({
      id: summary.id,
      name: summary.name,
      paidStudentCount: summary.paidStudentIds.size,
      totalAmount: summary.totalAmount,
      unpaidStudentCount: summary.unpaidStudentIds.size,
    }))
    .sort((first, second) => {
      if (first.totalAmount !== second.totalAmount) {
        return second.totalAmount - first.totalAmount;
      }

      const firstKey = getClassSortKey(first.name);
      const secondKey = getClassSortKey(second.name);
      return (
        firstKey[0] - secondKey[0] ||
        firstKey[1].localeCompare(secondKey[1], "vi")
      );
    });
}
