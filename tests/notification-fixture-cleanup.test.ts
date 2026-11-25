import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanupNotificationFixture } from './notification-fixture-cleanup.js';

class ApiChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  send = vi.fn((_message: string, callback?: (error: Error | null) => void) => {
    callback?.(null);
    this.exitCode = this.result;
    this.emit('exit', this.exitCode, null);
    return true;
  });
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    this.emit('exit', null, this.signalCode);
    return true;
  });
  constructor(private result = 0) {
    super();
  }
}
const asChild = (child: ApiChild) => child as unknown as ChildProcess;
afterEach(() => vi.useRealTimers());

it('reports a failed child only after releasing later children, streams and fixtures', async () => {
  vi.useFakeTimers();
  const failed = new ApiChild(1);
  const healthy = new ApiChild();
  const stream = new AbortController();
  const dispose = vi.fn(async () => {});
  const closeFixture = vi.fn(async () => {});
  const resources = {
    children: [asChild(failed), asChild(healthy)],
    streams: [stream],
    disposers: [dispose],
    closeFixture,
  };
  const failure = await cleanupNotificationFixture(resources).catch(
    (error) => error,
  );
  expect(healthy.send).toHaveBeenCalledOnce();
  expect(stream.signal.aborted).toBe(true);
  expect(dispose).toHaveBeenCalledOnce();
  expect(closeFixture).toHaveBeenCalledOnce();
  expect(resources.children).toHaveLength(0);
  expect(resources.disposers).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(failure).toBeInstanceOf(AggregateError);
});

it('continues after forced termination and clears all shutdown timers', async () => {
  vi.useFakeTimers();
  const stalled = new ApiChild();
  stalled.send.mockImplementation(() => true);
  const healthy = new ApiChild();
  const closeFixture = vi.fn(async () => {});
  const work = cleanupNotificationFixture({
    children: [asChild(stalled), asChild(healthy)],
    streams: [],
    disposers: [],
    closeFixture,
  });
  const assertion = expect(work).rejects.toThrow(AggregateError);
  await vi.advanceTimersByTimeAsync(12000);
  await assertion;
  expect(stalled.kill).toHaveBeenCalledOnce();
  expect(healthy.send).toHaveBeenCalledOnce();
  expect(closeFixture).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('collects disposer and database failures without skipping later cleanup', async () => {
  const firstError = new Error('proxy failed');
  const databaseError = new Error('database failed');
  const remaining = vi.fn(async () => {});
  const closeFixture = vi.fn(async () => {
    throw databaseError;
  });
  const work = cleanupNotificationFixture({
    children: [],
    streams: [],
    disposers: [
      async () => {
        throw firstError;
      },
      remaining,
    ],
    closeFixture,
  });
  await expect(work).rejects.toMatchObject({
    errors: [firstError, databaseError],
  });
  expect(remaining).toHaveBeenCalledOnce();
  expect(closeFixture).toHaveBeenCalledOnce();
});

it('terminates an owned child when IPC is unavailable and still cleans later resources', async () => {
  vi.useFakeTimers();
  const child = new ApiChild();
  child.connected = false;
  const closeFixture = vi.fn(async () => {});
  await expect(
    cleanupNotificationFixture({
      children: [asChild(child)],
      streams: [],
      disposers: [],
      closeFixture,
    }),
  ).rejects.toThrow(AggregateError);
  expect(child.send).not.toHaveBeenCalled();
  expect(child.kill).toHaveBeenCalledOnce();
  expect(closeFixture).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('falls back to termination when IPC send throws or reports an asynchronous error', async () => {
  vi.useFakeTimers();
  for (const asynchronous of [false, true]) {
    const child = new ApiChild();
    child.send.mockImplementation((_message, callback) => {
      if (!asynchronous) throw new Error('IPC closed');
      queueMicrotask(() => callback?.(new Error('IPC closed')));
      return true;
    });
    const closeFixture = vi.fn(async () => {});
    await expect(
      cleanupNotificationFixture({
        children: [asChild(child)],
        streams: [],
        disposers: [],
        closeFixture,
      }),
    ).rejects.toThrow(AggregateError);
    expect(child.kill).toHaveBeenCalledOnce();
    expect(closeFixture).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  }
});
