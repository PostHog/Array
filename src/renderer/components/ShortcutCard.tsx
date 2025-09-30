import { Button, Code, Flex, Kbd } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface ShortcutCardProps {
  icon: ReactNode;
  title: string;
  keys: string[];
}

export function ShortcutCard({ icon, title, keys }: ShortcutCardProps) {
  return (
    <Button size="2" variant="surface" color="gray">
      <Flex direction="column" gap="2" width="200px">
        <Flex align="center" justify="between" gap="2">
          <Flex align="center" gap="2">
            {icon}
            <Code variant="ghost">{title}</Code>
          </Flex>

          <Flex align="center" gap="2">
            {keys.map((key) => (
              <Kbd size="1" key={key}>
                {key}
              </Kbd>
            ))}
          </Flex>
        </Flex>
      </Flex>
    </Button>
  );
}
