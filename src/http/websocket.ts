import { z } from "zod";
import type { PubSub } from "../pubsub";

type Socket = Bun.ServerWebSocket<undefined>;

export function websocketRoute<S extends z.ZodType>(
  schema: S,
  handlers: {
    open?: (socket: Socket) => void;
    message: (socket: Socket, message: z.output<S>) => void;
    close?: (socket: Socket, code: number, reason: string) => void;
  },
) {
  const websocket: Bun.WebSocketHandler<undefined> = {
    ...(handlers.open ? { open: (socket) => handlers.open!(socket) } : {}),
    message: (socket, raw) => {
      let value: unknown;
      try {
        value = typeof raw === "string"
          ? JSON.parse(raw)
          : JSON.parse(new TextDecoder().decode(raw instanceof ArrayBuffer ? raw : raw as Uint8Array));
      } catch {
        socket.close(1007, "Invalid message");
        return;
      }
      const parsed = schema.safeParse(value);
      if (!parsed.success) {
        socket.close(1007, "Invalid message");
        return;
      }
      handlers.message(socket, parsed.data);
    },
    ...(handlers.close ? { close: (socket, code, reason) => handlers.close!(socket, code, reason) } : {}),
  };
  return {
    websocket,
    fetch(request: Request, server: Bun.Server<undefined>): Response | undefined {
      if (server.upgrade(request)) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    },
  };
}

export function createWebSocketFanout<Events extends { [K in keyof Events]: unknown }, Event extends keyof Events>(
  pubsub: PubSub<Events>,
  event: Event,
): {
  attach(): Promise<() => Promise<void>>;
  add(socket: Bun.ServerWebSocket<undefined>): void;
  remove(socket: Bun.ServerWebSocket<undefined>): void;
  publish(payload: Events[Event]): Promise<void>;
  broadcast(payload: Events[Event]): void;
} {
  const sockets = new Set<Bun.ServerWebSocket<undefined>>();
  let detach: (() => Promise<void>) | undefined;
  return {
    attach: async () => {
      if (detach) throw new Error("WebSocket fan-out is already attached");
      const unsubscribe = await pubsub.subscribe(event, (payload) => {
        for (const socket of sockets) {
          try {
            socket.send(JSON.stringify(payload));
          } catch (cause) {
            sockets.delete(socket);
            console.error("WebSocket fan-out failed", cause);
          }
        }
      });
      detach = async () => {
        await unsubscribe();
        detach = undefined;
      };
      return detach;
    },
    add: (socket) => { sockets.add(socket); },
    remove: (socket) => { sockets.delete(socket); },
    publish: (payload) => pubsub.publish(event, payload),
    broadcast: (payload) => {
      for (const socket of sockets) socket.send(JSON.stringify(payload));
    },
  };
}
