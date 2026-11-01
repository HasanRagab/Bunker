import type { Awaitable } from "./types";

type Handler<P> = (payload: P) => Awaitable<void>;

/** Fully typed in-process event bus. `Events` maps event name -> payload. */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  #handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    const set = this.#handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.#handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  async emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
    const set = this.#handlers.get(event);
    if (!set) return;
    await Promise.all([...set].map((h) => (h as Handler<Events[K]>)(payload)));
  }
}
