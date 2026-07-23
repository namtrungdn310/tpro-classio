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
      className="dashboard-metric-enter relative flex min-h-[112px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-gray-200/90 bg-white p-3 shadow-[0_8px_30px_rgba(15,23,42,0.045)]"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-4 top-0 h-px bg-[#1967D2]"
      />

      <h2 className="table-heading-text truncate text-gray-500">{label}</h2>

      <div className="mt-auto min-w-0 pt-3">
        <p
          className="metric-value truncate text-[32px] font-semibold leading-none text-gray-950"
          title={value}
        >
          {value}
        </p>
        <p
          className="mt-2 line-clamp-2 min-h-4 text-[11px] font-medium leading-4 text-gray-500"
          title={hint}
        >
          {hint}
        </p>
      </div>
    </article>
  );
}
