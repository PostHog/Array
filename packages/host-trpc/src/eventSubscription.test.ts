import { describe, expect, it, vi } from "vitest";
import { eventToAsyncIterator } from "./eventSubscription";

function makeEmitter<T>() {
  const box = { emit: (_data: T) => {} };
  const subscribe = (listener: (data: T) => void) => {
    box.emit = listener;
  };
  return { box, subscribe };
}

describe("eventToAsyncIterator", () => {
  it("yields events emitted by the subscribe callback", async () => {
    const { box, subscribe } = makeEmitter<number>();
    const unsubscribe = vi.fn();

    const iter = eventToAsyncIterator(subscribe, unsubscribe, null);

    const nextPromise = iter[Symbol.asyncIterator]().next();
    box.emit(42);
    expect(await nextPromise).toEqual({ value: 42, done: false });
  });

  it("queues events emitted before next() is called", async () => {
    const { box, subscribe } = makeEmitter<number>();
    const unsubscribe = vi.fn();

    const iter = eventToAsyncIterator(subscribe, unsubscribe, null);
    const iterator = iter[Symbol.asyncIterator]();

    box.emit(1);
    box.emit(2);
    box.emit(3);

    expect(await iterator.next()).toEqual({ value: 1, done: false });
    expect(await iterator.next()).toEqual({ value: 2, done: false });
    expect(await iterator.next()).toEqual({ value: 3, done: false });
  });

  it("filters events using the filter predicate", async () => {
    const { box, subscribe } = makeEmitter<number>();
    const unsubscribe = vi.fn();

    const iter = eventToAsyncIterator(
      subscribe,
      unsubscribe,
      null,
      (n) => n % 2 === 0,
    );
    const iterator = iter[Symbol.asyncIterator]();

    box.emit(1);
    box.emit(2);
    box.emit(3);
    box.emit(4);

    expect(await iterator.next()).toEqual({ value: 2, done: false });
    expect(await iterator.next()).toEqual({ value: 4, done: false });
  });

  it("stops iteration when abort signal fires while waiting for next event", async () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    const controller = new AbortController();

    const iter = eventToAsyncIterator(
      subscribe,
      unsubscribe,
      controller.signal,
    );
    const iterator = iter[Symbol.asyncIterator]();

    const nextPromise = iterator.next();
    controller.abort();

    expect(await nextPromise).toEqual({ value: undefined, done: true });
  });

  it("calls unsubscribe when abort signal fires", () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    const controller = new AbortController();

    const iter = eventToAsyncIterator(
      subscribe,
      unsubscribe,
      controller.signal,
    );
    iter[Symbol.asyncIterator]();

    expect(unsubscribe).not.toHaveBeenCalled();
    controller.abort();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("calls unsubscribe when return() is called", async () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();

    const iter = eventToAsyncIterator(subscribe, unsubscribe, null);
    const iterator = iter[Symbol.asyncIterator]();

    await iterator.return?.();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("returns done:true after return() is called", async () => {
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();

    const iter = eventToAsyncIterator(subscribe, unsubscribe, null);
    const iterator = iter[Symbol.asyncIterator]();

    await iterator.return?.();
    const result = await iterator.next();

    expect(result).toEqual({ value: undefined, done: true });
  });

  it("supports for-await-of with multiple events", async () => {
    const { box, subscribe } = makeEmitter<string>();
    const unsubscribe = vi.fn();
    const controller = new AbortController();

    const iter = eventToAsyncIterator(
      subscribe,
      unsubscribe,
      controller.signal,
    );

    const results: string[] = [];
    const consuming = (async () => {
      for await (const val of iter) {
        results.push(val);
        if (results.length === 3) controller.abort();
      }
    })();

    box.emit("a");
    box.emit("b");
    box.emit("c");

    await consuming;
    expect(results).toEqual(["a", "b", "c"]);
  });
});
