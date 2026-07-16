import { insforge, isInsForgeConfigured } from '../insforge';
import type { RealtimeEventName } from './types';

type EventHandler = (payload: Record<string, unknown>) => void;

const subscriptions = new Set<string>();
const subscribeInflight = new Map<
  string,
  Promise<{ ok: boolean; members: Array<{ presenceId: string; type: string; joinedAt: string }> }>
>();
const channelMembers = new Map<
  string,
  Array<{ presenceId: string; type: string; joinedAt: string }>
>();
const boundHandlers = new Map<string, Map<EventHandler, EventHandler>>();
const presenceUnsubs = new Set<() => void>();
let connectPromise: Promise<boolean> | null = null;

export function isRealtimeAvailable(): boolean {
  return isInsForgeConfigured && insforge !== null;
}

export async function connect(): Promise<boolean> {
  if (!isRealtimeAvailable() || !insforge) {
    return false;
  }

  if (insforge.realtime.isConnected) {
    return true;
  }

  if (!connectPromise) {
    connectPromise = insforge.realtime
      .connect()
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        connectPromise = null;
      });
  }

  return connectPromise;
}

export async function subscribe(
  channel: string,
): Promise<{ ok: boolean; members: Array<{ presenceId: string; type: string; joinedAt: string }> }> {
  if (!isRealtimeAvailable() || !insforge) {
    return { ok: false, members: [] };
  }

  if (subscriptions.has(channel)) {
    return { ok: true, members: channelMembers.get(channel) ?? [] };
  }

  const pending = subscribeInflight.get(channel);
  if (pending) {
    return pending;
  }

  const work = (async () => {
    const connected = await connect();
    if (!connected) {
      return { ok: false, members: [] };
    }

    if (subscriptions.has(channel)) {
      return { ok: true, members: channelMembers.get(channel) ?? [] };
    }

    const response = await insforge!.realtime.subscribe(channel);
    if (!response.ok) {
      return { ok: false, members: [] };
    }

    const members = response.presence?.members ?? [];
    subscriptions.add(channel);
    channelMembers.set(channel, members);
    return { ok: true, members };
  })().finally(() => {
    subscribeInflight.delete(channel);
  });

  subscribeInflight.set(channel, work);
  return work;
}

export function onEvent(event: RealtimeEventName, handler: EventHandler): () => void {
  if (!insforge) {
    return () => {};
  }

  const wrapped = (payload: Record<string, unknown>) => handler(payload);
  insforge.realtime.on(event, wrapped);

  if (!boundHandlers.has(event)) {
    boundHandlers.set(event, new Map());
  }
  boundHandlers.get(event)!.set(handler, wrapped);

  return () => offEvent(event, handler);
}

export function offEvent(event: RealtimeEventName, handler: EventHandler): void {
  if (!insforge) return;

  const eventHandlers = boundHandlers.get(event);
  const wrapped = eventHandlers?.get(handler);
  if (wrapped) {
    insforge.realtime.off(event, wrapped);
    eventHandlers?.delete(handler);
  }
}

export function onPresenceJoin(
  handler: (message: { member: { presenceId: string; type: string }; meta: { channel: string } }) => void,
): () => void {
  if (!insforge) return () => {};
  insforge.realtime.on('presence:join', handler);
  const unsub = () => {
    insforge?.realtime.off('presence:join', handler);
    presenceUnsubs.delete(unsub);
  };
  presenceUnsubs.add(unsub);
  return unsub;
}

export function onPresenceLeave(
  handler: (message: { member: { presenceId: string }; meta: { channel: string } }) => void,
): () => void {
  if (!insforge) return () => {};
  insforge.realtime.on('presence:leave', handler);
  const unsub = () => {
    insforge?.realtime.off('presence:leave', handler);
    presenceUnsubs.delete(unsub);
  };
  presenceUnsubs.add(unsub);
  return unsub;
}

export function cleanup(): void {
  if (!insforge) return;

  for (const channel of subscriptions) {
    try {
      insforge.realtime.unsubscribe(channel);
    } catch {
      // ignore
    }
  }
  subscriptions.clear();
  subscribeInflight.clear();
  channelMembers.clear();

  for (const [event, handlers] of boundHandlers) {
    for (const wrapped of handlers.values()) {
      insforge.realtime.off(event as RealtimeEventName, wrapped);
    }
  }
  boundHandlers.clear();

  for (const unsub of [...presenceUnsubs]) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  presenceUnsubs.clear();

  if (insforge.realtime.isConnected) {
    insforge.realtime.disconnect();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', cleanup);
}
