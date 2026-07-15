import { GLM_MODEL_FLAG, USAGE_BILLING_FLAG } from "@posthog/shared";
import { useFeatureFlag } from "../feature-flags/useFeatureFlag";

/**
 * Whether GLM models are pickable: the staged GLM rollout flag, or usage-based
 * billing — GLM is the free tier's included model, so it must stay pickable
 * regardless of the rollout flag once the cutover flips.
 */
export function useGlmModelVisible(): boolean {
  const glmEnabled = useFeatureFlag(GLM_MODEL_FLAG);
  const usageBillingEnabled = useFeatureFlag(USAGE_BILLING_FLAG);
  return glmEnabled || usageBillingEnabled;
}
