import { Box, Flex, Text } from "@radix-ui/themes";
import beachHog from "@renderer/assets/images/hedgehogs/beach-hog.png";
import { WorkHomePrompt } from "./WorkHomePrompt";
import { WorkSampleProjects } from "./WorkSampleProjects";

export function WorkHome() {
  return (
    <Box className="scrollbar-overlay-y h-full w-full overflow-y-auto">
      <Flex
        direction="column"
        align="center"
        gap="6"
        className="mx-auto w-full max-w-[680px] px-6 pt-16 pb-12"
      >
        <Flex
          direction="column"
          align="center"
          gap="3"
          className="work-enter work-enter-1"
        >
          <img
            src={beachHog}
            alt=""
            className="h-28 w-auto select-none"
            draggable={false}
          />
          <Box className="text-center">
            <Text
              as="div"
              weight="medium"
              className="text-(--gray-12) text-[22px]"
            >
              Hello normie, what can I do for you today?
            </Text>
          </Box>
        </Flex>

        <Box className="work-enter work-enter-2 w-full">
          <WorkHomePrompt />
        </Box>

        <Box className="work-enter work-enter-3 w-full">
          <Text
            as="div"
            className="mb-2 text-center text-(--gray-10) text-[11px] uppercase tracking-wide"
          >
            Or if you're used to outsourcing your brain to Claude...
          </Text>
          <WorkSampleProjects />
        </Box>
      </Flex>
    </Box>
  );
}
