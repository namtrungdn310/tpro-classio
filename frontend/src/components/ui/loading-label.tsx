type LoadingLabelProps = {
  idleLabel?: string;
  isLoading?: boolean;
  label: string;
};

export function LoadingLabel({
  idleLabel,
  isLoading = true,
  label,
}: LoadingLabelProps) {
  if (idleLabel !== undefined) {
    return (
      <span className="grid place-items-center whitespace-nowrap">
        <span
          aria-hidden={isLoading || undefined}
          className={`col-start-1 row-start-1 ${isLoading ? "invisible" : ""}`}
        >
          {idleLabel}
        </span>
        <LoadingState label={label} hidden={!isLoading} />
      </span>
    );
  }

  return <LoadingState label={label} />;
}

function LoadingState({
  label,
  hidden = false,
}: {
  label: string;
  hidden?: boolean;
}) {
  return (
    <span
      className={`loading-label col-start-1 row-start-1 ${hidden ? "invisible" : ""}`}
      role={hidden ? undefined : "status"}
      aria-live={hidden ? undefined : "polite"}
      aria-hidden={hidden || undefined}
    >
      <span>{label}</span>
      <span className="loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
