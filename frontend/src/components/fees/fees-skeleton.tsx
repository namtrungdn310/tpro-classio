import { getFeesTableGridClass } from "@/components/fees/table-layout";

export function FeesPageSkeleton({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  return (
    <>
      <div
        aria-label="Đang tải tổng hợp học phí"
        className="grid animate-pulse gap-3 xl:grid-cols-[340px_1fr] xl:gap-4"
      >
        <div className="flex h-[209px] flex-col gap-2">
          <div className="flex flex-1 flex-col justify-between rounded-md border border-gray-200 bg-white px-4 py-3">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="h-6 w-56 max-w-full rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
          <div className="grid grid-cols-3 gap-2 px-1">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-11 rounded-md bg-gray-100" />
            ))}
          </div>
        </div>
        <div className="h-[209px] overflow-hidden rounded-md border border-gray-200 bg-white">
          <div className="flex h-9 items-center justify-between border-b border-gray-200 bg-gray-50/50 px-3">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-7 rounded bg-gray-100" />
              <div className="h-7 w-7 rounded-md bg-gray-100" />
              <div className="h-7 w-7 rounded-md bg-gray-100" />
            </div>
          </div>
          <div className="grid h-[172px] grid-flow-col grid-cols-4 grid-rows-3 gap-1.5 overflow-hidden p-2">
            {Array.from({ length: 12 }).map((_, index) => (
              <div key={index} className="h-12 rounded bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
      <div className="min-h-0 md:flex-1 md:overflow-hidden">
        <FeesSkeleton isAdmin={isAdmin} />
      </div>
    </>
  );
}

function FeesSkeleton({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const gridClass = getFeesTableGridClass({ isAdmin });
  const columnCount = isAdmin ? 8 : 7;

  return (
    <div className="h-full animate-pulse">
      <div className="scrollbar-hidden grid gap-3 md:h-full md:overflow-y-auto md:overscroll-contain xl:hidden">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-md border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-36 max-w-full rounded bg-gray-200" />
                <div className="h-3 w-52 max-w-full rounded bg-gray-100" />
                <div className="h-3 w-28 rounded bg-gray-100" />
              </div>
              <div className="h-7 w-24 rounded-full bg-gray-100" />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="h-9 rounded bg-gray-100" />
              <div className="h-9 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>

      <div className="hidden h-full min-h-0 flex-col overflow-hidden rounded-lg border border-gray-200 xl:flex">
        <div className="shrink-0 border-b border-gray-200 bg-gray-50">
          <div className={`${gridClass} items-center`}>
            {[96, 120, 86, 82, 78, 72, 80, 72]
              .slice(0, columnCount)
              .map((width, index) => (
                <div
                  key={index}
                  className={
                    isAdmin && index === 7 ? "px-2 py-3" : "px-2.5 py-3"
                  }
                >
                  <div
                    className="h-3 rounded bg-gray-200"
                    style={{ width, maxWidth: "100%" }}
                  />
                </div>
              ))}
          </div>
        </div>
        <div className="scrollbar-hidden min-h-0 flex-1 overflow-hidden bg-white">
          {Array.from({ length: 8 }).map((_, rowIndex) => (
            <div
              key={rowIndex}
              className={`${gridClass} cv-auto items-center border-b border-gray-100`}
            >
              {[96, 118, 86, 78, 74, 70, 82, 68].map((width, cellIndex) =>
                cellIndex < columnCount ? (
                  <div
                    key={cellIndex}
                    className={
                      isAdmin && cellIndex === 7
                        ? "px-2 py-3"
                        : "px-2.5 py-3"
                    }
                  >
                    <div
                      className="h-4 rounded bg-gray-100"
                      style={{
                        width: width + (rowIndex % 2) * 8,
                        maxWidth: "100%",
                      }}
                    />
                  </div>
                ) : null,
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
