import type {
  BaseToolViewProps,
  Todo,
  TodoWriteArgs,
} from "@features/logs/tools/types";
import { Box, Code } from "@radix-ui/themes";

type TodoWriteToolViewProps = BaseToolViewProps<TodoWriteArgs, string>;

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
