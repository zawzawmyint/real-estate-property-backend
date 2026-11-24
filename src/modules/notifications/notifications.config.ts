export type NotificationTransportConfig =
  { mode: 'memory' } | { mode: 'redis'; redisUrl: string; channel: string };

export function readNotificationTransportConfig(
  input: Record<string, string | undefined>,
): NotificationTransportConfig {
  const invalid = (field: string): never => {
    throw new Error(`NOTIFICATION_CONFIG_INVALID: ${field}`);
  };
  const mode = input.NOTIFICATION_SIGNAL_TRANSPORT ?? 'memory';
  if (mode === 'memory') return { mode };
  if (mode !== 'redis') return invalid('NOTIFICATION_SIGNAL_TRANSPORT');

  const channel = input.NOTIFICATION_REDIS_CHANNEL;
  if (!channel || !/^[a-zA-Z0-9:_-]{1,128}$/.test(channel))
    return invalid('NOTIFICATION_REDIS_CHANNEL');

  const redisUrl = input.REDIS_URL;
  const url =
    redisUrl && redisUrl.trim() === redisUrl ? URL.parse(redisUrl) : null;
  if (
    !url ||
    !url.hostname ||
    !['redis:', 'rediss:'].includes(url.protocol) ||
    url.search ||
    url.hash ||
    !/^\/(?:\d+)?$|^$/.test(url.pathname) ||
    (input.NODE_ENV === 'production' &&
      (url.protocol !== 'rediss:' || !url.password))
  )
    return invalid('REDIS_URL');

  return { mode: 'redis', redisUrl: redisUrl!, channel };
}
