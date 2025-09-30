import { Box, Code, Flex } from "@radix-ui/themes";

interface DiffViewProps {
  file: string;
  patch?: string;
  added?: number;
  removed?: number;
}

function getFileParts(path: string): { dir: string; base: string } {
  if (!path) return { dir: "", base: "" };
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (idx === -1) return { dir: "", base: path };
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

export function DiffView({ file, patch, added, removed }: DiffViewProps) {
  const { dir, base } = getFileParts(file);
  const lines = (patch || "").split(/\r?\n/);

  return (
    <Box className="overflow-hidden rounded-3 border border-gray-6">
      <Flex align="center" justify="between" p="3" className="bg-gray-2">
        <Box>
          <Code size="2" color="gray" variant="ghost">
            {dir}
          </Code>
          <Code size="2" weight="medium" variant="ghost">
            {base}
          </Code>
        </Box>
        <Box>
          {typeof added === "number" && typeof removed === "number" ? (
            <Code size="1" color="gray" variant="ghost">
              +{added} / -{removed}
            </Code>
          ) : null}
        </Box>
      </Flex>
      <Code
        size="2"
        variant="surface"
        className="block overflow-x-auto whitespace-pre p-3"
      >
        {lines.map((line, i) => {
          let color: string | undefined;
          if (line.startsWith("+++") || line.startsWith("---")) color = "gray";
          else if (line.startsWith("@@")) color = "blue";
          else if (line.startsWith("+")) color = "green";
          else if (line.startsWith("-")) color = "red";
          else if (line.startsWith("diff ") || line.startsWith("index "))
            color = "gray";
          return (
            <div key={`line-${i}-${line.slice(0, 20)}`}>
              <Code size="1" color={color} variant="ghost">
                {line || "\u00A0"}
              </Code>
            </div>
          );
        })}
      </Code>
    </Box>
  );
}
