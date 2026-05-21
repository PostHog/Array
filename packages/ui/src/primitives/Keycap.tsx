import { useState } from "react";

interface KeycapProps {
  label: string;
  size?: "sm" | "md";
}

export function Keycap({ label, size = "md" }: KeycapProps) {
  const [pressed, setPressed] = useState(false);
  const isSmall = size === "sm";
  const minW = isSmall ? "22px" : "28px";
  const h = isSmall ? "22px" : "28px";
  const fontSize = isSmall ? "11px" : "13px";
  const shadowSize = isSmall ? "2px" : "3px";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: cosmetic press animation
    <span
      role="presentation"
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        minWidth: minW,
        height: h,
        fontSize,
        fontFamily: "system-ui, -apple-system, sans-serif",
        lineHeight: 1,
        borderBottomWidth: pressed ? "1px" : shadowSize,
        borderBottomColor: "var(--gray-7)",
        transform: pressed
          ? `translateY(${isSmall ? "1px" : "2px"})`
          : "translateY(0)",
        transition:
          "transform 80ms ease-out, border-bottom-width 80ms ease-out",
      }}
      className="box-border inline-flex cursor-pointer select-none items-center justify-center rounded-[6px] border border-(--gray-5) bg-(--gray-3) px-[6px] py-0 font-medium text-(--gray-11)"
    >
      {label}
    </span>
  );
}
