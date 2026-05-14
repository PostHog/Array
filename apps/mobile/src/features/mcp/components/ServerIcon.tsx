import { PuzzlePiece } from "phosphor-react-native";
import { Image, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import { resolveServerLogo } from "./serverIcons";

interface ServerIconProps {
  iconKey?: string | null;
  size?: number;
  className?: string;
}

/**
 * Renders the brand logo for an MCP server, keyed by `icon_key` from the
 * PostHog cloud schema. Falls back to a generic plug glyph when the icon
 * key is missing or doesn't match the bundled set.
 */
export function ServerIcon({ iconKey, size = 32, className }: ServerIconProps) {
  const themeColors = useThemeColors();
  const logo = resolveServerLogo(iconKey);

  return (
    <View
      className={`shrink-0 items-center justify-center overflow-hidden rounded-md bg-card ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      {logo?.kind === "svg" && typeof logo.component === "function" ? (
        <logo.component width={size} height={size} />
      ) : logo?.kind === "png" ? (
        <Image
          source={logo.source}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      ) : (
        <PuzzlePiece
          size={Math.round(size * 0.55)}
          color={themeColors.gray[11]}
          weight="bold"
        />
      )}
    </View>
  );
}
