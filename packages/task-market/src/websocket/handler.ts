import type { WebSocket } from "@fastify/websocket";

type Subscriber = {
  ws: WebSocket;
  channels: Set<string>;
};

const subscribers: Subscriber[] = [];

export function addSubscriber(ws: WebSocket, channels: string[]): void {
  const subscriber = { ws, channels: new Set(channels) };
  subscribers.push(subscriber);

  ws.on("close", () => {
    const index = subscribers.indexOf(subscriber);
    if (index !== -1) subscribers.splice(index, 1);
  });
}

export function removeSubscriber(ws: WebSocket): void {
  const index = subscribers.findIndex((s) => s.ws === ws);
  if (index !== -1) subscribers.splice(index, 1);
}

export function subscribe(ws: WebSocket, channel: string): void {
  const subscriber = subscribers.find((s) => s.ws === ws);
  if (subscriber) {
    subscriber.channels.add(channel);
  }
}

export function unsubscribe(ws: WebSocket, channel: string): void {
  const subscriber = subscribers.find((s) => s.ws === ws);
  if (subscriber) {
    subscriber.channels.delete(channel);
  }
}

export function broadcast(channel: string, event: string, data: unknown): void {
  const message = JSON.stringify({ channel, event, data, timestamp: new Date().toISOString() });

  for (const subscriber of subscribers) {
    if (subscriber.channels.has(channel) && subscriber.ws.readyState === 1) {
      subscriber.ws.send(message);
    }
  }
}

export function broadcastAll(event: string, data: unknown): void {
  const message = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  for (const subscriber of subscribers) {
    if (subscriber.ws.readyState === 1) {
      subscriber.ws.send(message);
    }
  }
}

export function handleWebSocketConnection(ws: WebSocket): void {
  addSubscriber(ws, []);

  ws.on("message", (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.type) {
        case "subscribe":
          if (msg.channel) subscribe(ws, msg.channel);
          ws.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
          break;
        case "unsubscribe":
          if (msg.channel) unsubscribe(ws, msg.channel);
          ws.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }));
          break;
        case "ping":
          ws.send(JSON.stringify({ type: "pong" }));
          break;
        default:
          ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
      }
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    }
  });
}
