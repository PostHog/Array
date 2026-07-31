import { useHostTRPC } from "@posthog/host-router/react";
import { useCommandMenuStore } from "@posthog/ui/shell/commandMenuStore";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSubscription } from "@trpc/tanstack-react-query";
import { useEffect, useRef, useState } from "react";

export interface ProductViewPageState {
  viewId: string;
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

/** Live page state of one embedded view, seeded by query, kept fresh by the
 * host event stream. */
export function useProductViewPageState(viewId: string) {
  const trpc = useHostTRPC();
  const [pageState, setPageState] = useState<ProductViewPageState | null>(null);

  const { data: initial } = useQuery(
    trpc.productView.getPageState.queryOptions({ viewId }),
  );
  useEffect(() => {
    if (initial) setPageState((prev) => prev ?? initial);
  }, [initial]);

  useSubscription(
    trpc.productView.onEvents.subscriptionOptions(undefined, {
      onData: (event) => {
        if (event.type === "page-state" && event.state.viewId === viewId) {
          setPageState(event.state);
        }
      },
    }),
  );

  return pageState;
}

/**
 * Own the embedded view behind a slot element: open it once the slot has real
 * bounds, keep the native view glued to the slot's rect, and hide it while the
 * command menu is over it or the slot is unmounted. The native view paints
 * ABOVE the renderer, so visibility must be driven from here — nothing in the
 * DOM can cover it.
 */
export function useProductViewSlot(input: { viewId: string; url: string }) {
  const { viewId, url } = input;
  const trpc = useHostTRPC();
  const slotRef = useRef<HTMLDivElement | null>(null);
  const openedRef = useRef(false);

  const open = useMutation(trpc.productView.open.mutationOptions());
  const setBounds = useMutation(trpc.productView.setBounds.mutationOptions());
  const setVisible = useMutation(trpc.productView.setVisible.mutationOptions());
  const commandMenuOpen = useCommandMenuStore((s) => s.isOpen);

  const openMutate = open.mutateAsync;
  const setBoundsMutate = setBounds.mutate;
  const setVisibleMutate = setVisible.mutate;

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    let frame: number | null = null;
    let lastRect = "";

    const report = () => {
      frame = null;
      const rect = slot.getBoundingClientRect();
      const bounds = {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      if (bounds.width === 0 || bounds.height === 0) return;
      const key = JSON.stringify(bounds);
      if (key === lastRect) return;
      lastRect = key;
      if (!openedRef.current) {
        openedRef.current = true;
        void openMutate({ viewId, url, bounds }).catch(() => {
          openedRef.current = false;
        });
      } else {
        setBoundsMutate({ viewId, bounds });
      }
    };
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(report);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(slot);
    // Layout shifts that move the slot without resizing it (sidebar toggle,
    // panel collapse) resize an ancestor — observing the body catches them.
    observer.observe(document.body);
    window.addEventListener("resize", schedule);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame != null) cancelAnimationFrame(frame);
      // Keep the view (and the page in it) alive across tab switches; just
      // stop painting over whatever replaces this slot.
      setVisibleMutate({ viewId, visible: false });
      openedRef.current = false;
    };
  }, [viewId, url, openMutate, setBoundsMutate, setVisibleMutate]);

  // The command menu is a renderer overlay and cannot paint over the native
  // view — hide the view while the menu is open.
  useEffect(() => {
    if (!openedRef.current) return;
    setVisibleMutate({ viewId, visible: !commandMenuOpen });
  }, [commandMenuOpen, viewId, setVisibleMutate]);

  return slotRef;
}
