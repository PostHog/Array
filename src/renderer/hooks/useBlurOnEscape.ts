import { useEffect } from "react";

export function useBlurOnEscape() {
  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        document.activeElement instanceof HTMLElement
      ) {
        document.activeElement.blur();
      }
    };

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
    };
  }, []);
}
