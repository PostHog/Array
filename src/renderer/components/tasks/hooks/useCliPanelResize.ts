import { useCallback, useEffect, useRef, useState } from "react";

export function useCliPanelResize(setCliPanelWidth: (width: number) => void) {
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      setIsResizing(true);
      const container = (e.currentTarget as HTMLElement).parentElement;
      containerRef.current = container as HTMLDivElement;

      if (container) {
        const rect = container.getBoundingClientRect();
        const dividerWidth = 28; // 12px + 8px margin on each side
        const availableWidth = rect.width - dividerWidth;
        const distanceFromRight = rect.right - e.clientX;
        const newWidth = (distanceFromRight / availableWidth) * 100;
        setCliPanelWidth(Math.max(20, Math.min(50, newWidth)));
      }
    },
    [setCliPanelWidth],
  );

  useEffect(() => {
    if (!isResizing || !containerRef.current) return;

    const container = containerRef.current;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const dividerWidth = 28;
      const availableWidth = rect.width - dividerWidth;
      const distanceFromRight = rect.right - e.clientX;
      const newWidth = (distanceFromRight / availableWidth) * 100;
      setCliPanelWidth(Math.max(20, Math.min(50, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      containerRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setCliPanelWidth]);

  return { isResizing, handleMouseDown };
}
