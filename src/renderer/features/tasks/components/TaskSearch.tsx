import { TextField } from "@radix-ui/themes";

interface TaskSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function TaskSearch({ value, onChange }: TaskSearchProps) {
  return (
    <TextField.Root
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search tasks..."
      size="1"
      style={{ flexGrow: 1, maxWidth: "300px" }}
    />
  );
}
