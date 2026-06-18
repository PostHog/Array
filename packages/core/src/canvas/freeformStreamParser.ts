// Splits the freeform agent's streamed reply into prose and code. The agent
// writes a short sentence of prose then the whole app as ONE fenced ```tsx
// block (see the freeform system prompt), so we:
//   - extract the FIRST fenced code block's contents as the canvas code, and
//   - treat everything outside that block as prose.
// It re-scans the accumulated text on every push (cheap; canvases are small) and
// emits prose as deltas (append-only) and code as full snapshots (replace).

export interface FreeformStreamParser {
  push(chunk: string): void;
  /** Flush a trailing snapshot at end of turn (no-op if nothing changed). */
  flush(): void;
}

export interface FreeformStreamHandlers {
  onProse(text: string): void;
  onCode(code: string): void;
}

// Opening fence: ``` optionally followed by a language tag on the same line.
const FENCE = "```";

export function createFreeformStreamParser(
  handlers: FreeformStreamHandlers,
): FreeformStreamParser {
  let buffer = "";
  let emittedProseLen = 0;
  let lastCode: string | null = null;

  const recompute = () => {
    const { prose, code } = splitProseAndCode(buffer);

    // Prose is append-only: emit only the new suffix so the chat doesn't
    // duplicate. (Prose only grows as text accumulates.)
    if (prose.length > emittedProseLen) {
      const delta = prose.slice(emittedProseLen);
      emittedProseLen = prose.length;
      if (delta.trim().length > 0) handlers.onProse(delta);
    }

    if (code !== null && code !== lastCode) {
      lastCode = code;
      handlers.onCode(code);
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      recompute();
    },
    flush() {
      recompute();
    },
  };
}

// Extract the first fenced code block (its inner text) and the prose around it.
// While streaming, the closing fence may not have arrived yet; we still surface
// the partial code so the canvas updates live.
export function splitProseAndCode(text: string): {
  prose: string;
  code: string | null;
} {
  const openIdx = text.indexOf(FENCE);
  if (openIdx === -1) return { prose: text.trim(), code: null };

  // Skip the optional language tag on the fence line.
  const afterFence = text.indexOf("\n", openIdx);
  if (afterFence === -1) {
    // Fence just opened, no newline yet — code body hasn't started.
    return { prose: text.slice(0, openIdx).trim(), code: "" };
  }

  const codeStart = afterFence + 1;
  const closeIdx = text.indexOf(`\n${FENCE}`, codeStart);

  if (closeIdx === -1) {
    // Still streaming the code body (no closing fence yet).
    return {
      prose: text.slice(0, openIdx).trim(),
      code: text.slice(codeStart),
    };
  }

  const code = text.slice(codeStart, closeIdx);
  const proseBefore = text.slice(0, openIdx);
  const closeLineEnd = text.indexOf("\n", closeIdx + 1);
  const proseAfter = closeLineEnd === -1 ? "" : text.slice(closeLineEnd + 1);
  return { prose: (proseBefore + proseAfter).trim(), code };
}
