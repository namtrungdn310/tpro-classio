import { WeeklyScheduleBoardSkeleton } from "@/components/layout/weekly-schedule-board";

export function DashboardOverviewSkeleton() {
  return (
    <div className="dashboard-overview-no-selection flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <DashboardMetricsSkeleton />
      <section className="flex min-h-0 flex-1 flex-col gap-2.5">
        <div className="flex items-center justify-between px-0.5">
          <div className="h-4 w-32 rounded-full bg-gray-200" />
          <div className="h-4 w-16 rounded-full bg-gray-100" />
        </div>
        <div className="min-h-0 flex-1">
          <WeeklyScheduleBoardSkeleton
            className="h-full min-h-0"
            detailWidthClassName="lg:grid-cols-[minmax(0,1fr)_220px]"
          />
        </div>
      </section>
    </div>
  );
}

export function DashboardMetricsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(300px,0.35fr)_minmax(0,0.65fr)]">
      <div className="grid auto-rows-fr grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex min-h-[82px] flex-col rounded-[18px] border border-primary/10 bg-white px-3 py-2"
          >
            <div className="h-3 w-16 rounded-full bg-gray-200" />
            <div className="mt-auto pt-1.5">
              <div className="h-5 w-12 rounded-md bg-gray-200" />
              <div className="mt-1 h-2.5 w-16 rounded-full bg-gray-100" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex min-h-[160px] flex-col rounded-[22px] border border-gray-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="h-3 w-28 rounded-full bg-gray-200" />
          <div className="h-3 w-24 rounded-full bg-gray-100" />
        </div>

        <div className="mt-3 flex items-center gap-4">
          <div className="h-7 w-14 shrink-0 rounded-md bg-gray-200" />
          <div className="min-w-0 flex-1">
            <div className="flex items-end gap-[2px]">
              {Array.from({ length: 44 }).map((_, index) => (
                <span
                  key={index}
                  className="min-w-0 flex-1 aspect-square bg-gray-200"
                />
              ))}
            </div>
            <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-gray-100">
              <div className="h-full w-1/2 rounded-full bg-gray-300" />
            </div>
            <div className="mt-1.5 h-3 w-32 rounded-full bg-gray-100" />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-6">
          <div>
            <div className="h-3 w-20 rounded-full bg-gray-100" />
            <div className="mt-1.5 h-5 w-28 max-w-full rounded-md bg-gray-200" />
          </div>
          <div>
            <div className="h-3 w-16 rounded-full bg-gray-100" />
            <div className="mt-1.5 h-5 w-24 max-w-full rounded-md bg-gray-200" />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-5 border-t border-gray-100 pt-2">
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
      </div>
    </div>
  );
}
