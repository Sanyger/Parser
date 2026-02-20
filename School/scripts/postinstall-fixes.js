const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', 'freeport-async', 'index.js');

const patchedSource = `const net = require("net");

const DEFAULT_PORT_RANGE_START = 11000;

function testPortAsync(port, hostname) {
  return new Promise(function(fulfill, reject) {
    const normalizedPort = Number(port);
    if (!Number.isInteger(normalizedPort) || normalizedPort < 0 || normalizedPort > 65535) {
      return reject(new RangeError("Port out of range"));
    }

    var server = net.createServer();

    try {
      server.listen({ port: normalizedPort, host: hostname }, function(err) {
        server.once("close", function() {
          setTimeout(() => fulfill(true), 0);
        });
        server.close();
      });
    } catch (error) {
      return setTimeout(() => fulfill(false), 0);
    }

    server.on("error", function(err) {
      if (err && err.code === "EPERM") {
        return setTimeout(() => reject(err), 0);
      }
      setTimeout(() => fulfill(false), 0);
    });
  });
}

async function availableAsync(port, options = {}) {
  const hostnames =
    options.hostnames && options.hostnames.length ? options.hostnames : [null];
  for (const hostname of hostnames) {
    if (!(await testPortAsync(port, hostname))) {
      return false;
    }
  }
  return true;
}

function freePortRangeAsync(rangeSize, rangeStart, options = {}) {
  rangeSize = rangeSize || 1;
  return new Promise((fulfill, reject) => {
    var lowPort = rangeStart || DEFAULT_PORT_RANGE_START;
    if (lowPort + rangeSize - 1 > 65535) {
      return reject(new RangeError("No free ports available in range"));
    }
    var awaitables = [];
    for (var i = 0; i < rangeSize; i++) {
      awaitables.push(availableAsync(lowPort + i, options));
    }
    return Promise.all(awaitables).then(function(results) {
      var ports = [];
      for (var i = 0; i < results.length; i++) {
        if (!results[i]) {
          return freePortRangeAsync(
            rangeSize,
            lowPort + rangeSize,
            options
          ).then(fulfill, reject);
        }
        ports.push(lowPort + i);
      }
      fulfill(ports);
    });
  });
}

async function freePortAsync(rangeStart, options = {}) {
  const result = await freePortRangeAsync(1, rangeStart, options);
  return result[0];
}

module.exports = freePortAsync;

module.exports.availableAsync = availableAsync;
module.exports.rangeAsync = freePortRangeAsync;

// NODE22_PORT_GUARD_PATCH
`;

try {
  if (!fs.existsSync(target)) {
    console.log('[postinstall] freeport-async not found, skipping patch');
    process.exit(0);
  }

  fs.writeFileSync(target, patchedSource, 'utf8');
  console.log('[postinstall] patched freeport-async for Node 22+');
} catch (error) {
  console.warn('[postinstall] patch failed:', error && error.message ? error.message : error);
}
