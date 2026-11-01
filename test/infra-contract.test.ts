import { afterEach, describe, expect, it } from "bun:test";
import { createClient } from "redis";
import { z } from "zod";
import {
  memoryLock,
  memoryPubSub,
  redisLock,
  redisPubSub,
  type Lock,
  type PubSub,
  type RedisClient,
} from "../src/infra";

const schemas = { changed: z.object({ id: z.string() }) };
type EventPayloads = { changed: { id: string } };
const redisUrl = Bun.env.REDIS_URL;
const liveClients: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(liveClients.splice(0).map((close) => close()));
});

interface Drivers {
  readonly lock: Lock;
  readonly pubsub: PubSub<EventPayloads>;
  close(): Promise<void>;
}

type DriverFactory = () => Promise<Drivers>;

function registerContract(name: string, create: DriverFactory, skipped = false): void {
  describe(`${name} contracts`, () => {
    it.skipIf(skipped)("acquires, excludes, and releases locks", async () => {
      const { lock } = await create();
      const first = await lock.acquire("contract-lock", 2_000);
      expect(first).not.toBeNull();
      expect(await lock.acquire("contract-lock", 2_000)).toBeNull();
      await first?.release();
      expect(await lock.acquire("contract-lock", 2_000)).not.toBeNull();
    });

    it.skipIf(skipped)("validates pub/sub payloads and delivers subscribed events", async () => {
      const { pubsub, close } = await create();
      const received: string[] = [];
      const unsubscribe = await pubsub.subscribe("changed", ({ id }) => { received.push(id); });
      await pubsub.publish("changed", { id: "contract-event" });
      const deadline = Date.now() + 1_000;
      while (received.length === 0 && Date.now() < deadline) await Bun.sleep(5);
      expect(received).toEqual(["contract-event"]);
      await unsubscribe();
      await close();
    });
  });
}

registerContract("memory", async () => ({
  lock: memoryLock(),
  pubsub: memoryPubSub(schemas),
  close: async () => {},
}));

registerContract("Redis", async () => {
  if (!redisUrl) throw new Error("REDIS_URL is required for Redis driver contract tests");
  const publisher = createClient({ url: redisUrl });
  const subscriber = publisher.duplicate();
  liveClients.push(
    async () => { if (publisher.isOpen) await publisher.quit(); },
    async () => { if (subscriber.isOpen) await subscriber.quit(); },
  );
  await Promise.all([publisher.connect(), subscriber.connect()]);
  const prefix = `bunker:test:${crypto.randomUUID()}:`;
  const publisherAdapter: RedisClient = {
    get: (key) => publisher.get(key),
    set: (key, value, options) => publisher.set(key, value, options),
    del: (key) => publisher.del(key),
    eval: (script, options) => publisher.eval(script, options),
    publish: (channel, message) => publisher.publish(channel, message),
    subscribe: (channel, listener) => publisher.subscribe(channel, listener),
    unsubscribe: (channel) => publisher.unsubscribe(channel),
  };
  const subscriberAdapter: RedisClient = {
    get: (key) => subscriber.get(key),
    set: (key, value, options) => subscriber.set(key, value, options),
    del: (key) => subscriber.del(key),
    eval: (script, options) => subscriber.eval(script, options),
    publish: (channel, message) => subscriber.publish(channel, message),
    subscribe: (channel, listener) => subscriber.subscribe(channel, listener),
    unsubscribe: (channel) => subscriber.unsubscribe(channel),
  };
  return {
    lock: redisLock(publisherAdapter, `${prefix}lock:`),
    pubsub: redisPubSub(publisherAdapter, subscriberAdapter, schemas, { prefix: `${prefix}events:` }),
    close: async () => {},
  };
}, !redisUrl);
