import {
  Cross2Icon,
  EnterFullScreenIcon,
  ExitFullScreenIcon,
} from "@radix-ui/react-icons";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Switch,
  Text,
  TextArea,
} from "@radix-ui/themes";
import { useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { useTabStore } from "../stores/tabStore";
import { useTaskStore } from "../stores/taskStore";

interface TaskCreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskCreate({ open, onOpenChange }: TaskCreateProps) {
  const { createTask, isLoading } = useTaskStore();
  const { createTab } = useTabStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const handleCreate = async () => {
    if (!title.trim() || !description.trim()) return;

    const newTask = await createTask(title, description);
    if (newTask) {
      createTab({
        type: "task-detail",
        title: newTask.title,
        data: newTask,
      });
      setTitle("");
      setDescription("");
      if (!createMore) {
        onOpenChange(false);
      }
    }
  };

  useHotkeys("mod+enter", handleCreate, {
    enabled: open,
    enableOnFormTags: true,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        maxHeight={isExpanded ? "90vh" : "600px"}
        height={isExpanded ? "90vh" : "auto"}
      >
        <Flex direction="column" height="100%">
          <Flex justify="between" align="center">
            <Dialog.Title className="mb-0" size="2">
              New Task
            </Dialog.Title>
            <Flex gap="2">
              <IconButton
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <ExitFullScreenIcon /> : <EnterFullScreenIcon />}
              </IconButton>
              <Dialog.Close>
                <IconButton size="1" variant="ghost" color="gray">
                  <Cross2Icon />
                </IconButton>
              </Dialog.Close>
            </Flex>
          </Flex>

          <Flex direction="column" gap="4" mt="4" flexGrow="1">
            <Flex direction="column" gap="2">
              <TextArea
                ref={titleRef}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleRef.current && !isExpanded) {
                    titleRef.current.style.height = "auto";
                    titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
                  }
                }}
                placeholder="Task title..."
                size="3"
                autoFocus
                rows={1}
                style={{
                  resize: "none",
                  overflow: "hidden",
                  minHeight: "auto",
                }}
              />
            </Flex>

            <Flex
              direction="column"
              gap="2"
              flexGrow="1"
              style={{ minHeight: 0 }}
            >
              <TextArea
                ref={descriptionRef}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  if (descriptionRef.current && !isExpanded) {
                    descriptionRef.current.style.height = "auto";
                    descriptionRef.current.style.height = `${descriptionRef.current.scrollHeight}px`;
                  }
                }}
                placeholder="Add description..."
                size="3"
                rows={3}
                style={{
                  resize: "none",
                  overflow: isExpanded ? "auto" : "hidden",
                  minHeight: "auto",
                  height: isExpanded ? "100%" : "auto",
                }}
              />
            </Flex>

            <Flex gap="3" justify="end" align="end">
              <Text as="label" size="1" style={{ cursor: "pointer" }}>
                <Flex gap="2" align="center" mb="2">
                  <Switch
                    checked={createMore}
                    onCheckedChange={setCreateMore}
                    size="1"
                  />
                  <Text size="1" color="gray" className="select-none">
                    Create more
                  </Text>
                </Flex>
              </Text>
              <Button
                variant="classic"
                onClick={handleCreate}
                disabled={!title.trim() || !description.trim() || isLoading}
              >
                {isLoading ? "Creating..." : "Create task"}
              </Button>
            </Flex>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
