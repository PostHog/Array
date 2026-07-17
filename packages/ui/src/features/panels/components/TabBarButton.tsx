import type React from "react";
import { forwardRef, useState } from "react";

interface TabBarButtonProps {
  ariaLabel: string;
  dataAttr?: string;
  onClick?: () => void;
  children: React.ReactNode;
}

export const TabBarButton = forwardRef<HTMLButtonElement, TabBarButtonProps>(
  function TabBarButton(
    { ariaLabel, dataAttr, onClick, children, ...props },
    ref,
  ) {
    const [isHovered, setIsHovered] = useState(false);

    return (
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        data-attr={dataAttr}
        onClick={onClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        style={{
          background: isHovered ? "var(--gray-4)" : "var(--color-background)",
        }}
        {...props}
        className="flex h-[32px] w-[32px] cursor-pointer items-center justify-center border-0 border-b border-b-(--gray-6) text-(--gray-11)"
      >
        {children}
      </button>
    );
  },
);
