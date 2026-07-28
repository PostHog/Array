import { LayoutIcon, ListIcon, SquaresFourIcon } from "@phosphor-icons/react";
import {
  Button,
  ButtonGroup,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@posthog/quill";
import {
  type ArtifactsViewMode,
  useArtifactsViewStore,
} from "@posthog/ui/features/canvas/stores/artifactsViewStore";
import type { ComponentType } from "react";

const OPTIONS: {
  mode: ArtifactsViewMode;
  label: string;
  Icon: ComponentType<{ size?: number; weight?: "bold" }>;
}[] = [
  { mode: "list", label: "List", Icon: ListIcon },
  { mode: "grid", label: "Grid", Icon: SquaresFourIcon },
  { mode: "masonry", label: "Masonry", Icon: LayoutIcon },
];

// Segmented control over the artifacts layout: a ButtonGroup of outline buttons
// joined into one control, the active one tinted (the same data-[active] idiom
// the sidebar's Channels/List switch uses) since outline has no selected state.
export function ArtifactsViewToggle({ channelId }: { channelId?: string }) {
  const view = useArtifactsViewStore((s) => s.view);
  const setView = useArtifactsViewStore((s) => s.setView);

  return (
    <ButtonGroup aria-label="Artifacts view">
      {OPTIONS.map(({ mode, label, Icon }) => {
        const active = view === mode;
        return (
          <Tooltip key={mode}>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="text-gray-10 hover:text-gray-12 data-[active]:bg-accent-4 data-[active]:text-gray-12"
                  aria-label={`${label} view`}
                  aria-pressed={active}
                  data-active={active || undefined}
                  onClick={() => setView(mode, channelId)}
                >
                  <Icon size={14} weight="bold" />
                </Button>
              }
            />
            <TooltipContent side="bottom">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </ButtonGroup>
  );
}
