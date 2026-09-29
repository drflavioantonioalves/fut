const assert = require('node:assert/strict');
const argon2 = require('argon2');
const { createServer } = require('node:http');
const test = require('node:test');
const { createApp } = require('../dist/app.js');
const { hashSessionToken, hasOrganizationAccess, hasChampionshipAccess } = require('../dist/auth.js');
const { loadConfig } = require('../dist/config.js');

const cookieName = 'futliga_session';
const password = 'correct-horse-battery-staple';

async function setup(context) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const users = [
    { id: 'master', name: 'Master', email: 'master@example.test', passwordHash, role: 'MASTER_ADMIN', active: true },
    { id: 'admin-a', name: 'Admin A', email: 'a@example.test', passwordHash, role: null, active: true },
    { id: 'admin-b', name: 'Admin B', email: 'b@example.test', passwordHash, role: null, active: true },
    { id: 'inactive', name: 'Inactive', email: 'inactive@example.test', passwordHash, role: null, active: false },
  ];
  const sessions = new Map();
  const matches = new Map([
    ['match-a', { id: 'match-a', championship: { organizationId: 'org-a' } }],
    ['match-b', { id: 'match-b', championship: { organizationId: 'org-b' } }],
  ]);
  const updates = [];
  const prisma = {
    user: { findUnique: async ({ where }) => users.find((user) => user.email === where.email) || null },
    session: {
      findUnique: async ({ where }) => {
        const session = sessions.get(where.id);
        return session ? { ...session, user: users.find((user) => user.id === session.userId) } : null;
      },
      create: async ({ data }) => { sessions.set(data.id, data); return data; },
      deleteMany: async ({ where }) => ({ count: sessions.delete(where.id) ? 1 : 0 }),
    },
    organizationMember: {
      findFirst: async ({ where }) => users.some((user) => user.id === where.userId &&
        ((user.id === 'admin-a' && where.organizationId === 'org-a') || (user.id === 'admin-b' && where.organizationId === 'org-b')))
        ? { id: `${where.userId}-${where.organizationId}` } : null,
    },
    championship: { findUnique: async ({ where }) => ({ organizationId: where.id === 'champ-a' || where.id === 'championship-a' ? 'org-a' : 'org-b' }) },
    match: {
      findUnique: async ({ where }) => {
        const match = matches.get(where.id);
        return match ? { id: match.id, championshipId: match.championship.organizationId === 'org-a' ? 'championship-a' : 'championship-b' } : null;
      },
      update: async ({ where, data }) => {
        updates.push({ id: where.id, data });
        return { id: where.id, ...data };
      },
    },
  };
  const server = createServer(createApp(loadConfig({ NODE_ENV: 'test' }), prisma));
  await new Promise((resolve) => server.listen(0, resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  async function login(email, suppliedPassword = password) {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: suppliedPassword }),
    });
    const setCookie = response.headers.get('set-cookie');
    return { response, cookie: setCookie?.split(';')[0] };
  }
  async function makeSession(userId) {
    const token = `test-token-${userId}-${Math.random()}`;
    sessions.set(hashSessionToken(token), { id: hashSessionToken(token), userId, expiresAt: new Date(Date.now() + 60_000) });
    return `${cookieName}=${token}`;
  }
  return { base, login, makeSession, sessions, updates, prisma };
}

test('login creates an Argon2id-backed server session and never returns passwordHash', async (context) => {
  const app = await setup(context);
  const { response, cookie } = await app.login('MASTER@example.test');
  assert.equal(response.status, 200);
  const loginUser = await response.json();
  assert.deepEqual(loginUser, { id: 'master', name: 'Master', email: 'master@example.test', role: 'MASTER_ADMIN' });
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.equal('passwordHash' in loginUser, false);
  assert.ok(cookie);

  const me = await fetch(`${app.base}/api/auth/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  const currentUser = await me.json();
  assert.equal(currentUser.id, 'master');
  assert.equal('passwordHash' in currentUser, false);
});

test('invalid password, unknown email, and inactive account use generic 401 responses', async (context) => {
  const app = await setup(context);
  const badPassword = await app.login('a@example.test', 'wrong');
  const missing = await app.login('missing@example.test');
  const inactive = await app.login('inactive@example.test');
  assert.equal(badPassword.response.status, 401);
  assert.equal(missing.response.status, 401);
  assert.equal(inactive.response.status, 401);
  assert.deepEqual(await badPassword.response.json(), { error: 'Credenciais inválidas.' });
  assert.deepEqual(await missing.response.json(), { error: 'Credenciais inválidas.' });
});

test('me rejects missing, expired, and logged-out sessions; logout clears its cookie', async (context) => {
  const app = await setup(context);
  assert.equal((await fetch(`${app.base}/api/auth/me`)).status, 401);
  const { cookie } = await app.login('a@example.test');
  assert.equal((await fetch(`${app.base}/api/auth/me`, { headers: { cookie } })).status, 200);
  const logout = await fetch(`${app.base}/api/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await fetch(`${app.base}/api/auth/me`, { headers: { cookie } })).status, 401);

  const expiredToken = 'expired-token';
  app.sessions.set(hashSessionToken(expiredToken), { id: hashSessionToken(expiredToken), userId: 'admin-a', expiresAt: new Date(Date.now() - 1000) });
  assert.equal((await fetch(`${app.base}/api/auth/me`, { headers: { cookie: `${cookieName}=${expiredToken}` } })).status, 401);
});

test('organization and championship access is resolved from database ownership', async (context) => {
  const app = await setup(context);
  const a = await app.makeSession('admin-a');
  const b = await app.makeSession('admin-b');
  const master = await app.makeSession('master');
  const status = (matchId, cookie) => fetch(`${app.base}/api/matches/${matchId}/status`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'FINISHED' }),
  });

  assert.equal((await status('match-a')).status, 401);
  assert.equal((await status('match-a', a)).status, 200);
  assert.equal((await status('match-b', a)).status, 403);
  assert.equal((await status('match-a', b)).status, 403);
  assert.equal((await status('match-a', master)).status, 200);
  assert.equal((await status('match-b', master)).status, 200);
  assert.deepEqual(app.updates.map((entry) => entry.id), ['match-a', 'match-a', 'match-b']);
});

test('Master is global while organization admins are restricted to active memberships', async (context) => {
  const app = await setup(context);
  const master = { id: 'master', name: 'Master', email: 'master@example.test', role: 'MASTER_ADMIN', active: true };
  const adminA = { id: 'admin-a', name: 'Admin A', email: 'a@example.test', role: null, active: true };
  assert.equal(await hasOrganizationAccess({}, master, 'org-b'), true);
  assert.equal(await hasOrganizationAccess(app.prisma, adminA, 'org-a'), true);
  assert.equal(await hasOrganizationAccess(app.prisma, adminA, 'org-b'), false);
  assert.deepEqual(await hasChampionshipAccess(app.prisma, adminA, 'championship-a'), { exists: true, allowed: true });
  assert.deepEqual(await hasChampionshipAccess(app.prisma, adminA, 'championship-b'), { exists: true, allowed: false });
});

test('login rate limit returns 429 after ten attempts from an IP', async (context) => {
  const app = await setup(context);
  let response;
  for (let attempt = 0; attempt < 11; attempt += 1) response = (await app.login('missing@example.test', 'wrong')).response;
  assert.equal(response.status, 429);
});
