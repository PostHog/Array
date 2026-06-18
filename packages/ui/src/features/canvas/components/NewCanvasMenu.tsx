import { PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@posthog/quill";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import { useCreateAndOpenDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { useState } from "react";

// "New canvas" entry point: opens a dialog to pick a template (Dashboard,
// Blank, …); the chosen template's agent context drives how the canvas is
// built. Falls back to a plain create (default template) until templates load.
export function NewCanvasMenu({
  channelId,
  variant = "outline",
}: {
  channelId: string | undefined;
  variant?: "outline" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const templates = useCanvasTemplates();
  const createAndOpen = useCreateAndOpenDashboard(channelId);

  if (templates.length === 0) {
    return (
      <Button
        variant={variant}
        size="sm"
        className="no-drag"
        onClick={() => void createAndOpen()}
      >
        <PlusIcon size={14} />
        New canvas
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={(props) => (
          <Button variant={variant} size="sm" className="no-drag" {...props} />
        )}
      >
        <PlusIcon size={14} />
        New canvas
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose a template</DialogTitle>
          <DialogDescription>
            This gives the agent context for which guardrails to follow when
            generating UI.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-2 [&_*[data-slot=scroll-area-viewport]]:py-0">
          {templates.map((t) => (
            <Button
              key={t.id}
              variant="default"
              className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal py-3 text-left"
              onClick={() => {
                setOpen(false);
                void createAndOpen({ templateId: t.id });
              }}
            >
              <span className="font-medium text-gray-12">{t.name}</span>
              <span className="font-normal text-gray-10 text-xs [text-wrap:initial]">
                {t.description}
              </span>
            </Button>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
