type DashboardMetricCardProps = {
  delayMs?: number;
  hint: string;
  label: string;
  value: string;
};

export function DashboardMetricCard({
  delayMs = 0,
  hint,
  label,
  value,
}: DashboardMetricCardProps) {
  return (
    <article
      className="dashboard-metric-enter relative flex min-h-[82px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-slate-300 bg-white px-3 py-2 shadow-[0_2px_14px_rgba(15,23,42,0.06)]"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-3 top-0 h-[2px] rounded-b-full bg-primary"
      />

      <h2 className="table-heading-text truncate text-slate-600">{label}</h2>

      <div className="mt-auto min-w-0 pt-1.5">
        <p
          className="metric-value truncate text-[17px] font-semibold leading-none text-gray-950"
          title={value}
        >
          {value}
        </p>
        <p
          className="mt-0.5 truncate text-[12px] font-medium leading-4 text-slate-600"
          title={hint}
        >
          {hint}
        </p>
      </div>
    </article>
  );
}
