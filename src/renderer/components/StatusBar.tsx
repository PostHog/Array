import { Badge, Box, Code, Flex, Kbd } from "@radix-ui/themes";
import { useStatusBarStore } from "../stores/statusBarStore";
import { StatusBarMenu } from "./StatusBarMenu";

interface StatusBarProps {
  showKeyHints?: boolean;
}

export function StatusBar({ showKeyHints = true }: StatusBarProps) {
  const { statusText, keyHints } = useStatusBarStore();

  // Determine if we're in development mode
  const isDev = process.env.NODE_ENV === "development";
  const version = "0.1.0"; // You can get this from package.json or env vars

  return (
    <Box className="flex flex-row items-center justify-between border-gray-6 border-t bg-gray-2 px-4 py-2">
      <Flex align="center" gap="2">
        <StatusBarMenu />
        <Code size="1" variant="ghost" color="gray">
          {statusText && "- "}
          {statusText}
        </Code>
      </Flex>

      {showKeyHints && (
        <Flex
          align="center"
          gap="3"
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          {keyHints.map((hint) => (
            <Flex key={hint.description} align="center" gap="2">
              <Kbd size="1">{hint.keys.join("")}</Kbd>
              <Code size="1" variant="ghost" color="gray">
                {hint.description}
              </Code>
            </Flex>
          ))}
        </Flex>
      )}

      <Flex align="center" gap="2">
        <Badge color={isDev ? "orange" : "green"} size="1">
          <Code size="1" variant="ghost">
            {isDev ? "DEV" : "PROD"}
          </Code>
        </Badge>
        <Badge color="gray" size="1">
          <Code size="1" variant="ghost">
            v{version}
          </Code>
        </Badge>
      </Flex>
    </Box>
  );
}
