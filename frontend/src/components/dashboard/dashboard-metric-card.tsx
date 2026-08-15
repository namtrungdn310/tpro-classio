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
      className="dashboard-metric-enter relative flex min-h-[82px] min-w-0 flex-col overflow-hidden rounded-[18px] border border-primary/10 bg-white px-3 py-2 shadow-[0_2px_14px_rgba(0,39,135,0.05)]"
      style={{ animationDelay: `${delayMs}ms` }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-3 top-0 h-[2px] rounded-b-full bg-primary"
      />

      <h2 className="table-heading-text truncate text-gray-500">{label}</h2>

      <div className="mt-auto min-w-0 pt-1.5">
        <p
          className="metric-value truncate text-[17px] font-semibold leading-none text-gray-950"
          title={value}
        >
          {value}
        </p>
        <p
          className="mt-0.5 truncate text-[11px] font-medium leading-4 text-gray-500"
          title={hint}
        >
          {hint}
        </p>
      </div>
    </article>
  );
}
