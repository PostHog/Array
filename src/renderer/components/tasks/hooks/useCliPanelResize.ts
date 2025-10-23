import { useCallback, useEffect, useState } from "react";

export function useCliPanelResize(setCliPanelWidth: (width: number) => void) {
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback(() => {
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth =
        ((window.innerWidth - e.clientX) / window.innerWidth) * 100;
      setCliPanelWidth(Math.max(20, Math.min(50, newWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
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
