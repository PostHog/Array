import {
  type MouseEventHandler,
  type PointerEventHandler,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface UseImagePanAndZoomOptions {
  minScale?: number;
  maxScale?: number;
}

interface UseImagePanAndZoomResult {
  containerRef: RefObject<HTMLDivElement | null>;
  transform: string;
  isZoomed: boolean;
  reset: () => void;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
}

interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY: ZoomState = { scale: 1, tx: 0, ty: 0 };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function useImagePanAndZoom(
  options: UseImagePanAndZoomOptions = {},
): UseImagePanAndZoomResult {
  const minScale = options.minScale ?? 1;
  const maxScale = options.maxScale ?? 8;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<ZoomState>(IDENTITY);
  const stateRef = useRef(state);
  stateRef.current = state;
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTx: number;
    startTy: number;
  } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (event: WheelEvent) => {
      const isZoomGesture = event.ctrlKey || event.metaKey;

      if (isZoomGesture) {
        event.preventDefault();
        const rect = el.getBoundingClientRect();
        const cursorX = event.clientX - (rect.left + rect.width / 2);
        const cursorY = event.clientY - (rect.top + rect.height / 2);

        setState((prev) => {
          const nextScale = clamp(
            prev.scale * Math.exp(-event.deltaY * 0.01),
            minScale,
            maxScale,
          );
          if (nextScale === prev.scale) return prev;
          const ratio = nextScale / prev.scale;
          const nextTx = cursorX - (cursorX - prev.tx) * ratio;
          const nextTy = cursorY - (cursorY - prev.ty) * ratio;
          return nextScale === 1
            ? IDENTITY
            : { scale: nextScale, tx: nextTx, ty: nextTy };
        });
        return;
      }

      if (stateRef.current.scale <= 1) return;
      event.preventDefault();
      setState((prev) => ({
        scale: prev.scale,
        tx: prev.tx - event.deltaX,
        ty: prev.ty - event.deltaY,
      }));
    };

    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [minScale, maxScale]);

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      if (event.button !== 0) return;
      if (stateRef.current.scale <= 1) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTx: stateRef.current.tx,
        startTy: stateRef.current.ty,
      };
    },
    [],
  );

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setState((prev) => ({
        scale: prev.scale,
        tx: drag.startTx + dx,
        ty: drag.startTy + dy,
      }));
    },
    [],
  );

  const releaseDrag = useCallback<PointerEventHandler<HTMLDivElement>>(
    (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {}
      dragRef.current = null;
    },
    [],
  );

  const reset = useCallback(() => setState(IDENTITY), []);

  const onDoubleClick = useCallback<MouseEventHandler<HTMLDivElement>>(() => {
    setState(IDENTITY);
  }, []);

  return {
    containerRef,
    transform: `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`,
    isZoomed: state.scale > 1,
    reset,
    onPointerDown,
    onPointerMove,
    onPointerUp: releaseDrag,
    onPointerCancel: releaseDrag,
    onDoubleClick,
  };
}
