import { UpdateBanner } from "@features/sidebar/components/UpdateBanner";
import { Lifebuoy } from "@phosphor-icons/react";
import { Button, Flex, Theme } from "@radix-ui/themes";
import { trpcClient } from "@renderer/trpc/client";
import { useThemeStore } from "@stores/themeStore";
import { EXTERNAL_LINKS } from "@utils/links";
import type { ReactNode } from "react";
import { DotPatternBackground } from "./DotPatternBackground";
import { DraggableTitleBar } from "./DraggableTitleBar";

interface FullScreenLayoutProps {
  children: ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
}

export function FullScreenLayout({
  children,
  footerLeft,
  footerRight,
}: FullScreenLayoutProps) {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);

  return (
    <Theme
      appearance={isDarkMode ? "dark" : "light"}
      accentColor={isDarkMode ? "yellow" : "orange"}
      radius="medium"
    >
      <Flex
        direction="column"
        height="100vh"
        className="relative overflow-hidden"
      >
        <DraggableTitleBar />

        <div className="absolute inset-0 bg-(--color-background)" />
        <DotPatternBackground />

        <Flex
          direction="column"
          flexGrow="1"
          className="relative z-[1] min-h-0 w-full"
        >
          <Flex
            direction="column"
            flexGrow="1"
            overflow="hidden"
            className="min-h-0"
          >
            {children}
          </Flex>

          <Flex
            justify="between"
            className="absolute right-[32px] bottom-[20px] left-[32px] z-[2]"
          >
            {footerLeft ?? (
              <Flex align="center" gap="3">
                <Button
                  size="1"
                  variant="ghost"
                  color="gray"
                  onClick={() =>
                    trpcClient.os.openExternal.mutate({
                      url: EXTERNAL_LINKS.discord,
                    })
                  }
                  className="opacity-50"
                >
                  <Lifebuoy size={14} />
                  Get support
                </Button>
                <UpdateBanner variant="compact" />
              </Flex>
            )}
            {footerRight ?? <div />}
          </Flex>
        </Flex>
      </Flex>
    </Theme>
  );
}
