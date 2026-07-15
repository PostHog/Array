export interface ClassifiedSeatError {
  error: string;
  redirectUrl: string | null;
}

/**
 * The seat API's 410 Gone: PostHog Code seats are retired in favor of
 * usage-based billing. Name-based so it survives the SeatClient seam.
 */
export function isSeatProductRetiredError(error: unknown): boolean {
  return error instanceof Error && error.name === "SeatProductRetiredError";
}

export function classifySeatError(error: unknown): ClassifiedSeatError {
  if (!(error instanceof Error)) {
    return { error: "An unexpected error occurred", redirectUrl: null };
  }

  if (isSeatProductRetiredError(error)) {
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
