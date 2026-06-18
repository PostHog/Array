export interface ClassifiedSeatError {
  error: string;
  redirectUrl: string | null;
}

export function classifySeatError(error: unknown): ClassifiedSeatError {
  if (!(error instanceof Error)) {
    return { error: "An unexpected error occurred", redirectUrl: null };
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
