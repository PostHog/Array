import { SIDEBAR_MIN_WIDTH } from "@posthog/ui/features/sidebar/constants";
import { Box, Flex } from "@radix-ui/themes";
import React from "react";

interface ResizableSidebarProps {
  children: React.ReactNode;
  open: boolean;
  width: number;
  setWidth: (width: number) => void;
  isResizing: boolean;
  setIsResizing: (isResizing: boolean) => void;
  side: "left" | "right";
}

export const ResizableSidebar: React.FC<ResizableSidebarProps> = ({
  children,
  open,
  width,
  setWidth,
  isResizing,
  setIsResizing,
  side,
}) => {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      const maxWidth = window.innerWidth * 0.5;
      const newWidth =
        side === "left"
          ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(maxWidth, e.clientX))
          : Math.max(
              SIDEBAR_MIN_WIDTH,
              Math.min(maxWidth, window.innerWidth - e.clientX),
            );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setWidth, isResizing, setIsResizing, side]);

  const isLeft = side === "left";

  return (
    <Box
      style={{
        width: open ? `${width}px` : "0",
        minWidth: open ? `${width}px` : "0",
        maxWidth: open ? `${width}px` : "0",
        transition: isResizing ? "none" : "width 0.2s ease-in-out",
        borderLeft: !isLeft && open ? "1px solid var(--border)" : "none",
        borderRight: isLeft && open ? "1px solid var(--border)" : "none",
      }}
      className="relative h-full shrink-0"
    >
      <Flex
        direction="column"
        style={{
          width: `${width}px`,
        }}
        className="h-full min-w-0"
      >
        {children}
      </Flex>
      {open && (
        <Box
          onMouseDown={handleMouseDown}
          className="no-drag group absolute top-0 bottom-0 flex w-2 cursor-col-resize justify-center bg-transparent"
          style={{
            left: isLeft ? undefined : -5,
            right: isLeft ? -5 : undefined,
            zIndex: 100,
          }}
        >
          <span className="h-full w-px bg-transparent transition-colors delay-100 duration-150 ease-out group-hover:bg-primary" />
        </Box>
      )}
    </Box>
  );
};
