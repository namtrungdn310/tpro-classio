import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { getUsers } from "@/lib/api/auth";
import { authQueryKeys } from "@/lib/auth/query-keys";
import { getClasses, getClassScopeSummary } from "@/lib/api/classes";
import { classQueryKeys } from "@/lib/classes/query-keys";
import { getDashboardOverview } from "@/lib/api/dashboard";
import { getFeeMessageTemplates, getFeeRecords } from "@/lib/api/fees";
import { getActiveTeacherOptions, getStaffMembers } from "@/lib/api/staff";
import { staffQueryKeys } from "@/lib/staff/query-keys";
import { getStudents } from "@/lib/api/students";
import { getFeePaidReceipts } from "@/lib/api/reports";
import type { FeePaidReceiptListResponse } from "@/lib/types";

const ROOT_STALE_MS: Record<string, number> = {
  "auth-users": 2 * 60 * 1000,
  classes: 10 * 60 * 1000,
  dashboard: 30 * 1000,
  fees: 60 * 1000,
  "fee-message-templates": 5 * 60 * 1000,
  reports: 30 * 1000,
  staff: 10 * 60 * 1000,
  students: 3 * 60 * 1000,
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
    case "/":
      tasks.push(
        () => prefetchIfStale(queryClient, ["dashboard", "overview"], getDashboardOverview),
        () =>
          prefetchIfStale(queryClient, classQueryKeys.list("active"), () =>
            getClasses({ scope: "active" }),
          ),
      );
      break;
    case "/students":
      tasks.push(() =>
        prefetchIfStale(queryClient, classQueryKeys.list("enrollable"), () =>
          getClasses({ scope: "enrollable" }),
        ),
      );
      if (context.selectedStudentClassId) {
        const filters = { class_id: context.selectedStudentClassId, status: "active" as const };
        tasks.push(() =>
          prefetchIfStale(queryClient, ["students", filters], () => getStudents(filters)),
        );
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
          prefetchIfStale(queryClient, staffQueryKeys.teacherOptions, () =>
            getActiveTeacherOptions(),
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
    default:
      break;
  }

  await Promise.allSettled(tasks.map((task) => task()));
}
