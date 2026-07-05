import { Plus, Sparkle } from "@phosphor-icons/react";
import {
  SITUATIONS,
  type SituationId,
  type WorkflowBindings,
} from "@posthog/core/workflow/schemas";
import { useWorkflowEditorStore } from "@posthog/ui/features/home/stores/workflowEditorStore";
import { Text } from "@radix-ui/themes";
import { createDefaultAction } from "./freshActionId";
import { SITUATION_TONE, STATION_LAYOUT } from "./workflowMapLayout";

interface Props {
  id: SituationId;
  bindings: WorkflowBindings;
}

export function SituationStation({ id, bindings }: Props) {
  const layout = STATION_LAYOUT[id];
  const tone = SITUATION_TONE[id];
  const meta = SITUATIONS.find((s) => s.id === id);
  const actions = bindings?.[id] ?? [];

  const selectAction = useWorkflowEditorStore((s) => s.selectAction);
  const selectSituation = useWorkflowEditorStore((s) => s.selectSituation);
  const addAction = useWorkflowEditorStore((s) => s.addAction);
  const selection = useWorkflowEditorStore((s) => s.selection);

  const isStationSelected =
    selection?.kind === "situation" && selection.situationId === id;
  const isHostingSelectedAction =
    selection?.kind === "action" && selection.situationId === id;

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    const newAction = createDefaultAction(actions.map((a) => a.id));
    addAction(id, newAction);
    selectAction({
      kind: "action",
      situationId: id,
      actionId: newAction.id,
    });
  }

  function handleChip(e: React.MouseEvent, actionId: string) {
    e.stopPropagation();
    selectAction({
      kind: "action",
      situationId: id,
      actionId,
    });
  }

  function handleStation() {
    selectSituation(id);
  }

  return (
    <button
      type="button"
      onClick={handleStation}
      className={`absolute rounded-lg border ${tone.accent} ${tone.bg} cursor-pointer px-3 py-2.5 text-left shadow-md transition-shadow hover:shadow-lg ${
        isStationSelected || isHostingSelectedAction
          ? "ring-(--accent-9) ring-2 ring-offset-(--gray-2) ring-offset-1"
          : ""
      }`}
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
      }}
      aria-label={`${meta?.label ?? id} – ${actions.length} action${actions.length === 1 ? "" : "s"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <Text
          className={`font-semibold text-[11px] uppercase tracking-wider ${tone.label}`}
        >
          {meta?.label ?? id}
        </Text>
        <Text className="font-mono text-[9px] text-gray-9">{id}</Text>
      </div>
      <Text
        className="mt-0.5 line-clamp-1 text-[10px] text-gray-10"
        title={meta?.description}
      >
        {meta?.description}
      </Text>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {actions.map((action) => {
          const isChipSelected =
            selection?.kind === "action" &&
            selection.situationId === id &&
            selection.actionId === action.id;
          const incomplete = action.prompt.trim() === "";
          return (
            <button
              type="button"
              key={action.id}
              onClick={(e) => handleChip(e, action.id)}
              className={`flex max-w-[150px] items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                isChipSelected
                  ? "border-(--accent-9) bg-(--accent-3) text-(--accent-12)"
                  : incomplete
                    ? "border-(--amber-8) bg-(--amber-4) text-(--amber-11)"
                    : "border-(--gray-7) bg-(--color-panel-solid) text-gray-12 hover:border-(--gray-9)"
              }`}
              title={
                action.skillId
                  ? `${action.label} · ${action.skillId}`
                  : action.label
              }
            >
              <Sparkle size={9} />
              <span className="truncate">{action.label || "(no label)"}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={handleAdd}
          className="flex items-center gap-1 rounded-full border border-(--gray-8) border-dashed bg-transparent px-2 py-0.5 text-[11px] text-gray-11 transition-colors hover:border-(--gray-10) hover:bg-(--color-panel-solid) hover:text-gray-12"
          title="Bind a skill to this situation"
        >
          <Plus size={9} />
          Add
        </button>
      </div>
    </button>
  );
}
