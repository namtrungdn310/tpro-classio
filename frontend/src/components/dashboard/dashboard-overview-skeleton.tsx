import { WeeklyScheduleBoardSkeleton } from "@/components/layout/weekly-schedule-board";

export function DashboardOverviewSkeleton() {
  return (
    <div className="dashboard-overview-no-selection grid h-full min-h-0 gap-3 overflow-hidden xl:grid-cols-[minmax(430px,0.82fr)_minmax(0,1.85fr)] 2xl:grid-cols-[500px_minmax(0,1fr)]">
      <DashboardMetricsSkeleton />
      <section className="min-h-0">
        <WeeklyScheduleBoardSkeleton
          className="h-full min-h-0"
          detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_150px]"
        />
      </section>
    </div>
  );
}

export function DashboardMetricsSkeleton() {
  return (
    <section className="flex shrink-0 animate-pulse flex-col gap-3 motion-reduce:animate-none xl:h-full xl:min-h-0">
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="flex min-h-[112px] flex-col rounded-[18px] border border-gray-200 bg-white p-3"
          >
            <div className="h-3 w-16 rounded-full bg-gray-200" />
            <div className="mt-auto pt-3">
              <div className="h-8 w-12 rounded-md bg-gray-200" />
              <div className="mt-2 h-2.5 w-16 rounded-full bg-gray-100" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex min-h-[390px] flex-1 flex-col rounded-[22px] border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="h-3 w-28 rounded-full bg-gray-200" />
          <div className="h-3 w-24 rounded-full bg-gray-100" />
        </div>

        <div className="mt-2.5 grid grid-cols-[minmax(0,1fr)_132px] items-center gap-3">
          <div>
            <div className="h-3 w-20 rounded-full bg-gray-100" />
            <div className="mt-2 h-7 w-40 max-w-full rounded-md bg-gray-200" />
            <div className="mt-2 h-3 w-28 rounded-full bg-gray-100" />
          </div>
          <div className="grid size-[132px] place-items-center rounded-full border-[9px] border-gray-100">
            <div className="h-5 w-10 rounded-md bg-blue-100" />
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-3 border-y border-gray-100 py-2.5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index}>
              <div className="flex items-center gap-1.5">
                <div className="h-1 w-3 rounded-full bg-gray-200" />
                <div className="h-3 w-12 rounded-full bg-gray-100" />
              </div>
              <div className="mt-1 h-4 w-20 max-w-full rounded bg-gray-200" />
            </div>
          ))}
        </div>

        <div className="mt-3 flex min-h-[148px] flex-1 flex-col border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="h-3 w-28 rounded-full bg-gray-200" />
            <div className="h-3 w-24 rounded-full bg-gray-100" />
          </div>
          <div className="relative mt-2 min-h-[108px] flex-1 overflow-hidden">
            <div className="absolute inset-x-0 bottom-6 h-px bg-gray-100" />
            <div className="absolute inset-x-2 bottom-9 top-4">
              <div className="absolute left-[2%] top-[72%] h-1.5 w-[18%] origin-left -rotate-[8deg] rounded-full bg-gray-100" />
              <div className="absolute left-[19%] top-[65%] h-1.5 w-[20%] origin-left -rotate-[15deg] rounded-full bg-gray-100" />
              <div className="absolute left-[38%] top-[48%] h-1.5 w-[20%] origin-left rotate-[7deg] rounded-full bg-gray-100" />
              <div className="absolute left-[57%] top-[53%] h-1.5 w-[20%] origin-left -rotate-[18deg] rounded-full bg-gray-100" />
              <div className="absolute left-[76%] top-[31%] h-1.5 w-[20%] origin-left -rotate-[10deg] rounded-full bg-gray-100" />
              {[72, 65, 48, 53, 31, 20].map((top, index) => (
                <div
                  key={index}
                  className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-200 ring-2 ring-white"
                  style={{ left: `${2 + index * 19}%`, top: `${top}%` }}
                />
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-0 grid grid-cols-6 place-items-center">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-2.5 w-8 rounded-full bg-gray-100" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
