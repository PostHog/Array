import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { useState } from "react";

// The right-hand thread dock, shared by Activity and the channel feed. Slides
// in/out by animating the wrapper width so the list/feed reflows in lockstep —
// the same 200ms / cubic-bezier(0,0,0.2,1) the docked ResizableSidebar uses.
//
// `width: auto` once open so the inner ThreadSidebar keeps owning its resizable
// width. overflow-hidden is applied ONLY while animating: a permanent clip
// would swallow the ResizableSidebar's resize handle (it overhangs the panel's
// inner edge), so it must be gone once the panel is settled open.
//
// Caller guards the child with the same condition it passes as `open` (e.g.
// `{selected && <ThreadSidebar .../>}`) so nothing is evaluated while closed;
// AnimatePresence retains the previous child through the exit animation.
export function AnimatedThreadDock({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  // Start clipped so the first frame (width: 0, full-width child) can't spill.
  const [animating, setAnimating] = useState(true);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="thread"
          className={`h-full shrink-0 ${animating ? "overflow-hidden" : ""}`}
          initial={reduceMotion ? false : { width: 0, opacity: 0 }}
          animate={{ width: "auto", opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { width: 0, opacity: 0 }}
          transition={{
            duration: reduceMotion ? 0 : 0.2,
            ease: [0, 0, 0.2, 1],
          }}
          onAnimationStart={() => setAnimating(true)}
          onAnimationComplete={() => setAnimating(false)}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
