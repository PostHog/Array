interface SidebarCountBadgeProps {
  count: number;
  title: string;
}

export function SidebarCountBadge({ count, title }: SidebarCountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      // Amber, like every other unread mark: red is for something that failed.
      className="ml-2 inline-flex h-2 w-2 shrink-0 rounded-full bg-(--amber-9)"
      title={title}
    />
  );
}
