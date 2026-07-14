import { Notebook } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface NotebooksItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function NotebooksItem({ isActive, onClick }: NotebooksItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Notebook size={16} weight={isActive ? "fill" : "regular"} />}
      label="Notebooks"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
