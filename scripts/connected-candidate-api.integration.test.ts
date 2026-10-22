import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import type { Context } from '@netlify/functions';
import pg from 'pg';
import { connectionString, poolOptions, readOwnedFixture, verifyDatabase } from './test-connected-candidate-database.mjs';

// Refuse inherited URLs before importing the candidate or opening any connection.
const fixture = await readOwnedFixture(process.env.CC2C_FIXTURE_FILE, process.env.CC2C_RUN_TOKEN);

test('CC2C1 real isolated candidate storage chain (fake Clerk identity only)', { timeout: 30000 }, async t => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('External calls are forbidden in CC2C1'); };
  const pool = new pg.Pool(poolOptions(fixture));
  try {
    const identity = await verifyDatabase(pool, fixture);
    const { createConnectedCandidateApi } = await import('./connected-candidate-api.mjs');
    const { candidateDatabase, connectedCandidateOrigin: origin, connectedCandidateSiteId } =
      await import('../netlify/functions/_shared/connected-candidate.js');
    const { codeChallengeForVerifier, createDeviceCredential, hashToken } =
      await import('../netlify/functions/_shared/crypto.js');
    const ownerBearer = 'Bearer cc2c.owner.signature';
    const otherBearer = 'Bearer cc2c.other.signature';
    const secretKey = 'sk_test_CC2C1SyntheticNotARealKey';
    const url = connectionString(fixture);
    const environment = { NODE_ENV: 'test', OMGSKILLS_CONNECTED_CANDIDATE: '1', OMGSKILLS_CONNECTED_CANDIDATE_PROFILE: 'connected',
      OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_URL: url, OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_HOST: join(fixture.root, 'socket'),
      OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_NAME: fixture.database, OMGSKILLS_CONNECTED_CANDIDATE_DATABASE_USER: fixture.user,
      CLERK_SECRET_KEY: secretKey };
    const context = { site: { id: connectedCandidateSiteId }, deploy: { context: 'production' } } as Context;
    let poolCreations = 0;
    const api = createConnectedCandidateApi({
      getEnvironment: () => environment,
      getPool: candidateDatabase(actual => {
        assert.ok(actual === url, 'Only the owned connection is allowed');
        poolCreations++;
        return pool;
      }),
      user: {
        async requireAuth(req) {
          const bearer = req.headers.get('authorization');
          if (bearer === ownerBearer) return { clerkUserId: 'cc2c-owner' };
          if (bearer === otherBearer) return { clerkUserId: 'cc2c-other' };
          throw new Response('Invalid synthetic account credential', { status: 401 });
        },
        async loadClerkUser(id, key) {
          assert.ok(key === secretKey, 'Only the synthetic Clerk key is allowed');
          assert.ok(['cc2c-owner', 'cc2c-other'].includes(id));
          return { primaryEmailAddressId: 'email', firstName: id, lastName: null,
            emailAddresses: [{ id: 'email', emailAddress: `${id}@example.test`, verification: { status: 'verified' } }] };
        },
      },
    });
    const request = (path: string, body?: unknown, bearer = ownerBearer) => new Request(origin + '/api/portal/' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: { Authorization: bearer, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    async function response(path: string, body?: unknown, bearer = ownerBearer, status = 200) {
      const reply = await api(request(path, body, bearer), context);
      assert.equal(reply.status, status, `${path}: unexpected status (${await reply.clone().text()})`);
      assert.equal(reply.headers.get('cache-control'), 'no-store');
      assert.equal(reply.headers.get('referrer-policy'), 'no-referrer');
      assert.match(reply.headers.get('x-robots-tag') ?? '', /noindex/);
      return reply;
    }
    const json = async (path: string, body?: unknown, bearer = ownerBearer) => (await response(path, body, bearer)).json();
    const roots = ['claude', 'codex', 'agents'].map(source => ({ source, state: 'complete' }));
    const skill = (folder: string, source = 'codex') => ({ source, installationPath: folder,
      name: folder, description: 'CC2C1 unmatched local skill', skillMdSha: 'a'.repeat(40) });
    async function upload(bearer: string, skills: unknown[], coverage = roots) {
      const { revision } = await json('sync-upload?reportVersion=3', undefined, bearer);
      return json('sync-upload', { reportVersion: 3, baseRevision: revision, roots: coverage, skills }, bearer);
    }
    const inventory = () => json('synced-skills?version=3');
    async function snapshot() {
      const state: Record<string, unknown[]> = {};
      for (const table of ['users', 'device_tokens', 'sync_tokens', 'sync_runs', 'synced_skills', 'skill_groups', 'skill_group_items']) {
        state[table] = (await pool.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
      }
      return state;
    }
    const evidence: Record<string, unknown> = { identity, fakeAuth: true, externalCallsAllowed: false };
    async function step(name: string, run: () => Promise<void>) {
      let passed = false;
      await t.test(name, async () => { await run(); passed = true; });
      assert.ok(passed, 'Previous storage step failed; stop the dependent chain');
    }
    let ownerId: string;
    let controlId: string;
    let controlState: unknown;
    let deviceId: string;
    let deviceBearer: string;
    let rowId: string;
    let groupId: string;
    let itemId: string;
    let groupState: unknown;

    await step('seed a control Mac, then pair a second Mac through real metadata-only PKCE', async () => {
      await json('profile');
      ownerId = (await pool.query("SELECT id FROM users WHERE clerk_user_id='cc2c-owner'")).rows[0].id;
      const controlCredential = createDeviceCredential();
      controlId = randomUUID();
      await pool.query(`INSERT INTO device_tokens(id,user_id,token_hash,device_name,expires_at)
        VALUES($1,$2,$3,'CC2C1 control Mac',now()+interval '30 days')`, [controlId, ownerId, hashToken(controlCredential)]);
      await upload(`Bearer ${controlCredential}`, [skill('control-skill', 'claude')]);
      controlState = (await pool.query('SELECT * FROM synced_skills WHERE device_id=$1', [controlId])).rows;
      const verifier = randomBytes(32).toString('base64url');
      const state = randomBytes(32).toString('base64url');
      const approval = await json('sync-pairing-code', { state, codeChallenge: codeChallengeForVerifier(verifier),
        codeChallengeMethod: 'S256', scopes: ['sync:write', 'self:revoke'] });
      const callback = new URL(approval.callbackUrl);
      assert.equal(callback.protocol + '//' + callback.host, 'omgskills://pair');
      assert.ok(callback.searchParams.get('state') === state, 'Pairing state must survive');
      const code = callback.searchParams.get('code');
      const exchange = await json('sync-exchange', { pairingCode: code, codeVerifier: verifier, deviceName: 'CC2C1 reporting Mac' });
      assert.deepEqual(exchange.grantedScopes, ['sync:write', 'self:revoke']);
      assert.equal(exchange.accountLabel, 'cc2c-owner');
      deviceId = exchange.deviceId;
      deviceBearer = `Bearer ${exchange.credential}`;
      const initial = await json('sync-upload?reportVersion=3', undefined, deviceBearer);
      assert.equal(initial.revision, null);
      await response('sync-exchange', { pairingCode: code, codeVerifier: verifier, deviceName: 'Replay Mac' }, ownerBearer, 401);
      evidence.devices = { ownerId, controlId, deviceId, grantedScopes: exchange.grantedScopes, initialRevision: null, oneTimeExchange: true };
    });

    await step('baseline and added skill retain row, device, Set and note identities', async () => {
      const baseline = await upload(deviceBearer, [skill('baseline-skill')]);
      assert.equal(baseline.deviceId, deviceId);
      const first = await inventory();
      assert.equal(first.inventoryVersion, 3);
      rowId = first.skills.find((row: any) => row.deviceId === deviceId).id;
      groupId = randomUUID(); itemId = randomUUID();
      await pool.query(`INSERT INTO skill_groups(id,owner_user_id,name,slug,visibility)
        VALUES($1,$2,'CC2C1 private Set','cc2c1-private-set','private')`, [groupId, ownerId]);
      await pool.query(`INSERT INTO skill_group_items(id,group_id,kind,synced_skill_id,note,position,name)
        VALUES($1,$2,'synced',$3,'Keep CC2C1 note',0,'Baseline snapshot')`, [itemId, groupId, rowId]);
      groupState = (await pool.query('SELECT * FROM skill_group_items WHERE id=$1', [itemId])).rows;
      await upload(deviceBearer, [skill('baseline-skill'), skill('added-skill', 'agents')]);
      const assertInventory = (view: any) => {
        assert.equal(view.skills.length, 3);
        assert.equal(view.devices.length, 2);
        assert.equal(view.skills.filter((row: any) => row.deviceId === deviceId).length, 2);
        const baselineRow = view.skills.find((row: any) => row.id === rowId);
        assert.ok(baselineRow && baselineRow.deviceId === deviceId && baselineRow.isCurrent);
        assert.equal(baselineRow.installationFolder, 'baseline-skill');
        assert.equal(baselineRow.catalogSkillId, null);
        assert.equal(baselineRow.identityStatus, 'localOnly');
        assert.equal(view.skills.filter((row: any) => row.installationFolder === 'added-skill').length, 1);
      };
      assertInventory(await inventory());
      assertInventory(await inventory());
      assert.equal((await json('devices')).devices.length, 2);
      assert.equal((await json('profile')).profile.profilePublished, false);
      const groups = await json('groups');
      assert.equal(groups.groups.length, 1);
      assert.deepEqual(groups.groups[0].syncedSkillIds, [rowId]);
      const detail = await json(`groups/${groupId}`);
      assert.equal(detail.accessRole, 'owner');
      assert.equal(detail.items[0].id, itemId);
      assert.equal(detail.items[0].syncedSkillId, rowId);
      assert.deepEqual((await json('shared')).groups, []);
      assert.deepEqual((await pool.query('SELECT * FROM skill_group_items WHERE id=$1', [itemId])).rows, groupState);
      assert.deepEqual((await pool.query('SELECT * FROM synced_skills WHERE device_id=$1', [controlId])).rows, controlState);
      evidence.preserved = { rowId, groupId, itemId, note: 'Keep CC2C1 note', unmatchedReported: true, skills: 3, devices: 2 };
    });

    await step('unchanged acknowledgement advances freshness without inventory or sync-run changes', async () => {
      const before = await snapshot();
      const device = (await pool.query('SELECT inventory_revision,inventory_checked_at FROM device_tokens WHERE id=$1', [deviceId])).rows[0];
      await setTimeout(5);
      const check = await json('sync-upload', { reportVersion: 3, mode: 'check', baseRevision: device.inventory_revision }, deviceBearer);
      assert.equal(check.mode, 'checked');
      assert.equal(check.revision, device.inventory_revision);
      assert.ok(new Date(check.checkedAt).getTime() > device.inventory_checked_at.getTime());
      const after = await snapshot();
      for (const table of ['synced_skills', 'sync_runs', 'skill_groups', 'skill_group_items']) assert.deepEqual(after[table], before[table]);
      assert.equal((await json('sync-upload?reportVersion=3', undefined, deviceBearer)).revision, device.inventory_revision);
      const view = await inventory();
      assert.equal(view.devices.find((row: any) => row.id === deviceId).lastCheckedAt, check.checkedAt);
      evidence.unchanged = { revision: check.revision, checkedAt: check.checkedAt, noExtraRun: true, noDuplicateRows: true };
    });

    await step('partial scan retains the omitted row and its Set link without a new missing label', async () => {
      const before = (await pool.query('SELECT * FROM synced_skills WHERE id=$1', [rowId])).rows;
      const partialRoots = roots.map(root => root.source === 'codex'
        ? { source: root.source, state: 'incomplete', reason: 'changed' } : root);
      const report = await upload(deviceBearer, [skill('added-skill', 'agents')], partialRoots);
      assert.equal(report.complete, false);
      assert.equal(report.missingSkillCount, 0);
      assert.deepEqual((await pool.query('SELECT * FROM synced_skills WHERE id=$1', [rowId])).rows, before);
      assert.deepEqual((await pool.query('SELECT * FROM skill_group_items WHERE id=$1', [itemId])).rows, groupState);
      const view = await inventory();
      assert.equal(view.skills.find((row: any) => row.id === rowId).isCurrent, true);
      assert.equal(view.devices.find((row: any) => row.id === deviceId).scanCoverage.find((root: any) => root.source === 'codex').state, 'incomplete');
      assert.equal((await json(`groups/${groupId}`)).items[0].syncedSkillId, rowId);
      evidence.partial = { retainedRowId: rowId, retainedSetItemId: itemId, newlyMissing: 0 };
    });

    await step('another account cannot read the owner inventory, devices or private Set', async () => {
      const other = await json('synced-skills?version=3', undefined, otherBearer);
      assert.deepEqual(other.skills, []); assert.deepEqual(other.devices, []);
      assert.deepEqual((await json('devices', undefined, otherBearer)).devices, []);
      assert.deepEqual((await json('groups', undefined, otherBearer)).groups, []);
      await response(`groups/${groupId}`, undefined, otherBearer, 404);
      evidence.accountIsolation = true;
    });

    await step('invalid credentials and candidate v1/v2 uploads cannot change either Mac or Set', async () => {
      const before = await snapshot();
      await response('synced-skills?version=3', undefined, 'Bearer cc2c.invalid.signature', 401);
      await response('sync-upload', { reportVersion: 3, baseRevision: null, roots, skills: [] }, `Bearer ${createDeviceCredential()}`, 401);
      for (const reportVersion of [1, 2]) {
        await response('sync-upload', { reportVersion, skills: [] }, deviceBearer, 400);
      }
      assert.deepEqual(await snapshot(), before);
      assert.deepEqual((await pool.query('SELECT * FROM synced_skills WHERE device_id=$1', [controlId])).rows, controlState);
      evidence.rejectedWritesPreservedAllRows = true;
    });

    assert.equal(poolCreations, 1, 'Every operation must reuse the same verified private pool');
    evidence.privatePoolCreations = poolCreations;
    await writeFile(join(fixture.root, 'proof.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  } finally {
    await pool.end();
    globalThis.fetch = originalFetch;
  }
});
