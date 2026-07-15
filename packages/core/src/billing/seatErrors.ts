export interface ClassifiedSeatError {
  error: string;
  redirectUrl: string | null;
}

export function classifySeatError(error: unknown): ClassifiedSeatError {
  if (!(error instanceof Error)) {
    return { error: "An unexpected error occurred", redirectUrl: null };
  }

  // The seat API's 410 Gone: seats are retired in favor of usage-based
  // billing. Only reachable from the seat-era UI, which goes away with the
  // cutover — no handling beyond readable copy.
  if (error.name === "SeatProductRetiredError") {
    return {
      error:
        "PostHog Code seat plans have been retired — usage is now billed to your organization.",
      redirectUrl: null,
    };
  }

  if (error.name === "SeatSubscriptionRequiredError") {
    const redirectUrl =
      "redirectUrl" in error && typeof error.redirectUrl === "string"
        ? error.redirectUrl
        : null;
    return { error: "Billing subscription required", redirectUrl };
  }

  if (error.name === "SeatPaymentFailedError") {
    return { error: error.message, redirectUrl: null };
  }

  return { error: error.message, redirectUrl: null };
}
