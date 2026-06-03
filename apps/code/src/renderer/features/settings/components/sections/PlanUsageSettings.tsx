import { useSwitchOrgMutation } from "@features/auth/hooks/authMutations";
import { useAuthStateValue } from "@features/auth/hooks/authQueries";
import { TokenSpendAnalysisBanner } from "@features/billing/components/TokenSpendAnalysisBanner";
import { useUsage } from "@features/billing/hooks/useUsage";
import { useSeatStore } from "@features/billing/stores/seatStore";
import { formatResetTime } from "@features/billing/utils";
import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useSeat } from "@hooks/useSeat";
import type { UsageBucket } from "@main/services/llm-gateway/schemas";
import {
  ArrowSquareOut,
  CreditCard,
  Info,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Badge,
  Button,
  Callout,
  Dialog,
  Flex,
  Progress,
  Spinner,
  Text,
} from "@radix-ui/themes";
import { ANALYTICS_EVENTS } from "@shared/types/analytics";
import { PLAN_PRO_ALPHA } from "@shared/types/seat";
import { track } from "@utils/analytics";
import { logger } from "@utils/logger";
import { getBillingUrl, getPostHogUrl } from "@utils/urls";
import { useEffect, useState } from "react";

const log = logger.scope("plan-usage");

const SPEND_ANALYSIS_FLAG = "posthog-code-spend-analysis";

