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
      style={{ flexGrow: 1, maxWidth: "300px", height: "32px" }}
    />
  );
}
