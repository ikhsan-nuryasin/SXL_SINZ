'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { isTcpPortAvailable } = require('../lib/port-utils');

function listenLocal(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => resolve(server.address().port));
  });
}
function closeServer(server) {
  return new Promise(resolve => server.close(() => resolve()));
}

test('TCP port probe accepts a free loopback port and rejects a listening port', async t => {
  const server = net.createServer();
  const port = await listenLocal(server);
  t.after(() => closeServer(server));
  assert.equal(await isTcpPortAvailable(port), false);
  await closeServer(server);
  assert.equal(await isTcpPortAvailable(port), true);
});

test('TCP port probe rejects invalid port numbers', async () => {
  assert.equal(await isTcpPortAvailable(0), false);
  assert.equal(await isTcpPortAvailable(65536), false);
  assert.equal(await isTcpPortAvailable('not-a-port'), false);
});
