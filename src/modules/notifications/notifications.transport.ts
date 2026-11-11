export interface NotificationSignalTransport {
  publish(recipientIds: readonly string[]): void | Promise<void>;
  subscribe(recipientId: string, changed: () => void): () => void;
}

export function createInProcessNotificationTransport(): NotificationSignalTransport {
  const subscriptions = new Map<string, Set<() => void>>();

  return {
    publish(recipientIds) {
      for (const id of recipientIds) {
        for (const changed of subscriptions.get(id) ?? []) changed();
      }
    },

    subscribe(recipientId, changed) {
      const listeners = subscriptions.get(recipientId) ?? new Set();
      subscriptions.set(recipientId, listeners);
      listeners.add(changed);

      return () => {
        listeners.delete(changed);
        if (
          listeners.size === 0 &&
          subscriptions.get(recipientId) === listeners
        )
          subscriptions.delete(recipientId);
      };
    },
  };
}
