import assert from "node:assert/strict";
import test from "node:test";
import { agentName, handleLibraryAgents, registeredAgentName, touchAgent } from "./library-agents.js";

type Row = { userId: string; clientId: string; firstUsedAt: Date; lastUsedAt: Date; blockedAt: Date | null; clientName: string | null };

// A tiny stand-in for library_agent_connections; the handler's SQL and responses are real.
function harness() {
  const rows: Row[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    const [userId, clientId, blocked] = values as [string, string, boolean];
    if (sql.includes("INSERT INTO library_agent_connections")) {
      let row = rows.find(r => r.userId === userId && r.clientId === clientId);
      if (row) row.lastUsedAt = new Date();
      else rows.push(row = { userId, clientId, firstUsedAt: new Date(), lastUsedAt: new Date(), blockedAt: null, clientName: null });
      return { rows: [{ blocked: row.blockedAt !== null, unnamed: row.clientName === null }] };
    }
    if (sql.includes("SET client_name = $3")) {
      const row = rows.find(r => r.userId === userId && r.clientId === clientId && r.clientName === null);
      if (row) row.clientName = values[2] as string;
      return { rows: [] };
    }
    if (sql.includes("UPDATE library_agent_connections")) {
      const row = rows.find(r => r.userId === userId && r.clientId === clientId);
      if (!row) return { rows: [] };
      row.blockedAt = blocked ? row.blockedAt ?? new Date() : null;
      return { rows: [{ client_id: clientId }] };
    }
    if (sql.includes("FROM library_agent_connections")) {
      return { rows: rows.filter(r => r.userId === userId).map(r => ({ clientId: r.clientId, clientName: r.clientName, firstUsedAt: r.firstUsedAt,
        lastUsedAt: r.lastUsedAt, blocked: r.blockedAt !== null })) };
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  const db = { query } as never;
  const as = (id: string | null) => ({
    getPgPool: () => db,
    requirePortalUser: async () => {
      if (!id) throw new Response("Unauthorized", { status: 401 });
      return { id, clerkUserId: `clerk-${id}`, email: `${id}@example.test`, displayName: id };
    },
  });
  return { db, rows, as };
}

const base = "https://omgskills.test/api/portal/library-agents";
const put = (body: unknown) => new Request(base, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("names agents by their client address", () => {
  assert.equal(agentName("https://claude.ai/oauth/claude-code-client-metadata"), "Claude Code");
  assert.equal(agentName("https://claude.ai/oauth/mcp-oauth-client-metadata"), "Claude");
  assert.equal(agentName("https://grok.com/.well-known/oauth-client.json"), "Grok");
  assert.equal(agentName("https://chatgpt.com/oauth/client"), "ChatGPT");
  assert.equal(agentName("https://tools.example.com/client.json"), "tools.example.com");
  assert.equal(agentName("http://localhost:3000/client"), "Agent");
  assert.equal(agentName("abc123"), "Agent");
});

test("an agent appears when it signs in, and Disconnect blocks it until allowed again", async () => {
  const h = harness();
  const grok = "https://grok.com/client.json";
  assert.deepEqual(await touchAgent(h.db, "user-a", grok), { blocked: false });
  const listed = await (await handleLibraryAgents(new Request(base), h.as("user-a"))).json();
  assert.deepEqual(listed.agents.map((a: { name: string; blocked: boolean }) => [a.name, a.blocked]), [["Grok", false]]);
  assert.equal((await handleLibraryAgents(put({ clientId: grok, blocked: true }), h.as("user-a"))).status, 200);
  assert.deepEqual(await touchAgent(h.db, "user-a", grok), { blocked: true }, "Signing in again doesn't undo it");
  assert.equal((await handleLibraryAgents(put({ clientId: grok, blocked: false }), h.as("user-a"))).status, 200);
  assert.deepEqual(await touchAgent(h.db, "user-a", grok), { blocked: false });
});

test("each person sees and changes only their own agents", async () => {
  const h = harness();
  await touchAgent(h.db, "user-a", "https://grok.com/client.json");
  assert.deepEqual((await (await handleLibraryAgents(new Request(base), h.as("user-b"))).json()).agents, []);
  assert.equal((await handleLibraryAgents(put({ clientId: "https://grok.com/client.json", blocked: true }), h.as("user-b"))).status, 404);
  assert.equal(h.rows[0].blockedAt, null);
  assert.equal((await handleLibraryAgents(new Request(base), h.as(null))).status, 401);
});

test("bad requests are refused", async () => {
  const h = harness();
  assert.equal((await handleLibraryAgents(put({ clientId: "x" }), h.as("user-a"))).status, 400);
  assert.equal((await handleLibraryAgents(put({ blocked: true }), h.as("user-a"))).status, 400);
  assert.equal((await handleLibraryAgents(new Request(base, { method: "DELETE" }), h.as("user-a"))).status, 405);
});

test("a self-registered agent is named once, by where it signs in, and its own name can't pose as another agent", async () => {
  assert.equal(registeredAgentName({ name: "Muse", redirectUris: ["https://agent.meta.ai/api/hatch/oauth/callback"] }), "Meta AI");
  assert.equal(registeredAgentName({ name: "Claude", redirectUris: ["https://evil.example/cb"] }), "Claude (evil.example)");
  assert.equal(registeredAgentName({ name: "Claude", redirectUris: ["https://claude.ai/cb", "https://evil.example/cb"] }),
    "Claude (evil.example)", "Every sign-in address must be the agent's own");
  assert.equal(registeredAgentName({ name: "Claude Code", redirectUris: ["http://127.0.0.1/cb"] }), "Claude Code (this computer)");
  assert.equal(registeredAgentName({ name: "Claude", redirectUris: ["http://claude.ai/cb"] }), "Claude (this computer)",
    "Only https sign-in addresses count as the agent's host");
  assert.equal(registeredAgentName({ name: "Gro\u202ek\u200b\u0000 ", redirectUris: ["https://tools.example/cb"] }),
    "Grok (tools.example)", "Invisible and direction characters are removed");
  assert.equal(registeredAgentName({}), "");

  const h = harness();
  const lookups: string[] = [];
  const describe = async (id: string) => { lookups.push(id); return id === "dcr_muse" ? "Meta AI" : null; };
  await touchAgent(h.db, "user-a", "dcr_muse", describe);
  await touchAgent(h.db, "user-a", "dcr_muse", describe);
  await touchAgent(h.db, "user-a", "dcr_gone", describe);
  await touchAgent(h.db, "user-a", "dcr_gone", describe);
  await touchAgent(h.db, "user-a", "https://grok.com/client.json", describe);
  assert.deepEqual(lookups, ["dcr_muse", "dcr_gone"], "Looked up once each; URL clients name themselves");
  const failing = async () => { throw new Error("clerk down"); };
  assert.deepEqual(await touchAgent(h.db, "user-a", "dcr_later", failing), { blocked: false }, "A failed lookup doesn't fail the request");
  assert.equal(h.rows.find(r => r.clientId === "dcr_later")?.clientName, null, "and is tried again next time");
  const names = (await (await handleLibraryAgents(new Request(base), h.as("user-a"))).json()).agents
    .map((a: { clientId: string; name: string }) => [a.clientId, a.name]).sort();
  assert.deepEqual(names, [["dcr_gone", "Agent"], ["dcr_later", "Agent"], ["dcr_muse", "Meta AI"], ["https://grok.com/client.json", "Grok"]]);
});

test("before the name column exists, agents still work", async () => {
  const calls: string[] = [];
  const db = { query: async (sql: string) => {
    calls.push(sql);
    if (sql.includes("client_name")) throw Object.assign(new Error("column does not exist"), { code: "42703" });
    return { rows: [{ blocked: true }] };
  } } as never;
  assert.deepEqual(await touchAgent(db, "user-a", "dcr_x", async () => "never"), { blocked: true });
  assert.equal(calls.length, 2, "No name lookup or update without the column");
  const listed = await handleLibraryAgents(new Request(base), {
    getPgPool: () => ({ query: async (sql: string) => {
      if (sql.includes("client_name")) throw Object.assign(new Error("column does not exist"), { code: "42703" });
      return { rows: [{ clientId: "https://grok.com/client.json", clientName: null, firstUsedAt: new Date(), lastUsedAt: new Date(), blocked: false }] };
    } }) as never,
    requirePortalUser: async () => ({ id: "user-a", clerkUserId: "c", email: "a@example.test", displayName: "a" }) as never,
  });
  assert.equal(listed.status, 200, "The list still loads");
  assert.equal((await listed.json()).agents[0].name, "Grok");
  const broken = { query: async () => { throw new Error("db down"); } } as never;
  await assert.rejects(touchAgent(broken, "user-a", "dcr_x"), /db down/);
});
