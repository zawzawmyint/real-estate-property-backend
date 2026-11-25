// Test-only IPC shutdown adapter. Production API code still owns startup/lifecycle.
process.on('message', (message) => {
  if (message === 'stop') {
    process.emit('SIGTERM');
    process.disconnect();
  }
});
process.channel?.unref();
await import('../src/server.js');
