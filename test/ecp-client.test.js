// The ECP HTTP client, against a fake fetch: paths, methods, error kinds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RokuClient, RokuError, isValidHost } from '../src/ecp/client.js';
import { fixture } from './helpers/fakeRoku.js';

function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body });
    return handler(url, init);
  };
  return { fetch, calls };
}

function response(status, body = '', contentType = 'text/xml; charset="utf-8"') {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

test('queries are GETs on port 8060, parsed', async () => {
  const { fetch, calls } = fakeFetch(() => response(200, fixture('device-info-tv.xml')));
  const client = new RokuClient('192.0.2.30', { fetch });
  const info = await client.deviceInfo();
  assert.equal(info.serial, 'TVX000000003');
  assert.deepEqual(calls, [
    { url: 'http://192.0.2.30:8060/query/device-info', method: 'GET', body: undefined },
  ]);
});

test('commands are POSTs with an empty body, key and app id encoded', async () => {
  const { fetch, calls } = fakeFetch(() => response(200));
  const client = new RokuClient('192.0.2.30', { fetch });
  await client.keypress('PowerOn');
  await client.launch('tvinput.hdmi1');
  await client.launch('a/b');
  assert.deepEqual(
    calls.map((call) => [call.method, call.url, call.body]),
    [
      ['POST', 'http://192.0.2.30:8060/keypress/PowerOn', ''],
      ['POST', 'http://192.0.2.30:8060/launch/tvinput.hdmi1', ''],
      ['POST', 'http://192.0.2.30:8060/launch/a%2Fb', ''],
    ],
  );
});

test('403 is a "forbidden" error (Control by mobile apps: Limited or Disabled)', async () => {
  const { fetch } = fakeFetch(() => response(403, 'ECP command not allowed in limited mode.'));
  const client = new RokuClient('192.0.2.30', { fetch });
  await assert.rejects(client.keypress('Home'), (err) => {
    assert.ok(err instanceof RokuError);
    assert.equal(err.kind, 'forbidden');
    assert.equal(err.status, 403);
    assert.equal(err.ip, '192.0.2.30');
    return true;
  });
});

test('network errors: refused, unreachable, timeout', async () => {
  const refused = new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  const unreachable = new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  for (const [thrown, kind] of [
    [refused, 'refused'],
    [unreachable, 'unreachable'],
    [timeout, 'timeout'],
  ]) {
    const client = new RokuClient('192.0.2.30', {
      fetch: async () => {
        throw thrown;
      },
    });
    await assert.rejects(client.activeApp(), (err) => err.kind === kind);
  }
});

test('other HTTP errors and unreadable answers', async () => {
  const notFound = new RokuClient('192.0.2.30', { fetch: async () => response(404) });
  await assert.rejects(notFound.launch('999'), (err) => err.kind === 'http' && err.status === 404);
  const garbage = new RokuClient('192.0.2.30', { fetch: async () => response(200, '<html/>') });
  await assert.rejects(garbage.deviceInfo(), (err) => err.kind === 'malformed');
});

test('a real timeout aborts the request', async () => {
  const client = new RokuClient('192.0.2.30', {
    timeoutMs: 20,
    fetch: (url, init) =>
      new Promise((resolve, reject) => {
        // AbortSignal.timeout() does not keep the event loop alive: this does.
        const keepAlive = setTimeout(resolve, 1000);
        init.signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(init.signal.reason);
        });
      }),
  });
  await assert.rejects(client.deviceInfo(), (err) => err.kind === 'timeout');
});

test('icons come back as binary', async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const client = new RokuClient('192.0.2.30', {
    fetch: async () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
  });
  const { body, contentType } = await client.icon('12');
  assert.deepEqual(body, png);
  assert.equal(contentType, 'image/png');
});

test('addresses are validated before any request', () => {
  assert.equal(isValidHost('192.168.1.40'), true);
  assert.equal(isValidHost('roku-living.local'), true);
  assert.equal(isValidHost('256.1.1.1'), false);
  assert.equal(isValidHost('http://x'), false);
  assert.equal(isValidHost('1.2.3.4/../x'), false);
  assert.equal(isValidHost(''), false);
  assert.throws(() => new RokuClient('evil host'), RokuError);
});

test('a typed character is URL-encoded, and hidden from the errors', async () => {
  const { fetch, calls } = fakeFetch(() => response(200));
  const client = new RokuClient('192.0.2.30', { fetch });
  await client.keypress('Lit_@');
  await client.keypress('Lit_ ');
  assert.deepEqual(
    calls.map((call) => call.url),
    ['http://192.0.2.30:8060/keypress/Lit_%40', 'http://192.0.2.30:8060/keypress/Lit_%20'],
  );
  const refusing = new RokuClient('192.0.2.30', { fetch: async () => response(403) });
  await assert.rejects(refusing.keypress('Lit_s'), (err) => {
    assert.equal(err.path, '/keypress/Lit_*');
    assert.ok(!err.message.includes('Lit_s'));
    return true;
  });
});
