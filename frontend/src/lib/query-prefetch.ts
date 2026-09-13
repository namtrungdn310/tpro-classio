import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getUsers } from "@/lib/api/auth";
import { authQueryKeys } from "@/lib/auth/query-keys";
import { getClasses, getClassScopeSummary, getEffectiveOccurrences } from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { getDashboardOverview } from "@/lib/api/dashboard";
import { getFeeMessageTemplates, getFeePeriods, getFeeRecords } from "@/lib/api/fees";
import { getActiveStaffOptions, getStaffMembers } from "@/lib/api/staff";
import { staffQueryKeys } from "@/lib/staff/query-keys";
import { getFeePaidReceipts } from "@/lib/api/reports";
import { getBankingOverview } from "@/lib/api/banking";
import type { FeePaidReceiptListResponse, StudentListPageResponse } from "@/lib/types";
import { getStudentScopeSummary, getStudentsPage } from "@/lib/api/students";
import { studentQueryKeys, type StudentListFilters } from "@/lib/students/query-keys";

const ROOT_STALE_MS: Record<string, number> = {
  "auth-users": 2 * 60 * 1000,
  classes: 10 * 60 * 1000,
  dashboard: 60 * 1000,
  fees: 2 * 60 * 1000,
  "fee-message-templates": 5 * 60 * 1000,
  reports: 2 * 60 * 1000,
  staff: 10 * 60 * 1000,
  students: 5 * 60 * 1000,
  "banking-overview": 60 * 1000,
};

type PrefetchContext = {
  isAdmin?: boolean;
  isOwner?: boolean;
  selectedStudentClassId?: string;
};

function getCurrentPeriod() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : new Date().toISOString().slice(0, 7);
}

function getCurrentWeekRange() {
  const now = new Date();
  const start = new Date(now);
  const day = (now.getDay() + 6) % 7;
  start.setDate(now.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const localDate = (value: Date) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return { from: localDate(start), to: localDate(end) };
}

function prefetchStudentList(
  queryClient: QueryClient,
  filters: StudentListFilters,
) {
  return queryClient.prefetchInfiniteQuery({
    queryKey: studentQueryKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      getStudentsPage({ ...filters, cursor: pageParam as string | undefined }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: StudentListPageResponse) =>
      page.has_more ? page.next_cursor ?? undefined : undefined,
    staleTime: ROOT_STALE_MS.students,
  });
}

async function prefetchIfStale<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  queryFn: () => Promise<T>,
) {
  const rootKey = typeof queryKey[0] === "string" ? queryKey[0] : "";
  const staleTime = ROOT_STALE_MS[rootKey] ?? 5 * 60 * 1000;
  const state = queryClient.getQueryState(queryKey);
  const isFresh =
    typeof state?.dataUpdatedAt === "number" &&
    Date.now() - state.dataUpdatedAt < staleTime;

  if (isFresh) {
    return;
  }

  await queryClient.prefetchQuery({
    queryKey,
    queryFn,
    staleTime,
  });
}

export async function prefetchRouteData(
  queryClient: QueryClient,
  href: string,
  context: PrefetchContext = {},
) {
  const period = getCurrentPeriod();
  const tasks: Array<() => Promise<unknown>> = [];

  switch (href) {
    case "/": {
      const week = getCurrentWeekRange();
      tasks.push(
        () => prefetchIfStale(queryClient, ["dashboard", "overview"], getDashboardOverview),
        () =>
          prefetchIfStale(queryClient, classQueryKeys.list("active"), () =>
            getClasses({ scope: "active" }),
          ),
        () =>
          prefetchIfStale(
            queryClient,
            classQueryKeys.effectiveOccurrences(week.from, week.to),
            () => getEffectiveOccurrences(week.from, week.to),
          ),
      );
      break;
    }
    case "/students":
      tasks.push(
        () =>
          prefetchIfStale(queryClient, classQueryKeys.list("enrollable"), () =>
            getClasses({ scope: "enrollable" }),
          ),
        () =>
          prefetchIfStale(
            queryClient,
            studentQueryKeys.summary(),
            getStudentScopeSummary,
          ),
      );
      if (context.selectedStudentClassId) {
        const filters: StudentListFilters = {
          class_id: context.selectedStudentClassId,
          status: "active",
          limit: 80,
        };
        tasks.push(() => prefetchStudentList(queryClient, filters));
      }
      break;
    case "/classes":
      tasks.push(() =>
        prefetchIfStale(queryClient, classQueryKeys.list("operational"), () =>
          getClasses({ scope: "operational" }),
        ),
      );
      tasks.push(() =>
        prefetchIfStale(queryClient, classQueryKeys.summary(), getClassScopeSummary),
      );
      if (context.isAdmin) {
        tasks.push(() =>
          prefetchIfStale(queryClient, staffQueryKeys.staffOptions, () =>
            getActiveStaffOptions(),
          ),
        );
      }
      break;
    case "/fees":
      tasks.push(
        () =>
          prefetchIfStale(queryClient, classQueryKeys.list("active"), () =>
            getClasses({ scope: "active" }),
          ),
        () =>
          prefetchIfStale(queryClient, ["fees", { period }], () =>
            getFeeRecords({ period }),
          ),
        () => prefetchIfStale(queryClient, ["fee-periods"], getFeePeriods),
      );
      if (context.isAdmin) {
        tasks.push(() =>
          prefetchIfStale(
            queryClient,
            ["fee-message-templates"],
            getFeeMessageTemplates,
          ),
        );
      }
      break;
    case "/staff":
      tasks.push(() =>
        prefetchIfStale(queryClient, staffQueryKeys.list, () =>
          getStaffMembers({ is_active: null }),
        ),
      );
      break;
    case "/report": {
      const filters = {
        period: "",
        q: "",
        date_from: undefined,
        date_to: undefined,
        payment_method: "" as const,
        refund_state: "" as const,
        limit: 30,
      };
      tasks.push(() =>
        queryClient.prefetchInfiniteQuery({
          queryKey: ["reports", "fee-paid", filters],
          queryFn: ({ pageParam, signal }) =>
            getFeePaidReceipts(
              { ...filters, cursor: pageParam as string },
              signal,
            ),
          initialPageParam: "",
          getNextPageParam: (lastPage: FeePaidReceiptListResponse) =>
            lastPage.next_cursor ?? undefined,
          staleTime: ROOT_STALE_MS.reports,
        }),
      );
      break;
    }
    case "/settings":
      if (context.isOwner) {
        tasks.push(() => prefetchIfStale(queryClient, authQueryKeys.users, getUsers));
      }
      break;
    case "/banking":
      if (context.isAdmin) {
        tasks.push(() =>
          prefetchIfStale(queryClient, ["banking-overview"], getBankingOverview),
        );
      }
      break;
    default:
      break;
  }

  await Promise.allSettled(tasks.map((task) => task()));
}
