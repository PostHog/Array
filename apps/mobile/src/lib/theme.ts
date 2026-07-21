import { APP_COLOR_PALETTE, type AppThemeColors } from "@posthog/shared/theme";
import { useColorScheme, vars } from "nativewind";

// Convert hex to RGB space-separated format for NativeWind vars()
function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0 0 0";
  return `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(result[3], 16)}`;
}

// Convert hex to rgba format with alpha
function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Generate NativeWind vars() from color definitions
function createThemeVars(theme: AppThemeColors) {
  return vars({
    "--gray-1": hexToRgb(theme.gray[1]),
    "--gray-2": hexToRgb(theme.gray[2]),
    "--gray-3": hexToRgb(theme.gray[3]),
    "--gray-4": hexToRgb(theme.gray[4]),
    "--gray-5": hexToRgb(theme.gray[5]),
    "--gray-6": hexToRgb(theme.gray[6]),
    "--gray-7": hexToRgb(theme.gray[7]),
    "--gray-8": hexToRgb(theme.gray[8]),
    "--gray-9": hexToRgb(theme.gray[9]),
    "--gray-10": hexToRgb(theme.gray[10]),
    "--gray-11": hexToRgb(theme.gray[11]),
    "--gray-12": hexToRgb(theme.gray[12]),
    "--accent-1": hexToRgb(theme.accent[1]),
    "--accent-2": hexToRgb(theme.accent[2]),
    "--accent-3": hexToRgb(theme.accent[3]),
    "--accent-4": hexToRgb(theme.accent[4]),
    "--accent-5": hexToRgb(theme.accent[5]),
    "--accent-6": hexToRgb(theme.accent[6]),
    "--accent-7": hexToRgb(theme.accent[7]),
    "--accent-8": hexToRgb(theme.accent[8]),
    "--accent-9": hexToRgb(theme.accent[9]),
    "--accent-10": hexToRgb(theme.accent[10]),
    "--accent-11": hexToRgb(theme.accent[11]),
    "--accent-12": hexToRgb(theme.accent[12]),
    "--accent-contrast": hexToRgb(theme.accent.contrast),
    "--status-success": hexToRgb(theme.status.success),
    "--status-error": hexToRgb(theme.status.error),
    "--status-warning": hexToRgb(theme.status.warning),
    "--status-info": hexToRgb(theme.status.info),
    "--background": hexToRgb(theme.background),
    "--card": hexToRgb(theme.card),
  });
}

// NativeWind vars() for runtime theming (used in root View style)
export const lightTheme = createThemeVars(APP_COLOR_PALETTE.light);
export const darkTheme = createThemeVars(APP_COLOR_PALETTE.dark);

// Types
export type ThemeColors = AppThemeColors;

/**
 * Hook to get raw hex color values for native components.
 * Use for: ActivityIndicator, headerStyle, headerTintColor, RefreshControl, etc.
 *
 * For styled components, use Tailwind classes:
 * - bg-gray-1, text-gray-12, border-gray-6
 * - bg-accent-9, text-accent-11
 * - bg-background
 */
export function useThemeColors(): ThemeColors {
  const { colorScheme } = useColorScheme();
  return colorScheme === "dark"
    ? APP_COLOR_PALETTE.dark
    : APP_COLOR_PALETTE.light;
}

/**
 * Convert hex color to rgba format.
 * Useful for creating transparent variants of theme colors (e.g., for gradients).
 */
export function toRgba(hex: string, alpha: number): string {
  return hexToRgba(hex, alpha);
}
