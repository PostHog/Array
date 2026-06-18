import {
  createStateStore,
  getByPath,
  type StateStore,
} from "@json-render/core";
import {
  ActionProvider,
  type Spec,
  StateProvider,
  useStateStore,
  ValidationProvider,
  VisibilityProvider,
} from "@json-render/react";
import { type ReactNode, useMemo } from "react";

// Wraps a canvas walk in json-render's declarative-runtime contexts so the
// shared bodies (bodies.tsx) can resolve dynamic features via hooks:
//   - StateProvider     — the {$state}/{$bindState} state model (form fields).
//   - ActionProvider     — `on`/actions dispatch (built-ins: setState, pushState,
//                          removeState, validateForm).
//   - ValidationProvider — `validateForm` support.
//   - VisibilityProvider — `visible` condition evaluation.
//
// The store is seeded once from the spec's initial `state`; after that the store
// owns mutations (typing into a field must not be clobbered by a re-seed). It is
// re-seeded only when the spec's `state` object identity changes (a new board
// loads), not on every keystroke.
export function CanvasProviders({
  spec,
  children,
}: {
  spec: Spec;
  children: ReactNode;
}) {
  const store = useMemo<StateStore>(
    () => createStateStore((spec.state ?? {}) as Record<string, unknown>),
    [spec.state],
  );
  return (
    <StateProvider store={store}>
      <ActionProvider>
        <ValidationProvider>
          <VisibilityProvider>{children}</VisibilityProvider>
        </ValidationProvider>
      </ActionProvider>
    </StateProvider>
  );
}

// Replace `{ $state: "/path" }` refs in props with their live value from the
// state store so read-only dynamic text (e.g. an echoed form value) renders.
// `{ $bindState: … }` is left intact — the input bodies consume it for two-way
// binding. `repeat`/`$item`/`$index` are NOT handled yet (they degrade to
// empty via asText). Subscribes to state, so the node re-renders on change.
export function useResolvedProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const { state } = useStateStore();
  return useMemo(
    () => resolveStateRefs(props, state) as Record<string, unknown>,
    [props, state],
  );
}

function resolveStateRefs(
  value: unknown,
  state: Record<string, unknown>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => resolveStateRefs(v, state));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("$bindState" in obj) return obj; // two-way binding — leave for inputs
    if ("$state" in obj && typeof obj.$state === "string") {
      return getByPath(state, obj.$state);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj))
      out[k] = resolveStateRefs(v, state);
    return out;
  }
  return value;
}
