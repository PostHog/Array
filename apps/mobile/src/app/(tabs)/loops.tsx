import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { InteractionManager, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingLoopsHeader } from "@/features/loops/components/FloatingLoopsHeader";
import { FloatingNewLoopButton } from "@/features/loops/components/FloatingNewLoopButton";
import { LoopList } from "@/features/loops/components/LoopList";
import { useLoops } from "@/features/loops/hooks/useLoops";

export default function LoopsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const readyRef = useRef(true);
  const { loops } = useLoops();
  const hasLoops = loops.length > 0;

  useFocusEffect(
    useCallback(() => {
      const handle = InteractionManager.runAfterInteractions(() => {
        readyRef.current = true;
      });
      return () => {
        readyRef.current = false;
        handle.cancel();
      };
    }, []),
  );

  const handleCreateLoop = useCallback(() => {
    if (!readyRef.current) return;
    readyRef.current = false;
    router.push("/loop/create");
  }, [router]);

  const handleLoopPress = useCallback(
    (loopId: string) => {
      if (!readyRef.current) return;
      readyRef.current = false;
      router.push(`/loop/${loopId}`);
    },
    [router],
  );

  // Matches FloatingAutomationsHeader: top inset + 6 (top pad) + 40 (button)
  // + 8 (bottom pad) plus a small visual buffer.
  const headerHeight = insets.top + 64;

  return (
    <View className="flex-1 bg-background">
      <LoopList
        onLoopPress={handleLoopPress}
        onCreateLoop={handleCreateLoop}
        contentInsetTop={headerHeight}
      />

      <FloatingLoopsHeader />

      {hasLoops ? <FloatingNewLoopButton onPress={handleCreateLoop} /> : null}
    </View>
  );
}
