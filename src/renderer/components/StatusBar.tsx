import { StatusBarMenu } from "@components/StatusBarMenu";
import { GearIcon } from "@radix-ui/react-icons";
import {
  Badge,
  Box,
  Code,
  Flex,
  IconButton,
  Kbd,
  Tooltip,
} from "@radix-ui/themes";
import { useStatusBarStore } from "@stores/statusBarStore";
import { useEffect, useState } from "react";
import { IS_DEV } from "@/constants/environment";

interface StatusBarProps {
  showKeyHints?: boolean;
  onOpenSettings?: () => void;
}

export function StatusBar({
  showKeyHints = true,
  onOpenSettings,
}: StatusBarProps) {
  const { statusText, keyHints } = useStatusBarStore();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  const fallbackVersion = import.meta.env.VITE_APP_VERSION ?? "dev";

  useEffect(() => {
    let cancelled = false;

    window.electronAPI
      ?.getAppVersion()
      .then((version) => {
        if (!cancelled) {
          setAppVersion(version);
        }
      })
      .catch((error) => {
        console.warn("[statusbar] Failed to load app version", error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const version = appVersion ?? fallbackVersion;

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
        <Badge color={IS_DEV ? "orange" : "green"} size="1">
          <Code size="1" variant="ghost">
            {IS_DEV ? "DEV" : "PROD"}
          </Code>
        </Badge>
        <Badge color="gray" size="1">
          <Code size="1" variant="ghost">
            v{version}
          </Code>
        </Badge>
        {onOpenSettings && (
          <Tooltip content="Settings">
            <IconButton
              size="1"
              variant="ghost"
              color="gray"
              onClick={onOpenSettings}
            >
              <GearIcon />
            </IconButton>
          </Tooltip>
        )}
      </Flex>
    </Box>
  );
}
