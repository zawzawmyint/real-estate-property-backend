import { createInterface, emitKeypressEvents } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { parseEnv } from '../src/config/env.js';
import { createStaffAuth, isStaffRole } from '../src/modules/auth/auth.js';
import { createStaffOperator } from '../src/modules/auth/staff-operator.js';

async function prompt(label: string) {
  const input = createInterface({ input: stdin, output: stdout });

  try {
    return await new Promise<string>((resolve) =>
      input.question(label, resolve),
    );
  } finally {
    input.close();
  }
}

async function password(label: string) {
  if (!stdin.isTTY)
    throw new Error('Password entry requires an interactive terminal');

  stdout.write(label);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const keypress = (
        text: string | undefined,
        key: { name?: string; ctrl?: boolean },
      ) => {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          reject(new Error('Cancelled'));
        } else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          resolve(value);
        } else if (key.name === 'backspace') {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (
          text &&
          !key.ctrl &&
          Array.from(text).every(
            (character) =>
              character.codePointAt(0)! >= 32 &&
              character.codePointAt(0) !== 127,
          )
        ) {
          value += text;
          stdout.write('*'.repeat(text.length));
        }
      };
      const cleanup = () => {
        stdin.off('keypress', keypress);
        stdout.write('\n');
      };

      stdin.on('keypress', keypress);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

const command = process.argv[2];

if (
  !['bootstrap-admin', 'create', 'reset-password', 'deactivate'].includes(
    command ?? '',
  ) ||
  process.argv.length !== 3
) {
  console.error(
    'Usage: bun run staff -- bootstrap-admin|create|reset-password|deactivate',
  );
  process.exitCode = 1;
} else {
  const env = parseEnv(process.env);
  const database = await createDatabase(env.DATABASE_URL);

  try {
    const operator = createStaffOperator(
      createStaffAuth(env, database),
      database,
    );
    const email = await prompt('Email: ');

    if (command === 'deactivate') await operator.deactivate(email);
    else {
      const name =
        command === 'reset-password'
          ? undefined
          : await prompt('Display name: ');
      const role =
        command === 'create'
          ? await prompt('Role (admin/manager/agent): ')
          : 'admin';

      if (!isStaffRole(role)) throw new Error('Invalid staff role');

      const secret = await password('Password: ');

      if (secret !== (await password('Confirm password: ')))
        throw new Error('Passwords do not match');
      if (command === 'reset-password')
        await operator.resetPassword(email, secret);
      else
        await operator.create(
          { name: name!, email, password: secret, role },
          command === 'bootstrap-admin',
        );
    }

    console.info('Staff operation completed.');
  } catch {
    console.error(
      'Staff operation failed. Check the account, role, password policy and last active Admin requirement.',
    );
    process.exitCode = 1;
  } finally {
    await database.$disconnect();
  }
}
