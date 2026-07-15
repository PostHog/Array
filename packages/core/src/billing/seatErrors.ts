export interface ClassifiedSeatError {
  error: string;
  redirectUrl: string | null;
}

export function classifySeatError(error: unknown): ClassifiedSeatError {
  if (!(error instanceof Error)) {
    return { error: "An unexpected error occurred", redirectUrl: null };
  }

  // Seats are retired (410 Gone); the seat-era UI that can hit this goes
  // away at cutover, so readable copy is the only handling.
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
