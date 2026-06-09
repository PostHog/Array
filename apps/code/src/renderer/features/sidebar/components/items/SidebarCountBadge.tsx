interface SidebarCountBadgeProps {
  count: number;
  title: string;
}

export function SidebarCountBadge({ count, title }: SidebarCountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className="ml-2 inline-flex shrink-0 items-center justify-center rounded-full bg-(--red-9) p-1 font-medium text-[10px] leading-none"
      style={{ color: "white" }}
      title={title}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
