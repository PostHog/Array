import type {
  GithubActivityType,
  GridSize,
  HeadlineTilePatch,
  ProjectIconId,
  ProjectMember,
  Tile,
} from "@shared/types/work-projects";
import { ArtifactTile } from "./tiles/ArtifactTile";
import { FileTile } from "./tiles/FileTile";
import { GithubActivityTile } from "./tiles/GithubActivityTile";
import { HeadlineTile } from "./tiles/HeadlineTile";
import { InsightTile } from "./tiles/InsightTile";
import { NoteTile } from "./tiles/NoteTile";
import { TitleTile } from "./tiles/TitleTile";

interface TileRendererProps {
  tile: Tile;
  members: ProjectMember[];
  currentGridSize: GridSize;
  onRemove?: () => void;
  onResizeGrid?: (size: GridSize) => void;
  onApplyPending?: () => void;
  onRejectPending?: () => void;
  onUpdateTitleTile?: (patch: {
    name?: string;
    tagline?: string;
    iconId?: ProjectIconId;
  }) => void;
  onUpdateNoteTile?: (patch: {
    body?: string;
    tone?: "yellow" | "blue" | "green" | "pink" | "neutral";
  }) => void;
  onUpdateFileTile?: (patch: {
    title?: string;
    items?: Array<{ path: string; addedAt: string }>;
  }) => Promise<void>;
  onUpdateChecklistItems?: (
    items: Array<{ text: string; done: boolean }>,
  ) => void;
  onUpdateGithubActivityTile?: (patch: {
    repo?: { owner: string; name: string };
    enabledTypes?: GithubActivityType[];
    windowDays?: number;
  }) => Promise<void>;
  onRefreshGithubActivityTile?: () => Promise<void>;
  onUpdateHeadlineTile?: (patch: HeadlineTilePatch) => Promise<void>;
}

export function TileRenderer({
  tile,
  members,
  currentGridSize,
  onRemove,
  onResizeGrid,
  onApplyPending,
  onRejectPending,
  onUpdateTitleTile,
  onUpdateNoteTile,
  onUpdateFileTile,
  onUpdateChecklistItems,
  onUpdateGithubActivityTile,
  onRefreshGithubActivityTile,
  onUpdateHeadlineTile,
}: TileRendererProps) {
  switch (tile.type) {
    case "title":
      return (
        <TitleTile
          tile={tile}
          members={members}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateTitleTile}
        />
      );
    case "headline":
      return (
        <HeadlineTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateHeadlineTile}
        />
      );
    case "insight":
      return (
        <InsightTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
        />
      );
    case "file":
      return (
        <FileTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateFileTile}
        />
      );
    case "note":
      return (
        <NoteTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdate={onUpdateNoteTile}
        />
      );
    case "artifact":
      return (
        <ArtifactTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdateChecklistItems={onUpdateChecklistItems}
        />
      );
    case "github_activity":
      return (
        <GithubActivityTile
          tile={tile}
          currentGridSize={currentGridSize}
          onRemove={onRemove}
          onResizeGrid={onResizeGrid}
          onApplyPending={onApplyPending}
          onRejectPending={onRejectPending}
          onUpdateConfig={onUpdateGithubActivityTile}
          onRefresh={onRefreshGithubActivityTile}
        />
      );
  }
}