export function PlanUsageSettings() {
  const {
    seat,
    orgSeat,
    isOrgPro,
    isCanceling,
    activeUntil,
    isLoading,
    error,
    redirectUrl,
    billingOrgId,
    hasBetterPlanElsewhere,
  } = useSeat();
  const { fetchSeat, upgradeToPro, cancelSeat, reactivateSeat, clearError } =
    useSeatStore();
  const cloudRegion = useAuthStateValue((state) => state.cloudRegion);
  const currentOrgId = useAuthStateValue((state) => state.currentOrgId);
  const switchOrgMutation = useSwitchOrgMutation();
  const billingUrl = getBillingUrl(cloudRegion);

  async function switchOrgAndRefreshSeat(orgId: string): Promise<void> {
    await switchOrgMutation.mutateAsync(orgId);
    await fetchSeat({ autoProvision: true });
  }

  async function openBillingPage(orgId: string | null): Promise<void> {
    if (orgId && orgId !== currentOrgId) {
      try {
        await switchOrgAndRefreshSeat(orgId);
      } catch (err) {
        log.warn("Failed to switch org before opening billing", err);
        return;
      }
    }
    if (billingUrl) window.open(billingUrl, "_blank");
  }

  async function switchToBillingOrg(orgId: string): Promise<void> {
    try {
      await switchOrgAndRefreshSeat(orgId);
    } catch (err) {
      log.warn("Failed to switch to billing org", err);
    }
  }
  const redirectFullUrl = redirectUrl
    ? (getPostHogUrl(redirectUrl, cloudRegion) ?? billingUrl)
    : null;
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const spendAnalysisEnabled =
    useFeatureFlag(SPEND_ANALYSIS_FLAG) || import.meta.env.DEV;

  const isAlpha = orgSeat?.plan_key === PLAN_PRO_ALPHA;
  const {
    usage,
    isLoading: usageLoading,
    refetch: refetchUsage,
  } = useUsage({
    enabled: seat !== null,
  });

  useEffect(() => {
    void fetchSeat({ autoProvision: true });
    void refetchUsage();
  }, [fetchSeat, refetchUsage]);

  useEffect(() => {
    if (showUpgradeDialog) {
      track(ANALYTICS_EVENTS.UPGRADE_PROMPT_SHOWN, {
        surface: "upgrade_dialog",
      });
    }
  }, [showUpgradeDialog]);

  const formattedActiveUntil = activeUntil
    ? activeUntil.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : null;

  const daysUntilReset = activeUntil
    ? Math.max(
        0,
        Math.ceil((activeUntil.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
      )
    : null;

  return (
    <Flex direction="column" gap="5">
      {error && !redirectUrl && (
        <Callout.Root color="red" size="1">
          <Callout.Icon>
            <WarningCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="2">
              <Text className="text-sm">{error}</Text>
              <Text className="text-(--red-9) text-sm">
                Update your payment method in PostHog to continue.
              </Text>
              <Button
                size="1"
                variant="outline"
                color="red"
                disabled={!billingUrl}
                onClick={() => {
                  void openBillingPage(billingOrgId);
                }}
                className="self-start"
              >
                Manage billing
                <ArrowSquareOut size={12} />
              </Button>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      )}

      {redirectUrl && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <WarningCircle size={16} />
          </Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="2">
              <Text className="text-sm">
                Your organization needs an active billing subscription before
                you can select a plan.
              </Text>
              <Button
                size="1"
                variant="outline"
                color="amber"
                disabled={!redirectFullUrl}
                onClick={() => {
                  if (redirectFullUrl) window.open(redirectFullUrl, "_blank");
                  clearError();
                }}
                className="self-start"
              >
                Set up billing
                <ArrowSquareOut size={12} />
              </Button>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      )}

      {spendAnalysisEnabled && <TokenSpendAnalysisBanner />}

      {hasBetterPlanElsewhere && seat?.organization_name && (
        <Callout.Root color="blue" size="1">
          <Callout.Icon>
            <Info size={16} />
          </Callout.Icon>
          <Callout.Text>
            <Flex direction="column" gap="2">
              <Text className="text-sm">
                You have a Pro plan on{" "}
                <Text weight="medium">{seat.organization_name}</Text>. Usage on
                this page reflects your current organization.
              </Text>
              {billingOrgId && (
                <Flex direction="column" gap="1" className="self-start">
                  <Button
                    size="1"
                    variant="outline"
                    disabled={switchOrgMutation.isPending}
                    onClick={() => {
                      void switchToBillingOrg(billingOrgId);
                    }}
                  >
                    {switchOrgMutation.isPending ? (
                      <Spinner size="1" />
                    ) : (
                      `Switch to ${seat.organization_name ?? "Pro org"}`
                    )}
                  </Button>
                  {switchOrgMutation.isError && (
                    <Text className="text-(--red-11) text-[12px]">
                      Switching failed. Try again or switch from the sidebar.
                    </Text>
                  )}
                </Flex>
              )}
            </Flex>
          </Callout.Text>
        </Callout.Root>
      )}

      <Flex gap="3">
        {orgSeat ? (
          <>
            <PlanCard
              name="Free"
              price="$0"
              period="/mo"
              isCurrent={!isOrgPro}
            />
            <PlanCard
              name="Pro"
              price="$200"
              period="/mo"
              badge="20× Free usage"
              isCurrent={isOrgPro && !isAlpha}
              resetLabel={
                isOrgPro && !isAlpha && isCanceling && formattedActiveUntil
                  ? `Cancels ${formattedActiveUntil}`
                  : isOrgPro &&
                      !isAlpha &&
                      formattedActiveUntil &&
                      daysUntilReset !== null
                    ? `Resets ${formattedActiveUntil} (${daysUntilReset} days)`
                    : undefined
              }
              action={
                isAlpha ? null : isOrgPro ? (
                  isCanceling ? (
                    <Button
                      size="1"
                      variant="solid"
                      onClick={reactivateSeat}
                      disabled={isLoading}
                      className="self-start"
                    >
                      {isLoading ? <Spinner size="1" /> : "Reactivate"}
                    </Button>
                  ) : (
                    <Button
                      size="1"
                      variant="outline"
                      color="red"
                      onClick={cancelSeat}
                      disabled={isLoading}
                      className="self-start"
                    >
                      {isLoading ? <Spinner size="1" /> : "Cancel plan"}
                    </Button>
                  )
                ) : (
                  <Button
                    size="1"
                    variant="solid"
                    onClick={() => {
                      track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, {
                        surface: "plan_page_card",
                      });
                      setShowUpgradeDialog(true);
                    }}
                    disabled={isLoading}
                    className="self-start"
                  >
                    {isLoading ? <Spinner size="1" /> : "Upgrade"}
                  </Button>
                )
              }
            />
          </>
        ) : (
          <Flex
            align="center"
            justify="center"
            p="6"
            className="flex-1 rounded-(--radius-3) border border-(--gray-5)"
          >
            {isLoading ? (
              <Spinner size="2" />
            ) : (
              <Text color="gray" className="text-sm">
                No plan selected
              </Text>
            )}
          </Flex>
        )}
      </Flex>

      {isAlpha && (
        <Flex
          p="4"
          className="rounded-(--radius-3) border border-(--accent-7) bg-(--accent-2)"
        >
          <Flex direction="column" gap="2">
            <Text className="font-medium text-sm">Extended Alpha Plan</Text>
            <Text className="text-(--gray-11) text-sm">
              You're on the free Pro plan with full Pro features until June 4,
              2026. Once your alpha seat expires, you'll be moved to the free
              plan automatically and will be able to upgrade to the Pro plan.
            </Text>
          </Flex>
        </Flex>
      )}

      <Flex direction="column" gap="3">
        <Text className="font-medium text-(--gray-9) text-sm">Usage</Text>
        {usageLoading ? (
          <Flex
            align="center"
            justify="center"
            p="4"
            className="rounded-(--radius-3) border border-(--gray-5)"
          >
            <Spinner size="2" />
          </Flex>
        ) : usage ? (
          <Flex direction="column" gap="3">
            <UsageMeter
              label="Monthly"
              bucket={usage.sustained}
              color={usage.sustained.exceeded ? "red" : undefined}
            />
            <UsageMeter
              label="Daily"
              bucket={usage.burst}
              color={usage.burst.exceeded ? "red" : undefined}
            />
          </Flex>
        ) : (
          <Flex
            direction="column"
            gap="3"
            p="4"
            className="rounded-(--radius-3) border border-(--gray-5)"
          >
            <Text color="gray" className="text-sm">
              Unable to load usage data
            </Text>
          </Flex>
        )}
      </Flex>

      {isOrgPro && (
        <Flex direction="column" gap="3">
          <Text className="font-medium text-(--gray-9) text-sm">Billing</Text>
          <Flex
            align="center"
            justify="between"
            p="4"
            className="rounded-(--radius-3) border border-(--gray-5)"
          >
            <Flex align="center" gap="3">
              <CreditCard size={18} className="text-(--gray-9)" />
              <Text className="text-sm">Manage billing and invoices</Text>
            </Flex>
            <Button
              size="1"
              variant="outline"
              disabled={!billingUrl}
              onClick={() => {
                void openBillingPage(billingOrgId);
              }}
            >
              Open
              <ArrowSquareOut size={12} />
            </Button>
          </Flex>
        </Flex>
      )}
      <Dialog.Root open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <Dialog.Content maxWidth="420px" size="2">
          <Dialog.Title className="text-base">Upgrade to Pro</Dialog.Title>
          <Dialog.Description color="gray" className="text-sm">
            Pro is for teams using Code as part of their daily development
            workflow: longer cloud runs, repeated agent iterations, and fewer
            stops as work scales.{" "}
            {seat?.organization_name ? (
              <Text weight="medium">{seat.organization_name}</Text>
            ) : (
              "Your organization"
            )}{" "}
            will be charged $200/month for 20× the Free usage limit.
          </Dialog.Description>
          <Flex
            align="start"
            gap="2"
            mt="3"
            p="3"
            className="rounded-(--radius-2) bg-(--gray-2)"
          >
            <Info size={14} className="mt-[2px] shrink-0 text-(--gray-9)" />
            <Text className="text-(--gray-11) text-[13px]">
              Your first charge is prorated for the remainder of the current
              billing cycle, then $200/month thereafter.
            </Text>
          </Flex>
          <Flex justify="end" gap="3" mt="4">
            <Dialog.Close>
              <Button variant="soft" color="gray" size="2">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              size="2"
              onClick={async () => {
                track(ANALYTICS_EVENTS.UPGRADE_PROMPT_CLICKED, {
                  surface: "upgrade_dialog",
                });
                setShowUpgradeDialog(false);
                await upgradeToPro();
              }}
              disabled={isLoading}
            >
              {isLoading ? <Spinner size="1" /> : "Subscribe - $200/mo"}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
}

interface UsageMeterProps {
  label: string;
  bucket: UsageBucket;
  color?: "red";
}

function UsageMeter({ label, bucket, color }: UsageMeterProps) {
  const percentage = bucket.used_percent;

  const borderColor = color === "red" ? "var(--red-7)" : "var(--gray-5)";

  return (
    <Flex
      direction="column"
      gap="3"
      p="4"
      style={{
        border: `1px solid ${borderColor}`,
      }}
      className="rounded-(--radius-3)"
    >
      <Flex align="center" justify="between">
        <Text className="font-medium text-sm">{label}</Text>
        <Text className="font-medium text-sm">{percentage.toFixed(2)}%</Text>
      </Flex>
      <Progress
        value={percentage}
        size="2"
        color={color === "red" ? "red" : undefined}
      />
      <Text className="text-(--gray-9) text-[13px]">
        {bucket.exceeded ? "Limit exceeded" : formatResetTime(bucket.reset_at)}
      </Text>
    </Flex>
  );
}

interface PlanCardProps {
  name: string;
  price: string;
  period: string;
  isCurrent: boolean;
  resetLabel?: string;
  badge?: string;
  action?: React.ReactNode;
}

function PlanCard({
  name,
  price,
  period,
  isCurrent,
  resetLabel,
  badge,
  action,
}: PlanCardProps) {
  return (
    <Flex
      direction="column"
      justify="between"
      gap="3"
      p="4"
      style={{
        border: isCurrent
          ? "1px solid var(--accent-7)"
          : "1px solid var(--gray-5)",
        opacity: isCurrent ? 1 : 0.7,
      }}
      className="relative flex-1 rounded-(--radius-3)"
    >
      {badge && (
        <Badge variant="soft" radius="full" className="absolute top-4 right-4">
          {badge}
        </Badge>
      )}
      <Flex direction="column" gap="3">
        <Flex direction="column" gap="1">
          <Text
            style={{
              color: isCurrent ? "var(--accent-9)" : "var(--gray-9)",
              letterSpacing: "0.05em",
            }}
            className="font-medium text-[13px]"
          >
            {isCurrent ? "CURRENT PLAN" : name.toUpperCase()}
          </Text>
          <Flex align="baseline" gap="2">
            <Text className="font-bold text-xl">{name}</Text>
            <Text className="text-(--gray-11) text-base">
              {price}
              <Text className="text-(--gray-9) text-[13px]">{period}</Text>
            </Text>
          </Flex>
          {resetLabel && (
            <Text className="text-(--gray-9) text-[13px]">{resetLabel}</Text>
          )}
        </Flex>
      </Flex>
      {action}
    </Flex>
  );
}
