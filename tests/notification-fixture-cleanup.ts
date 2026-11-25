import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';

type NotificationFixtureResources = {
  streams: AbortController[];
  children: ChildProcess[];
  disposers: (() => Promise<void>)[];
  closeFixture(): Promise<void>;
};

export async function cleanupNotificationFixture(
  resources: NotificationFixtureResources,
) {
  const failures: unknown[] = [];
  const attempt = async (cleanup: () => void | Promise<void>) => {
    try {
      await cleanup();
    } catch (error) {
      failures.push(error);
    }
  };
  for (const stream of resources.streams.splice(0))
    await attempt(() => stream.abort());
  for (const child of resources.children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    await attempt(async () => {
      const exited = once(child, 'exit');
      let forced = false;
      const terminate = () => {
        forced = true;
        child.kill();
      };
      const timeout = setTimeout(terminate, 12000);
      try {
        if (!child.connected) terminate();
        else {
          try {
            child.send('stop', (error) => {
              if (error) terminate();
            });
          } catch {
            terminate();
          }
        }
        await exited;
        if (forced || child.signalCode !== null || child.exitCode !== 0)
          throw new Error(
            'API should shut down cleanly without forced termination',
          );
      } finally {
        clearTimeout(timeout);
      }
    });
  }
  for (const dispose of resources.disposers.splice(0)) await attempt(dispose);
  await attempt(resources.closeFixture);
  if (failures.length)
    throw new AggregateError(failures, 'Notification fixture cleanup failed');
}
