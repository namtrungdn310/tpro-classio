export function ReportPageSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 animate-pulse flex-col gap-3"
      aria-label="Đang tải báo cáo hoạt động học phí"
    >
      <div className="grid shrink-0 grid-cols-3 gap-3">
        {["w-20", "w-24", "w-28"].map((width) => (
          <div key={width} className="h-[82px] rounded-lg border border-gray-200 bg-white p-4">
            <div className={`h-3 ${width} rounded bg-gray-200`} />
            <div className="mt-4 h-5 w-28 rounded bg-gray-100" />
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(360px,0.84fr)_minmax(0,1.4fr)]">
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="h-12 border-b border-gray-200 bg-gray-50/60" />
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="border-b border-gray-100 px-4 py-3.5">
              <div className="flex justify-between gap-4">
                <div className="h-4 w-40 rounded bg-gray-100" />
                <div className="h-3 w-16 rounded bg-gray-100" />
              </div>
              <div className="mt-2 h-3 w-56 max-w-full rounded bg-gray-100" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="h-5 w-52 rounded bg-gray-200" />
          <div className="mt-3 h-3 w-72 max-w-full rounded bg-gray-100" />
          <div className="mt-6 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-16 rounded-md bg-gray-100" />
            ))}
          </div>
          <div className="mt-6 h-40 rounded-md bg-gray-50" />
        </div>
      </div>
    </div>
  );
}

