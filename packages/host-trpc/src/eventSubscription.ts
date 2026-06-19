export function eventToAsyncIterator<TEvent>(
  subscribe: (listener: (data: TEvent) => void) => void,
  unsubscribe: (listener: (...args: unknown[]) => void) => void,
  signal: AbortSignal | null | undefined,
  filter?: (data: TEvent) => boolean,
): AsyncIterable<TEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<TEvent> {
      let resolveNext: ((value: IteratorResult<TEvent>) => void) | null = null;
      const queue: TEvent[] = [];
      let done = false;

      const listener = (data: TEvent) => {
        if (filter && !filter(data)) return;
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r({ value: data, done: false });
        } else {
          queue.push(data);
        }
      };

      subscribe(listener);

      const cleanup = () => {
        done = true;
        unsubscribe(listener as (...args: unknown[]) => void);
        if (resolveNext) {
          resolveNext({ value: undefined as never, done: true });
          resolveNext = null;
        }
      };

      signal?.addEventListener("abort", cleanup);

      return {
        next(): Promise<IteratorResult<TEvent>> {
          if (done) {
            return Promise.resolve({ value: undefined as never, done: true });
          }
          if (queue.length > 0) {
            return Promise.resolve({
              value: queue.shift() as TEvent,
              done: false,
            });
          }
          return new Promise<IteratorResult<TEvent>>((r) => {
            resolveNext = r;
          });
        },
        return(): Promise<IteratorResult<TEvent>> {
          cleanup();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };
}
