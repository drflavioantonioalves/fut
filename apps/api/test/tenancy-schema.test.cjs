const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { createServer } = require('node:http');
const { createApp } = require('../dist/app.js');
const { loadConfig } = require('../dist/config.js');

const root = join(__dirname, '..', '..', '..');
const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
const migration = readFileSync(
  join(root, 'prisma', 'migrations', '20260927000000_identity_tenancy', 'migration.sql'),
  'utf8',
);
const authMigration = readFileSync(
  join(root, 'prisma', 'migrations', '20260928000000_auth_sessions', 'migration.sql'),
  'utf8',
);

function model(name) {
  const match = schema.match(new RegExp(`model ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Prisma model ${name} exists`);
  return match[1];
}

test('identity roles keep platform administration separate from organization membership', () => {
  assert.match(schema, /enum PlatformRole\s*\{\s*MASTER_ADMIN\s*\}/);
  assert.match(schema, /enum OrganizationMemberRole\s*\{\s*CHAMPIONSHIP_ADMIN\s*\}/);
  assert.match(model('User'), /role\s+PlatformRole\?/);
  assert.match(model('OrganizationMember'), /role\s+OrganizationMemberRole/);
  assert.match(model('User'), /active\s+Boolean\s+@default\(true\)/);
  assert.match(model('User'), /passwordHash\s+String/);
});

test('Organization is the tenant and Championship requires exactly one Organization', () => {
  assert.match(model('Organization'), /slug\s+String\s+@unique/);
  assert.match(model('Organization'), /active\s+Boolean\s+@default\(true\)/);
  assert.match(model('Organization'), /championships\s+Championship\[\]/);
  assert.match(model('Championship'), /organizationId\s+String\r?\n/);
  assert.match(model('Championship'), /organization\s+Organization\s+@relation/);
  assert.match(model('Championship'), /@@index\(\[organizationId\]\)/);
});

test('user membership cannot duplicate a user and organization pair', () => {
  assert.match(model('OrganizationMember'), /@@unique\(\[userId, organizationId\]\)/);
  assert.match(model('OrganizationMember'), /@@index\(\[organizationId\]\)/);
  assert.match(model('User'), /email\s+String\s+@unique/);
  assert.match(migration, /OrganizationMember_userId_organizationId_key/);
  assert.match(migration, /Organization_slug_key/);
});

test('composite relations prevent cross-organization teams and cross-championship matches', () => {
  assert.match(model('Team'), /fields:\s*\[championshipId, organizationId\], references:\s*\[id, organizationId\]/);
  assert.match(model('Championship'), /@@unique\(\[id, organizationId\]\)/);
  assert.match(model('Team'), /@@unique\(\[id, championshipId\]\)/);
  assert.match(model('Match'), /fields:\s*\[homeTeamId, championshipId\], references:\s*\[id, championshipId\]/);
  assert.match(model('Match'), /fields:\s*\[awayTeamId, championshipId\], references:\s*\[id, championshipId\]/);
  assert.match(model('Match'), /fields:\s*\[phaseId, championshipId\], references:\s*\[id, championshipId\]/);
  assert.match(migration, /Team_championshipId_organizationId_fkey/);
  assert.match(migration, /Match_homeTeamId_championshipId_fkey/);
  assert.match(migration, /Match_awayTeamId_championshipId_fkey/);
});

test('migration preserves Club data and rejects legacy cross-tenant assignments', () => {
  assert.match(migration, /ALTER TABLE "Club" RENAME TO "Organization"/);
  assert.match(migration, /INSERT INTO "OrganizationMember"/);
  assert.match(migration, /Team whose Club differs from its Championship Club/);
  assert.match(migration, /different Championship/);
});
test('championship API keeps the existing club response shape after the Organization rename', async (context) => {
  const organization = { id: 'org-1', name: 'Example Club', slug: 'example-club' };
  const prisma = {
    championship: {
      findMany: async () => [{
        id: 'championship-1',
        name: 'Example Cup',
        organizationId: organization.id,
        organization,
        phases: [],
        teams: [],
        matches: [],
        awards: [],
        sponsors: [],
      }],
    },
  };
  const server = createServer(createApp(loadConfig({ NODE_ENV: 'test' }), prisma));
  await new Promise((resolve) => server.listen(0, resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/championships`);
  const [championship] = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(championship.club, organization);
  assert.equal('organization' in championship, false);
});

test('server-side sessions belong to a user and expire through an indexed timestamp', () => {
  assert.match(model('User'), /sessions\s+Session\[\]/);
  assert.match(model('Session'), /userId\s+String/);
  assert.match(model('Session'), /expiresAt\s+DateTime/);
  assert.match(model('Session'), /@@index\(\[expiresAt\]\)/);
  assert.match(authMigration, /CREATE TABLE "Session"/);
  assert.match(authMigration, /Session_userId_fkey/);
});
