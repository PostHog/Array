import { SIDEBAR_BORDER } from "@components/ui/sidebar/Context";
import { Box, Flex } from "@radix-ui/themes";
import { useSidebarStore } from "@stores/sidebarStore";
import React from "react";

const MIN_WIDTH = 100;

export const Sidebar: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const open = useSidebarStore((state) => state.open);
  const width = useSidebarStore((state) => state.width);
  const setWidth = useSidebarStore((state) => state.setWidth);
  const isResizing = useSidebarStore((state) => state.isResizing);
  const setIsResizing = useSidebarStore((state) => state.setIsResizing);

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
      const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, e.clientX));
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
  }, [setWidth, isResizing, setIsResizing]);

  return (
    <Box
      style={{
        width: open ? `${width}px` : "0",
        height: "100%",
        overflow: "hidden",
        transition: isResizing ? "none" : "width 0.2s ease-in-out",
        borderRight: open ? SIDEBAR_BORDER : "none",
        position: "relative",
      }}
    >
      <Flex
        direction="column"
        style={{
          width: `${width}px`,
          height: "100%",
        }}
      >
        {children}
      </Flex>
      {open && (
        <Box
          onMouseDown={handleMouseDown}
          className="no-drag"
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            bottom: 0,
            width: "4px",
            cursor: "col-resize",
            backgroundColor: "transparent",
            zIndex: 100,
          }}
        />
      )}
    </Box>
  );
};
