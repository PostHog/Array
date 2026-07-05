import { Lightbulb } from "@phosphor-icons/react";
import { SidebarItem } from "../SidebarItem";

interface SkillsItemProps {
  isActive: boolean;
  onClick: () => void;
}

export function SkillsItem({ isActive, onClick }: SkillsItemProps) {
  return (
    <SidebarItem
      depth={0}
      icon={<Lightbulb size={16} weight={isActive ? "fill" : "regular"} />}
      label="Skills"
      isActive={isActive}
      onClick={onClick}
    />
  );
}
