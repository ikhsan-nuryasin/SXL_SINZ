'use strict';

const net = require('node:net');

/**
 * Return true only when a TCP listener can temporarily bind to the requested
 * local address. A connect-only probe is insufficient: a process can own a
 * bound socket without accepting connections, which would still block MariaDB.
 */
function isTcpPortAvailable(port, host = '127.0.0.1') {
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) {
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    const probe = net.createServer();
    let settled = false;
    const finish = available => {
      if (settled) return;
      settled = true;
      resolve(available);
    };
    probe.once('error', () => finish(false));
    probe.listen({ host, port: Number(port), exclusive: true }, () => {
      probe.close(error => finish(!error));
    });
  });
}

module.exports = { isTcpPortAvailable };
