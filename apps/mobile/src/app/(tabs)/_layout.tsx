import { Stack, usePathname, useRouter } from "expo-router";
import { useEffect } from "react";
import { BackHandler, View } from "react-native";
import { NavDrawer } from "@/features/navigation/components/NavDrawer";
import { useNavDrawerStore } from "@/features/navigation/stores/navDrawerStore";
import { useThemeColors } from "@/lib/theme";

const HOME_ROUTE = "/tasks";

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
