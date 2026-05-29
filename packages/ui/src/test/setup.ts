import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom does not implement PointerEvent; pointer-driven UI hooks (e.g.
// useImagePanAndZoom) rely on `pointerId` propagating from pointerdown through
// pointermove. Provide a MouseEvent-backed polyfill that carries it.
if (typeof globalThis.PointerEvent === "undefined") {
  class JsdomPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    width: number;
    height: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;
    isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "";
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
      this.tangentialPressure = init.tangentialPressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
      this.isPrimary = init.isPrimary ?? false;
    }
  }
  globalThis.PointerEvent = JsdomPointerEvent as unknown as typeof PointerEvent;
}

// jsdom does not implement matchMedia; UI stores (e.g. themeStore) read it at
// module load to resolve the system color scheme.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
});
