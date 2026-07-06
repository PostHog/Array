import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CheckCircleIcon,
  ChecksIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  ProhibitIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { PrCheck, PrCheckBucket } from "@posthog/core/git/router-schemas";
import { Spinner } from "@posthog/quill";
import { Text } from "@radix-ui/themes";
import { useMemo, useState } from "react";
import { openExternalUrl } from "../../shell/openExternal";
import { usePrChecks } from "./usePrChecks";

/** Display order: failed first, then running, then succeeded, skipped last. */
const BUCKET_ORDER: Record<PrCheckBucket, number> = {
  fail: 0,
  cancel: 1,
  pending: 2,
  pass: 3,
  skipping: 4,
};

interface PrChecksSectionProps {
  prUrl: string;
}

/**
 * Collapsible CI status list for a PR, styled after GitHub's merge-box checks.
 * The header always shows a per-bucket summary; the section starts collapsed
 * when everything is green and expanded when something needs attention.
 */
export function PrChecksSection({ prUrl }: PrChecksSectionProps) {
  const checksQuery = usePrChecks(prUrl);
  const checks = checksQuery.data;
  const [collapsedOverride, setCollapsedOverride] = useState<boolean | null>(
    null,
  );

  const sorted = useMemo(
    () =>
      [...(checks ?? [])].sort(
        (a, b) =>
          BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] ||
          checkLabel(a).localeCompare(checkLabel(b)),
      ),
    [checks],
  );

  const counts = useMemo(() => {
    const out: Record<PrCheckBucket, number> = {
      fail: 0,
      cancel: 0,
      pending: 0,
      pass: 0,
      skipping: 0,
    };
    for (const check of sorted) out[check.bucket]++;
    return out;
  }, [sorted]);

  if (checksQuery.isLoading) {
    return (
      <ChecksFrame collapsed onToggle={() => {}}>
        <span className="inline-flex items-center gap-2 text-[11px] text-gray-10">
          <Spinner />
          Loading…
        </span>
      </ChecksFrame>
    );
  }

  // Couldn't fetch (null) or nothing reported ([]) — no useful section either
  // way, but only the fetch failure is worth a line of copy.
  if (!checks || checks.length === 0) {
    if (checks === null) {
      return (
        <div className="text-[12px] text-gray-10">
          Couldn't load CI checks for this pull request.
        </div>
      );
    }
    return null;
  }

  const allQuiet =
    counts.fail === 0 && counts.cancel === 0 && counts.pending === 0;
  const collapsed = collapsedOverride ?? allQuiet;

  return (
    <div className="flex flex-col gap-3">
      <ChecksFrame
        collapsed={collapsed}
        onToggle={() => setCollapsedOverride(!collapsed)}
      >
        <ChecksSummary counts={counts} />
      </ChecksFrame>
      {!collapsed && (
        <div className="overflow-hidden rounded-md border border-(--gray-5)">
          {sorted.map((check, index) => (
            <CheckRow
              key={`${check.workflow ?? ""}/${check.name}/${index}`}
              check={check}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Section header, matching the DetailSection chrome but clickable. */
function ChecksFrame({
  collapsed,
  onToggle,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full min-w-0 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
    >
      <span className="flex min-w-0 items-center gap-2">
        <ChecksIcon size={15} weight="bold" className="shrink-0 text-gray-11" />
        <Text className="truncate font-semibold text-[14px] text-gray-12 tracking-[-0.01em]">
          Checks
        </Text>
      </span>
      <div className="h-px min-w-4 flex-1 bg-(--gray-5)" />
      <span className="flex shrink-0 items-center gap-2">
        {children}
        <CaretDownIcon
          size={12}
          className="text-(--gray-9)"
          style={{
            transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </span>
    </button>
  );
}

function ChecksSummary({ counts }: { counts: Record<PrCheckBucket, number> }) {
  const parts: React.ReactNode[] = [];
  const push = (count: number, label: string, className: string) => {
    if (count === 0) return;
    parts.push(
      <span key={label} className={className}>
        {count} {label}
      </span>,
    );
  };
  push(counts.fail, "failed", "text-(--red-11)");
  push(counts.cancel, "cancelled", "text-gray-11");
  push(counts.pending, "running", "text-(--amber-11)");
  push(counts.pass, "successful", "text-(--green-11)");
  push(counts.skipping, "skipped", "text-gray-10");

  return (
    <span className="flex items-center gap-1 text-[11px] tabular-nums">
      {parts.map((part, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static separator list
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span className="text-(--gray-8)">·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

function CheckRow({ check }: { check: PrCheck }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (check.link) openExternalUrl(check.link);
      }}
      title={check.link ? "Open in GitHub" : undefined}
      className="flex w-full cursor-pointer items-center gap-2 border-0 border-b border-b-(--gray-5) bg-transparent px-3 py-[7px] text-left text-[12px] last:border-b-0 hover:bg-gray-2"
    >
      <CheckBucketIcon bucket={check.bucket} />
      <span className="shrink-0 font-medium text-gray-12">
        {checkLabel(check)}
      </span>
      {check.description && (
        <span className="min-w-0 flex-1 truncate text-gray-10">
          {check.description}
        </span>
      )}
      {check.link && (
        <ArrowSquareOutIcon
          size={12}
          className="ml-auto shrink-0 text-(--gray-9)"
        />
      )}
    </button>
  );
}

function checkLabel(check: PrCheck): string {
  return check.workflow ? `${check.workflow} / ${check.name}` : check.name;
}

function CheckBucketIcon({ bucket }: { bucket: PrCheckBucket }) {
  switch (bucket) {
    case "fail":
      return (
        <XCircleIcon
          size={14}
          weight="fill"
          className="shrink-0 text-(--red-9)"
        />
      );
    case "cancel":
      return <ProhibitIcon size={14} className="shrink-0 text-(--gray-9)" />;
    case "pending":
      return (
        <CircleNotchIcon
          size={14}
          className="shrink-0 animate-spin text-(--amber-9)"
        />
      );
    case "pass":
      return (
        <CheckCircleIcon
          size={14}
          weight="fill"
          className="shrink-0 text-(--green-9)"
        />
      );
    case "skipping":
      return <MinusCircleIcon size={14} className="shrink-0 text-(--gray-8)" />;
  }
}
