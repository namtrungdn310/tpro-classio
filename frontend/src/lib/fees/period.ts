export function getCurrentFeePeriod() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;

  return year && month
    ? `${year}-${month}`
    : new Date().toISOString().slice(0, 7);
}

export function getAscendingFeeYears(years: Iterable<number>) {
  return Array.from(years).sort((first, second) => first - second);
}

const FEE_PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function changeFeePeriodYear(
  selectedPeriod: string,
  requestedYear: string,
  currentPeriod = getCurrentFeePeriod(),
) {
  const current = parseCurrentFeePeriod(currentPeriod);
  const selected = parseFeePeriod(selectedPeriod) ?? current;
  const requestedYearNumber = parseFeeYear(requestedYear) ?? current.year;
  const latestMonth =
    requestedYearNumber === current.year ? current.month : 12;
  const nextMonth = Math.min(selected.month, latestMonth);

  return formatFeePeriod(requestedYearNumber, nextMonth);
}

export function changeFeePeriodMonth(
  selectedPeriod: string,
  requestedMonth: string,
  currentPeriod = getCurrentFeePeriod(),
) {
  const current = parseCurrentFeePeriod(currentPeriod);
  const selected = parseFeePeriod(selectedPeriod) ?? current;
  const requestedMonthNumber = parseFeeMonth(requestedMonth) ?? current.month;
  const latestMonth = selected.year === current.year ? current.month : 12;

  return formatFeePeriod(
    selected.year,
    Math.min(requestedMonthNumber, latestMonth),
  );
}

export function getFeeMonthLimit(
  selectedYear: string,
  currentPeriod = getCurrentFeePeriod(),
) {
  const current = parseCurrentFeePeriod(currentPeriod);
  return parseFeeYear(selectedYear) === current.year ? current.month : 12;
}

function parseFeePeriod(period: string) {
  const match = FEE_PERIOD_PATTERN.exec(period);
  if (!match) return null;

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

function parseCurrentFeePeriod(period: string) {
  return (
    parseFeePeriod(period) ??
    parseFeePeriod(getCurrentFeePeriod()) ?? {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
    }
  );
}

function parseFeeYear(year: string) {
  return /^\d{4}$/.test(year) ? Number(year) : null;
}

function parseFeeMonth(month: string) {
  return /^(?:0?[1-9]|1[0-2])$/.test(month) ? Number(month) : null;
}

function formatFeePeriod(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}`;
}
