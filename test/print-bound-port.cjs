'use strict';
// Test-only preload. Spawned backends pass port 0; this prints the port
// Node actually bound so the parent can read it back. Production code is
// not modified.
const net = require('net');

const origListen = net.Server.prototype.listen;
net.Server.prototype.listen = function patchedListen(...args) {
  this.once('listening', () => {
    const addr = this.address();
    if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
      process.stdout.write(`BOUND_PORT ${addr.port}\n`);
    }
  });
  return origListen.apply(this, args);
};
