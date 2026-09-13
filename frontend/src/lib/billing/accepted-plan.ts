/** One accepted intent survives network failure; an edited draft is a new intent. */
export type AcceptedPlan<D, P> = {
  draftKey: string;
  draft: D;
  preview: P;
  requestId: string;
};

export function acceptPlan<D, P>(draft: D, preview: P, requestId: string): AcceptedPlan<D, P> {
  return { draftKey: JSON.stringify(draft), draft, preview, requestId };
}

export function matchesAcceptedPlan<D, P>(accepted: AcceptedPlan<D, P> | null, draft: D): accepted is AcceptedPlan<D, P> {
  return accepted !== null && accepted.draftKey === JSON.stringify(draft);
}

/** Unknown outcome must be retried verbatim, not converted into a new intent. */
export function isUncertainBillingOutcome(error: unknown): boolean {
  const response = (error as { response?: { status?: number; data?: { detail?: { code?: string } } } } | null)?.response;
  if (!response?.status || response.status >= 500) return true;
  return response.data?.detail?.code === "BILLING_COMMAND_IN_PROGRESS" || response.data?.detail?.code === "ADMISSION_COMMAND_IN_PROGRESS";
}
