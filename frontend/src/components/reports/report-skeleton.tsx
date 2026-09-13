export function ReportPageSkeleton() {
  return (
    <div
      className="flex h-full min-h-[calc(100dvh-6.5rem)] animate-pulse flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_-42px_rgba(15,23,42,0.65)] md:min-h-0"
      aria-label="Đang tải sổ thu học phí"
      role="status"
    >
      <div className="relative shrink-0 border-b border-slate-200 bg-[#fbfdff] px-6 py-4">
        <span className="absolute bottom-0 left-[13px] top-0 w-px bg-slate-200" />
        <div className="grid gap-5 pl-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(260px,0.7fr)] lg:items-end">
          <div>
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="mt-3 h-8 w-56 rounded bg-slate-200" />
            <div className="mt-3 h-3 w-72 max-w-full rounded bg-slate-100" />
          </div>
          <div>
            <div className="h-3 w-48 rounded bg-slate-100" />
            <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100" />
            <div className="mt-3 h-3 w-64 max-w-full rounded bg-slate-100" />
          </div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 2xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-h-0 overflow-hidden">
          <div className="grid h-11 grid-cols-[1.1fr_1.25fr_.78fr_.9fr_.9fr_1fr] gap-3 border-b border-slate-200 bg-slate-100 px-7">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="my-auto h-3 rounded bg-slate-200"
              />
            ))}
          </div>
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="grid min-h-[68px] grid-cols-[1.1fr_1.25fr_.78fr_.9fr_.9fr_1fr] items-center gap-3 border-b border-slate-200 px-7"
            >
              <div>
                <div className="h-4 w-32 max-w-full rounded bg-slate-200" />
                <div className="mt-2 h-2.5 w-20 rounded bg-slate-100" />
              </div>
              <div>
                <div className="h-4 w-36 max-w-full rounded bg-slate-100" />
                <div className="mt-2 h-2.5 w-24 rounded bg-slate-100" />
              </div>
              {Array.from({ length: 4 }).map((__, cellIndex) => (
                <div
                  key={cellIndex}
                  className="h-4 w-full max-w-24 rounded bg-slate-100"
                />
              ))}
            </div>
          ))}
        </div>
        <div className="hidden border-l border-slate-200 p-5 2xl:block">
          <div className="h-5 w-36 rounded bg-slate-200" />
          <div className="mt-2 h-3 w-24 rounded bg-slate-100" />
          <div className="mt-6 h-5 w-48 rounded bg-slate-200" />
          <div className="mt-3 h-28 rounded-xl bg-slate-100" />
          <div className="mt-6 h-4 w-32 rounded bg-slate-200" />
          <div className="mt-3 h-32 rounded-lg bg-slate-50" />
        </div>
      </div>
    </div>
  );
}
