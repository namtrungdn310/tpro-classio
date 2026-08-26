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
        className="grid grid-cols-1 gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 motion-safe:animate-pulse md:grid-cols-2 md:gap-x-5 md:gap-y-3 lg:grid-cols-12 lg:items-center lg:gap-0 xl:rounded-b-none"
      >
        <div className="min-w-0 space-y-2 md:col-span-1 lg:col-span-4 lg:pr-5">
          <div className="flex justify-between gap-3">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
          <div className="h-6 w-52 max-w-full rounded bg-gray-200" />
          <div className="h-3 w-48 max-w-full rounded bg-gray-100" />
          <div className="h-1 w-full rounded-full bg-gray-100" />
        </div>
        <div className="order-3 grid grid-cols-3 gap-1 rounded-lg bg-gray-50 p-1 md:col-span-2 lg:order-none lg:col-span-5 lg:mx-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-11 rounded-md bg-gray-100 md:h-9" />
          ))}
        </div>
        <div className="space-y-2 md:col-span-1 lg:col-span-3 lg:border-l lg:border-gray-200 lg:pl-5">
          <div className="h-3 w-16 rounded bg-gray-200" />
          <div className="h-11 rounded-md bg-gray-100 md:h-8" />
        </div>
      </div>
      <div className="min-h-0 md:flex-1 md:overflow-hidden xl:-mt-3">
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
  const columnCount = 7;

  return (
    <div className="h-full motion-safe:animate-pulse">
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

      <div className="hidden h-full min-h-0 flex-col overflow-hidden rounded-b-xl border border-t-0 border-gray-200 xl:flex">
        <div className="shrink-0 border-b border-gray-200 bg-gray-100">
          <div className={`${gridClass} items-center`}>
            {[96, 120, 86, 82, 78, 72, 80]
              .slice(0, columnCount)
              .map((width, index) => (
                <div
                  key={index}
                  className="px-2.5 py-3"
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
              {[96, 118, 86, 78, 74, 70, 82].map((width, cellIndex) =>
                cellIndex < columnCount ? (
                  <div
                    key={cellIndex}
                    className="px-2.5 py-3"
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
