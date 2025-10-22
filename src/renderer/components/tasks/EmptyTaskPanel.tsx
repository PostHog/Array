import { FileTextIcon } from "@radix-ui/react-icons";
import { Box, Flex } from "@radix-ui/themes";
import { useState } from "react";
import { AsciiArt } from "../AsciiArt";
import { ShortcutCard } from "../ShortcutCard";
import { TaskCreate } from "./TaskCreate";

export function EmptyTaskPanel() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  return (
    <>
      <Box
        width="30%"
        height="100%"
        className="bg-panel-solid"
        style={{ position: "relative" }}
      >
        {/* Background ASCII Art */}
        <Box style={{ position: "absolute", inset: 0, zIndex: 0 }}>
          <AsciiArt scale={0.7} opacity={0.1} />
        </Box>
        {/* Foreground Cards */}
        <Box
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Flex direction="column" gap="4" p="6">
            <Box onClick={() => setIsCreateOpen(true)}>
              <ShortcutCard
                icon={<FileTextIcon className="h-4 w-4 text-gray-11" />}
                title="New task"
                keys={[navigator.platform.includes("Mac") ? "⌘" : "Ctrl", "N"]}
              />
            </Box>
          </Flex>
        </Box>
      </Box>

      <TaskCreate open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </>
  );
}
