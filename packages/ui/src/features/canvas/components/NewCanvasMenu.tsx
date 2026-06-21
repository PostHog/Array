import { PlusIcon } from "@phosphor-icons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@posthog/quill";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import { useCanvasTemplates } from "@posthog/ui/features/canvas/hooks/useCanvasTemplates";
import { useCreateAndOpenDashboard } from "@posthog/ui/features/canvas/hooks/useDashboards";
import { track } from "@posthog/ui/shell/analytics";
import { useState } from "react";

// Fire the "create" DASHBOARD_ACTION, then create + open the canvas. Exported so
// other entry points (the sidebar "+" dropdown) report creation the same way.
export function trackAndCreateCanvas(
  channelId: string | undefined,
  templateId: string | undefined,
  create: () => void,
) {
  track(ANALYTICS_EVENTS.DASHBOARD_ACTION, {
    action_type: "create",
    surface: "dashboards_grid",
    channel_id: channelId,
    template_id: templateId,
  });
  create();
}

// Controlled template picker: lists canvas templates; choosing one creates +
// opens the canvas. Carries no trigger of its own so callers (the dashboards
// grid button, the sidebar "+" dropdown) can open it from wherever.
export function NewCanvasDialog({
  channelId,
  open,
  onOpenChange,
}: {
  channelId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const templates = useCanvasTemplates();
  const createAndOpen = useCreateAndOpenDashboard(channelId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                onOpenChange(false);
                trackAndCreateCanvas(
                  channelId,
                  t.id,
                  () => void createAndOpen({ templateId: t.id }),
                );
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

// "New canvas" entry point: a button that opens the template picker. Falls back
// to a plain create (default template) until templates load.
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
        onClick={() =>
          trackAndCreateCanvas(channelId, undefined, () => void createAndOpen())
        }
      >
        <PlusIcon size={14} />
        New canvas
      </Button>
    );
  }

  return (
    <>
      <Button
        variant={variant}
        size="sm"
        className="no-drag"
        onClick={() => setOpen(true)}
      >
        <PlusIcon size={14} />
        New canvas
      </Button>
      <NewCanvasDialog
        channelId={channelId}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
