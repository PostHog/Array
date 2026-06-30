interface KeycapProps {
  label: string;
  size?: "sm" | "md";
}

export function Keycap({ label, size = "md" }: KeycapProps) {
  const isSmall = size === "sm";
  const minW = isSmall ? "22px" : "28px";
  const h = isSmall ? "22px" : "28px";
  const fontSize = isSmall ? "11px" : "13px";
  const shadowSize = isSmall ? "2px" : "3px";

  return (
    <span
      style={{
        minWidth: minW,
        height: h,
        fontSize,
        fontFamily: "system-ui, -apple-system, sans-serif",
        lineHeight: 1,
        borderBottomWidth: shadowSize,
        borderBottomColor: "var(--gray-7)",
      }}
      className="box-border inline-flex select-none items-center justify-center rounded-[6px] border border-(--gray-5) bg-(--gray-3) px-[6px] py-0 font-medium text-(--gray-11)"
    >
      {label}
    </span>
  );
}
