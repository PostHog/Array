import { ServerIcon } from "@features/mcp-servers/components/parts/icons";
import { useMcpServers } from "@features/mcp-servers/hooks/useMcpServers";
import { Check } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";

interface SourcesPickerProps {
  /** MCP template ids the user has selected. */
  value: string[];
  onChange: (next: string[]) => void;
}

interface SourceOption {
  id: string;
  label: string;
  iconKey: string | null | undefined;
}

export function SourcesPicker({ value, onChange }: SourcesPickerProps) {
  const { servers, installedTemplateIds } = useMcpServers();

  const options = useMemo<SourceOption[]>(() => {
    if (!servers) return [];
    // Prefer the servers the user has installed; if they have none, fall back
    // to the full recommended catalogue so the picker isn't empty.
    const haveInstalled = installedTemplateIds.size > 0;
    return servers
      .filter((s) => (haveInstalled ? installedTemplateIds.has(s.id) : true))
      .map((s) => ({ id: s.id, label: s.name, iconKey: s.icon_key }))
      .slice(0, 24);
  }, [servers, installedTemplateIds]);

  const selected = useMemo(() => new Set(value), [value]);

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(value.filter((v) => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  if (options.length === 0) {
    return (
      <Flex direction="column" gap="2">
        <Text size="1" weight="medium" className="text-(--gray-11)">
          Data sources
        </Text>
        <Text size="1" className="text-(--gray-10)">
          No data sources connected. The task will run with whatever tools the
          agent has by default.
        </Text>
      </Flex>
    );
  }

  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1">
        <Text size="1" weight="medium" className="text-(--gray-11)">
          Data sources
        </Text>
        <Text size="1" className="text-(--gray-10)">
          Pick which connected tools the agent should reach for. If none are
          picked, the agent decides.
        </Text>
      </Flex>

      <Flex gap="2" wrap="wrap">
        {options.map((option) => {
          const isSelected = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggle(option.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[12px] transition-colors ${
                isSelected
                  ? "border-(--accent-7) bg-(--accent-3) text-(--gray-12)"
                  : "border-(--gray-5) bg-(--gray-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
              }`}
            >
              <Box className="shrink-0">
                <ServerIcon iconKey={option.iconKey} size={14} />
              </Box>
              <Text size="1">{option.label}</Text>
              {isSelected && <Check size={12} />}
            </button>
          );
        })}
      </Flex>
    </Flex>
  );
}
