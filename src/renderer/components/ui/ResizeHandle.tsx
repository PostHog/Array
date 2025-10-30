interface ResizeHandleProps {
  isResizing: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

export function ResizeHandle({ isResizing, onMouseDown }: ResizeHandleProps) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: This is a drag handle for resizing
    <div
      style={{
        width: "12px",
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginLeft: "8px",
        marginRight: "8px",
      }}
      onMouseDown={onMouseDown}
      onMouseEnter={(e) => {
        if (!isResizing) {
          const bar = e.currentTarget.querySelector(".drag-bar") as HTMLElement;
          if (bar) bar.style.backgroundColor = "var(--gray-a8)";
        }
      }}
      onMouseLeave={(e) => {
        if (!isResizing) {
          const bar = e.currentTarget.querySelector(".drag-bar") as HTMLElement;
          if (bar) bar.style.backgroundColor = "var(--gray-a4)";
        }
      }}
    >
      {/* Inner div for 2px drag bar */}
      <div
        className="drag-bar"
        style={{
          width: "1px",
          height: "100%",
          backgroundColor: isResizing ? "var(--accent-9)" : "var(--gray-a4)",
          transition: "background-color 0.2s",
        }}
      />
    </div>
  );
}
