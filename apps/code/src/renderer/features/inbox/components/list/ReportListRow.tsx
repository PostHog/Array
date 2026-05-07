import { ReportCardContent } from "@features/inbox/components/utils/ReportCardContent";
import { SOURCE_PRODUCT_META } from "@features/inbox/components/utils/source-product-icons";
import { FileTextIcon } from "@phosphor-icons/react";
import { Checkbox, Flex, Tooltip } from "@radix-ui/themes";
import type { SignalReport } from "@shared/types";
import { motion } from "framer-motion";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

function SourceProductIcon({ sourceProducts }: { sourceProducts?: string[] }) {
  const firstProduct = sourceProducts?.[0];
  const meta = firstProduct ? SOURCE_PRODUCT_META[firstProduct] : undefined;

  if (!meta) {
    return (
      <span className="text-gray-8">
        <FileTextIcon size={14} />
      </span>
    );
  }

  // Always show the first (initiating) product's icon.
  // If later signals added more source products, list them in the tooltip.
  const otherLabels = (sourceProducts ?? [])
    .slice(1)
    .map((p) => SOURCE_PRODUCT_META[p]?.label)
    .filter(Boolean);
  const tooltip =
    otherLabels.length > 0
      ? `Initiated by ${meta.label} · also: ${otherLabels.join(", ")}`
      : `Initiated by ${meta.label}`;

  return (
    <Tooltip content={tooltip}>
      <span style={{ color: meta.color }}>
        <meta.Icon size={14} />
      </span>
    </Tooltip>
  );
}

interface ReportListRowProps {
  report: SignalReport;
  isSelected: boolean;
  showCheckbox: boolean;
  onClick: (event: { metaKey: boolean; shiftKey: boolean }) => void;
  onToggleChecked: () => void;
  index: number;
  /** Optional badge rendered before the standard status/priority/actionability badges. */
  prependBadges?: ReactNode;
  /** Optional override for the icon shown in the left-side icon column. */
  iconOverride?: ReactNode;
}

export function ReportListRow({
  report,
  isSelected,
  showCheckbox,
  onClick,
  onToggleChecked,
  index,
  prependBadges,
  iconOverride,
}: ReportListRowProps) {
  const isInteractiveTarget = (target: EventTarget | null): boolean => {
    return (
      target instanceof HTMLElement &&
      !!target.closest("a, button, input, select, textarea, [role='checkbox']")
    );
  };

  const handleActivate = (e: MouseEvent | KeyboardEvent): void => {
    if (isInteractiveTarget(e.target)) {
      return;
    }
    onClick({ metaKey: e.metaKey, shiftKey: e.shiftKey });
  };

  const rowBgClass = isSelected
    ? report.is_suggested_reviewer
      ? "bg-amber-3"
      : "bg-gray-3"
    : report.is_suggested_reviewer
      ? "bg-amber-2"
      : "";

  const hoverOverlayClass =
    isSelected && report.is_suggested_reviewer
      ? "before:bg-amber-12 before:opacity-0 hover:before:opacity-[0.07]"
      : "before:bg-gray-12 before:opacity-0 hover:before:opacity-[0.07]";

  return (
    <motion.div
      role="button"
      tabIndex={-1}
      data-report-id={report.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.22,
        delay: Math.min(index * 0.035, 0.35),
        ease: [0.22, 1, 0.36, 1],
      }}
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={handleActivate}
      onKeyDown={(e: KeyboardEvent) => {
        if (isInteractiveTarget(e.target)) {
          return;
        }

        if (e.key === "Enter") {
          e.preventDefault();
          handleActivate(e);
        }
      }}
      className={[
        "relative isolate w-full cursor-pointer overflow-hidden border-gray-5 border-b py-1.5 pr-4 pl-1.5 text-left",
        "before:pointer-events-none before:absolute before:inset-0 before:z-[1]",
        hoverOverlayClass,
        rowBgClass,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Flex align="start" gap="1" className="relative z-[2]">
        <Flex
          align="center"
          justify="center"
          className="w-[16px] min-w-[16px] shrink-0 pt-0.5"
        >
          {showCheckbox ? (
            <Checkbox
              size="1"
              checked={isSelected}
              tabIndex={-1}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onCheckedChange={() => onToggleChecked()}
              aria-label={
                isSelected
                  ? "Unselect report from bulk actions"
                  : "Select report for bulk actions"
              }
            />
          ) : (
            (iconOverride ?? (
              <SourceProductIcon sourceProducts={report.source_products} />
            ))
          )}
        </Flex>
        <div className="min-w-0 flex-1">
          <ReportCardContent
            report={report}
            compact
            prependBadges={prependBadges}
          />
        </div>
      </Flex>
    </motion.div>
  );
}
