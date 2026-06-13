import type { Spec } from "@json-render/react";
import {
  type BodyCtx,
  type ElementOn,
  PLAIN_CTX,
  renderBody,
} from "@posthog/ui/features/canvas/genui/bodies";
import {
  CanvasProviders,
  useResolvedProps,
} from "@posthog/ui/features/canvas/genui/CanvasProviders";
import { isEditableTextProp } from "@posthog/ui/features/canvas/genui/editable";
import { useCanvasChatStore } from "@posthog/ui/features/canvas/stores/canvasChatStore";
import { Tooltip } from "@radix-ui/themes";
import { type ReactNode, useRef } from "react";

// Stable empty-props ref so the resolve hook can run unconditionally (even for a
// missing element) without re-resolving on every render.
const EMPTY_PROPS: Record<string, unknown> = {};

// Edit-mode renderer: a thin recursive walk over the json-render Spec (the map
// key IS the element id, which createRenderer doesn't expose). Each element is
// rendered via the SAME presentational bodies as view mode (bodies.tsx), wrapped
// with a hover frame and inline text editors.
//
// `interactive` is false while the agent streams — affordances collapse to a
// plain (view-identical) render so user edits can't race the incoming snapshots.
export function EditRenderer({
  spec,
  threadId,
  interactive,
}: {
  spec: Spec;
  threadId: string;
  interactive: boolean;
}) {
  return (
    <CanvasProviders spec={spec}>
      <EditNode
        spec={spec}
        threadId={threadId}
        elementKey={spec.root}
        parentKey={null}
        interactive={interactive}
      />
    </CanvasProviders>
  );
}

function EditNode({
  spec,
  threadId,
  elementKey,
  parentKey,
  interactive,
}: {
  spec: Spec;
  threadId: string;
  elementKey: string;
  parentKey: string | null;
  interactive: boolean;
}) {
  const element = spec.elements[elementKey];
  // Resolve {$state} reads for display (live echo while building). Hooks must run
  // unconditionally, so call before the missing-element guard. Editability still
  // keys off the RAW props (makeEditCtx below), so a {$state} value stays
  // non-editable — only literal text is inline-editable.
  const resolvedProps = useResolvedProps(element?.props ?? EMPTY_PROPS);
  if (!element) {
    // A parent lists this key in `children` but no element is defined for it
    // (a dangling reference). View mode renders nothing; edit mode surfaces it
    // so the gap is obvious instead of a mysterious empty card.
    return interactive ? (
      <BrokenRef label={`missing element "${elementKey}"`} />
    ) : null;
  }

  const childKeys = element.children ?? [];
  const children =
    childKeys.length > 0
      ? childKeys.map((childKey) => (
          <EditNode
            key={childKey}
            spec={spec}
            threadId={threadId}
            elementKey={childKey}
            parentKey={elementKey}
            interactive={interactive}
          />
        ))
      : undefined;

  const ctx: BodyCtx = interactive
    ? makeEditCtx(threadId, elementKey, element.type, element.props)
    : PLAIN_CTX;

  const body = renderBody(
    element.type,
    resolvedProps,
    children,
    ctx,
    element.on as ElementOn | undefined,
  );
  // renderBody returns null for a component type not in the catalog. Stay silent
  // in view mode; flag it in edit mode so unknown types aren't invisible.
  if (body == null) {
    return interactive ? (
      <BrokenRef label={`unknown component "${element.type}"`} />
    ) : null;
  }

  // Root renders bare; children get a hover frame to signal they're editable.
  if (!interactive || parentKey === null) return body;
  return <HoverFrame>{body}</HoverFrame>;
}

function makeEditCtx(
  threadId: string,
  elementKey: string,
  type: string,
  props: Record<string, unknown>,
): BodyCtx {
  return {
    text: (propPath, value) => (
      <InlineText
        key={`${elementKey}${propPath}`}
        threadId={threadId}
        elementKey={elementKey}
        propPath={propPath}
        value={value}
        multiline={type === "Text"}
        editable={isEditableTextProp(type, propPath, props)}
      />
    ),
    data: (node) => <DataHint>{node}</DataHint>,
  };
}

// Edit-mode-only marker for a structural gap (dangling child / unknown type) so
// it reads as a clear warning instead of an unexplained empty space.
function BrokenRef({ label }: { label: string }) {
  return (
    <div className="rounded border border-amber-6 border-dashed bg-amber-2 px-3 py-2 text-amber-11 text-xs">
      ⚠ {label}
    </div>
  );
}

function HoverFrame({ children }: { children: ReactNode }) {
  return (
    // h-full on both layers so a Card child fills its stretched grid cell.
    <div className="group/edit relative h-full">
      <div className="h-full rounded outline-1 outline-transparent outline-offset-2 transition-[outline-color] group-hover/edit:outline-accent-7">
        {children}
      </div>
    </div>
  );
}

function InlineText({
  threadId,
  elementKey,
  propPath,
  value,
  editable,
  multiline,
}: {
  threadId: string;
  elementKey: string;
  propPath: string;
  value: string;
  editable: boolean;
  multiline: boolean;
}) {
  const setElementProp = useCanvasChatStore((s) => s.setElementProp);
  const ref = useRef<HTMLSpanElement>(null);
  const original = useRef(value);

  if (!editable) return <>{value}</>;

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    let text = el.textContent ?? "";
    if (!multiline) text = text.replace(/\s*\n\s*/g, " ");
    if (text !== original.current) {
      setElementProp(threadId, elementKey, propPath, text);
      original.current = text;
    }
  };

  return (
    <>
      {/* An inline contentEditable span (not <input>) so text edits inherit the
          surrounding typography in place. */}
      {/* biome-ignore lint/a11y/useSemanticElements: an inline editable text node must stay a span to keep its typography */}
      <span
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        tabIndex={0}
        spellCheck={false}
        className="cursor-text rounded-sm px-0.5 outline-none hover:bg-gray-3 focus:bg-gray-3"
        style={multiline ? { whiteSpace: "pre-wrap" } : undefined}
        onFocus={() => {
          original.current = ref.current?.textContent ?? value;
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !multiline) {
            e.preventDefault();
            ref.current?.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (ref.current) ref.current.textContent = original.current;
            ref.current?.blur();
          }
        }}
      >
        {value}
      </span>
    </>
  );
}

function DataHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip content="Data — from query">
      <span className="rounded-sm outline-dashed outline-1 outline-transparent hover:outline-gray-7">
        {children}
      </span>
    </Tooltip>
  );
}
