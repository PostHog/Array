import { Flex, Text } from "@radix-ui/themes";
import { motion } from "framer-motion";
import type { ReactNode } from "react";
import "./FeatureBentoCard.css";

interface FeatureBentoCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  active?: boolean;
  index?: number;
  /** Tailwind classes controlling the cell's grid placement (e.g. "col-span-4 row-span-2"). */
  className?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function FeatureBentoCard({
  icon,
  title,
  description,
  active = false,
  index = 0,
  className = "",
  onMouseEnter,
  onMouseLeave,
}: FeatureBentoCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.08 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`feature-bento-card ${active ? "feature-bento-card--active" : ""} ${className}`}
    >
      <div className="feature-bento-card__placeholder">
        <div
          className="feature-bento-card__placeholder-grid"
          aria-hidden="true"
        />
        <div
          className="feature-bento-card__placeholder-glow"
          aria-hidden="true"
        />
        <Flex
          align="center"
          justify="center"
          className="relative z-10 text-(--gray-9)"
        >
          <div className="feature-bento-card__icon">{icon}</div>
        </Flex>
      </div>
      <Flex
        direction="column"
        gap="1"
        className="feature-bento-card__content shrink-0 px-1 pt-3 pb-1"
      >
        <Text className="font-medium text-(--gray-12) text-sm leading-snug">
          {title}
        </Text>
        <Text className="text-(--gray-11) text-[12px] leading-snug">
          {description}
        </Text>
      </Flex>
    </motion.div>
  );
}
