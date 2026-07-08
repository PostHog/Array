import { Flex, Text } from "@radix-ui/themes";
import { useLoop } from "../hooks/useLoop";
import { LoopForm } from "./LoopForm";

export function EditLoopView({ loopId }: { loopId: string }) {
  const { data: loop, isLoading, isError } = useLoop(loopId);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-6">
        <div className="h-24 animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)" />
      </div>
    );
  }

  if (isError || !loop) {
    return (
      <Flex
        direction="column"
        align="center"
        gap="1"
        className="mx-auto mt-16 max-w-md rounded-(--radius-2) border border-(--gray-5) border-dashed px-6 py-10 text-center"
      >
        <Text className="font-medium text-[13px] text-gray-12">
          Couldn't load this loop
        </Text>
        <Text className="max-w-md text-[12px] text-gray-11 leading-snug">
          It may have been deleted, or the loops API returned an error.
        </Text>
      </Flex>
    );
  }

  return <LoopForm loop={loop} />;
}
