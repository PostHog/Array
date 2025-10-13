import { Box, Flex, Text } from "@radix-ui/themes";
import { type SuggestionKeyDownProps } from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
} from "react";

export interface FileMentionListProps {
  items: Array<{ path: string; name: string }>;
  command: (item: { id: string; label: string }) => void;
}

export interface FileMentionListRef {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

export const FileMentionList = forwardRef(
  (
    props: FileMentionListProps,
    ref: ForwardedRef<FileMentionListRef>,
  ) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    const scrollIntoView = (index: number) => {
      const container = containerRef.current;
      const item = itemRefs.current[index];
      
      if (!container || !item) return;
      
      const containerTop = container.scrollTop;
      const containerBottom = containerTop + container.clientHeight;
      
      const itemTop = item.offsetTop;
      const itemBottom = itemTop + item.offsetHeight;
      
      if (itemTop < containerTop) {
        // Item is above visible area
        container.scrollTop = itemTop;
      } else if (itemBottom > containerBottom) {
        // Item is below visible area
        container.scrollTop = itemBottom - container.clientHeight;
      }
    };

    const selectItem = (index: number) => {
      const item = props.items[index];
      if (item) {
        props.command({ id: item.path, label: item.name });
      }
    };

    const upHandler = () => {
      const newIndex = (selectedIndex + props.items.length - 1) % props.items.length;
      setSelectedIndex(newIndex);
      setTimeout(() => scrollIntoView(newIndex), 0);
    };

    const downHandler = () => {
      const newIndex = (selectedIndex + 1) % props.items.length;
      setSelectedIndex(newIndex);
      setTimeout(() => scrollIntoView(newIndex), 0);
    };

    const enterHandler = () => {
      selectItem(selectedIndex);
    };

    useEffect(() => setSelectedIndex(0), [props.items]);
    
    useEffect(() => {
      // Initialize refs array to match items length
      itemRefs.current = itemRefs.current.slice(0, props.items.length);
    }, [props.items.length]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "ArrowUp") {
          upHandler();
          return true;
        }

        if (event.key === "ArrowDown") {
          downHandler();
          return true;
        }

        if (event.key === "Enter") {
          enterHandler();
          return true;
        }

        return false;
      },
    }));

    if (props.items.length === 0) {
      return (
        <Box
          className="file-mention-list"
          style={{
            background: "var(--color-panel-solid)",
            border: "1px solid var(--gray-a6)",
            borderRadius: "var(--radius-2)",
            boxShadow: "var(--shadow-5)",
            maxHeight: "300px",
            overflow: "auto",
            padding: "var(--space-2)",
          }}
        >
          <Text size="2" color="gray">
            No files found
          </Text>
        </Box>
      );
    }

    return (
      <Box
        ref={containerRef}
        className="file-mention-list"
        style={{
          background: "var(--color-panel-solid)",
          border: "1px solid var(--gray-a6)",
          borderRadius: "var(--radius-2)",
          boxShadow: "var(--shadow-5)",
          maxHeight: "300px",
          overflow: "auto",
        }}
      >
        {props.items.map((item, index) => (
          <Flex
            key={item.path}
            ref={(el) => (itemRefs.current[index] = el)}
            className={`file-mention-item ${index === selectedIndex ? "is-selected" : ""}`}
            onClick={() => selectItem(index)}
            onMouseEnter={() => setSelectedIndex(index)}
              style={{
                padding: "var(--space-2)",
                cursor: "pointer",
                backgroundColor:
                  index === selectedIndex ? "var(--accent-a3)" : "transparent",
                borderRadius: "var(--radius-2)",
                transition: "background-color 0.1s",
              }}
            >
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium" style={{ color: "var(--gray-12)" }}>
                  {item.name}
                </Text>
                <Text size="1" color="gray">
                  {item.path}
                </Text>
              </Flex>
            </Flex>
        ))}
      </Box>
    );
  },
);

FileMentionList.displayName = "FileMentionList";

