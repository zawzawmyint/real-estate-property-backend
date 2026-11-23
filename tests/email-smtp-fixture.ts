import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';

export async function smtpFixture(stall?: 'greeting' | 'data' | 'accepted') {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  let connections = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    const blocked = connections++ === 0 ? stall : undefined;
    let buffer = '';
    let data = false;
    if (blocked !== 'greeting') socket.write('220 fixture ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (data) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        messages.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 5);
        data = false;
        if (blocked !== 'accepted') socket.write('250 accepted\r\n');
      }
      while (!data && buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n');
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (/^EHLO|^HELO/.test(line)) socket.write('250 fixture\r\n');
        else if (line === 'DATA') {
          if (blocked !== 'data') {
            data = true;
            socket.write('354 send body\r\n');
          }
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP fixture');
  return {
    port: address.port,
    sockets,
    messages,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
