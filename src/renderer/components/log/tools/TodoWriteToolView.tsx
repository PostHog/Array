import { Box, Code } from "@radix-ui/themes";

interface Todo {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

interface TodoWriteToolViewProps {
  args: any;
  _unused?: {
    todos: Todo[];
  };
  result?: any;
}

export function TodoWriteToolView({ args }: TodoWriteToolViewProps) {
  const { todos } = args;

  if (!todos || todos.length === 0) {
    return null;
  }

  return (
    <Box className="space-y-1">
      {todos.map((todo: Todo, i: number) => {
        const color =
          todo.status === "completed"
            ? "green"
            : todo.status === "in_progress"
              ? "blue"
              : "gray";

        const icon =
          todo.status === "completed"
            ? "✓"
            : todo.status === "in_progress"
              ? "▶"
              : "○";

        return (
          <Box key={`${todo.content}-${i}`} className="flex items-start gap-2">
            <Code size="1" color={color} variant="ghost">
              {icon}
            </Code>
            <Code size="1" color={color} variant="ghost" className="flex-1">
              {todo.status === "in_progress" ? todo.activeForm : todo.content}
            </Code>
          </Box>
        );
      })}
    </Box>
  );
}
