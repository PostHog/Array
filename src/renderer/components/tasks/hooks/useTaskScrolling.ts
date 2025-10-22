import type { RefObject } from "react";
import { useEffect } from "react";

export function useTaskScrolling(
  listRef: RefObject<HTMLDivElement>,
  selectedIndex: number | null,
  filteredTasksLength: number,
) {
  useEffect(() => {
    if (selectedIndex === null || filteredTasksLength === 0) return;
    const container = listRef.current;
    if (!container) return;

    // Get only actual task items (not drag preview elements)
    const taskItems = Array.from(
      container.querySelectorAll('[data-task-item="true"]'),
    ) as HTMLElement[];
    const selectedElement = taskItems[selectedIndex];

    if (selectedElement) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = selectedElement.getBoundingClientRect();

      // Check if element is not fully visible
      if (elementRect.bottom > containerRect.bottom) {
        // Scrolling down - align to bottom
        const scrollAmount = elementRect.bottom - containerRect.bottom;
        container.scrollTop += scrollAmount;
      } else if (elementRect.top < containerRect.top) {
        // Scrolling up - align to top
        const scrollAmount = containerRect.top - elementRect.top;
        container.scrollTop -= scrollAmount;
      }
    }
  }, [selectedIndex, filteredTasksLength, listRef]);
}
