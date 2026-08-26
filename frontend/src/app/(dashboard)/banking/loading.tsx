export default function BankingLoading() {
  return (
    <div
      aria-label="Đang tải ngân hàng"
      aria-busy="true"
      className="scrollbar-hidden h-full min-h-0 animate-pulse overflow-hidden"
    >
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div>
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="mt-2 h-7 w-36 rounded bg-gray-200" />
            <div className="mt-2 h-4 w-80 max-w-full rounded bg-gray-100" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-24 rounded-md bg-gray-100" />
            <div className="h-9 w-32 rounded-md bg-gray-200" />
          </div>
        </div>
        <div className="h-12 shrink-0 rounded-lg border border-gray-200 bg-white p-2">
          <div className="h-full w-56 rounded-md bg-gray-100" />
        </div>
        <div className="min-h-0 flex-1 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="h-5 w-44 rounded bg-gray-200" />
            <div className="h-8 w-48 rounded-md bg-gray-100" />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-24 rounded-lg bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
