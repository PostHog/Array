import { Stack, usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { BackHandler, View } from "react-native";
import { NavDrawer } from "@/features/navigation/components/NavDrawer";
import { useNavDrawerStore } from "@/features/navigation/stores/navDrawerStore";
import { useThemeColors } from "@/lib/theme";

const HOME_ROUTE = "/tasks";
const TAB_ROUTES = new Set(["/", "/tasks", "/inbox", "/automations"]);

export default function TabsLayout() {
  const themeColors = useThemeColors();
  const router = useRouter();
  const pathname = usePathname();

  // Android: each drawer destination replaces (no back stack between them), so
  // hardware back from a non-home destination should go home instead of exiting.
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        const store = useNavDrawerStore.getState();
        // Drawer always-mounted: close it explicitly here since there's no
        // Modal onRequestClose to fall through to.
        if (store.isOpen) {
          store.close();
          return true;
        }
        // Only intercept when we're actually on a tab destination. Modals
        // pushed on top of the tabs (e.g. /automation, /task) keep this
        // handler mounted; without the guard we'd redirect to /tasks instead
        // of letting the modal dismiss naturally.
        if (!TAB_ROUTES.has(pathname)) return false;
        if (pathname === HOME_ROUTE) return false;
        router.replace(HOME_ROUTE);
        return true;
      },
    );
    return () => subscription.remove();
  }, [pathname, router]);

  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: themeColors.background },
        }}
      >
        <Stack.Screen name="tasks" />
        <Stack.Screen name="inbox" />
        <Stack.Screen name="automations" />
        <Stack.Screen name="index" />
      </Stack>
      <NavDrawer />
    </View>
  );
}
