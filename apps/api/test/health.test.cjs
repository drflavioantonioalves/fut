const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const test = require('node:test');
const { createApp } = require('../dist/app.js');
const { loadConfig } = require('../dist/config.js');

test('loads safe local defaults and configured values', () => {
  assert.deepEqual(loadConfig({}).corsOrigins, ['http://localhost:5173']);
  assert.equal(loadConfig({ PORT: '4312', NODE_ENV: 'test', APP_VERSION: 'test-build' }).port, 4312);
  assert.deepEqual(loadConfig({ CORS_ORIGIN: 'https://app.example.test,https://admin.example.test' }).corsOrigins, [
    'https://app.example.test',
    'https://admin.example.test',
  ]);
});

test('rejects unsafe or malformed production configuration', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /DATABASE_URL/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://example', CORS_ORIGIN: '' }), /CORS_ORIGIN/);
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ CORS_ORIGIN: '*' }), /invalid origin|plain HTTP/);
});

test('GET /health returns process health without querying the database', async (context) => {
  const config = loadConfig({ NODE_ENV: 'test', APP_VERSION: 'test-build' });
  const app = createApp(config, {});
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'futliga-api',
    environment: 'test',
    version: 'test-build',
  });
});


test('POST /api/matches/:id/status stays unavailable until authentication exists', async (context) => {
  let updateCalls = 0;
  const prisma = { match: { update: async () => { updateCalls += 1; } } };
  const app = createApp(loadConfig({ NODE_ENV: 'test' }), prisma);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/matches/any-match/status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'FINISHED' }),
  });
  assert.equal(response.status, 503);
  assert.equal(updateCalls, 0);
});
