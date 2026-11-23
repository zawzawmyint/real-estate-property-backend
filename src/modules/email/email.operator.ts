import { pathToFileURL } from 'node:url';
import { readWorkerConfig } from './email.config.js';
import { createEmailCrypto } from './email.crypto.js';
import { createEmailRepository } from './email.repository.js';
import { openWorkerDatabase } from './email.worker.js';

export async function runEmailOperator(args: string[]) {
  const [command, ...flags] = args;
  if (
    !['inspect', 'replay'].includes(command ?? '') ||
    flags.some(
      (flag, index) =>
        !['--id', '--apply', '--acknowledge-duplicate-risk'].includes(flag) &&
        flags[index - 1] !== '--id',
    )
  )
    throw new Error('EMAIL_OPERATOR_ARGUMENTS');
  const index = flags.indexOf('--id');
  const id = flags[index + 1];
  if (index < 0 || !id || !/^[a-f0-9-]{36}$/i.test(id))
    throw new Error('EMAIL_OPERATOR_ARGUMENTS');
  const config = readWorkerConfig(process.env);
  const database = await openWorkerDatabase(config.databaseUrl);
  try {
    const repository = createEmailRepository(
      database,
      createEmailCrypto(config),
      config,
    );
    const result =
      command === 'inspect'
        ? await repository.inspect(id)
        : await repository.replay(
            id,
            flags.includes('--apply'),
            flags.includes('--acknowledge-duplicate-risk'),
            Date.now(),
          );
    console.info(JSON.stringify(result));
  } finally {
    await database.$disconnect();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runEmailOperator(process.argv.slice(2)).catch(() => {
    console.error('EMAIL_OPERATOR_FAILED');
    process.exitCode = 1;
  });
}
