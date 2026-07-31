import { useHostTRPC } from "@posthog/host-router/react";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useState } from "react";

export interface SelectedElement {
  pageUrl: string;
  element: {
    selectorHash: string;
    tag: string;
    dataAttr: string | null;
    id: string | null;
    classes: string[];
    href: string | null;
    text: string | null;
    nthChildPath: string;
  };
}

/** The element the user selected in inspect mode, from the host event stream. */
export function useSelectedElement(viewId: string) {
  const trpc = useHostTRPC();
  const [selected, setSelected] = useState<SelectedElement | null>(null);

  useSubscription(
    trpc.productView.onEvents.subscriptionOptions(undefined, {
      onData: (event) => {
        if (event.type === "element-selected" && event.viewId === viewId) {
          setSelected({ pageUrl: event.pageUrl, element: event.element });
        }
      },
    }),
  );

  return { selected, clear: () => setSelected(null) };
}
