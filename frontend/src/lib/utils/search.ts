function normalizeSearchText(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSearchDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export type PreparedSearchCorpus = {
  compact: string;
  digits: string;
  normalized: string;
};

export function prepareSearchCorpus(
  values: Array<string | number | null | undefined>,
): PreparedSearchCorpus {
  const joined = values
    .map((value) => (value === null || value === undefined ? "" : String(value)))
    .filter(Boolean)
    .join(" ");
  const normalized = normalizeSearchText(joined);

  return {
    compact: normalized.replace(/\s/g, ""),
    digits: normalizeSearchDigits(joined),
    normalized,
  };
}

export function createPreparedSearchMatcher(query: string | null | undefined) {
  const normalizedQuery = normalizeSearchText(query);
  const queryDigits = normalizeSearchDigits(query);
  if (!normalizedQuery && !queryDigits) {
    return () => true;
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const compactQuery = normalizedQuery.replace(/\s/g, "");

  return (corpus: PreparedSearchCorpus) => {
    if (queryDigits && corpus.digits.includes(queryDigits)) {
      return true;
    }
    if (normalizedQuery && corpus.normalized.includes(normalizedQuery)) {
      return true;
    }
    if (compactQuery && corpus.compact.includes(compactQuery)) {
      return true;
    }
    if (queryTokens.length > 0 && queryTokens.every((token) => corpus.normalized.includes(token))) {
      return true;
    }

    return false;
  };
}

export function createSmartSearchMatcher(query: string | null | undefined) {
  const matchesPrepared = createPreparedSearchMatcher(query);

  return (values: Array<string | number | null | undefined>) =>
    matchesPrepared(prepareSearchCorpus(values));
}


