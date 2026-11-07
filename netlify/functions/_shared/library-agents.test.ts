import assert from "node:assert/strict";
import test from "node:test";
import { agentName, handleLibraryAgents, touchAgent } from "./library-agents.js";

type Row = { userId: string; clientId: string; firstUsedAt: Date; lastUsedAt: Date; blockedAt: Date | null };

// A tiny stand-in for library_agent_connections; the handler's SQL and responses are real.
function harness() {
  const rows: Row[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    const [userId, clientId, blocked] = values as [string, string, boolean];
    if (sql.includes("INSERT INTO library_agent_connections")) {
      let row = rows.find(r => r.userId === userId && r.clientId === clientId);
      if (row) row.lastUsedAt = new Date();
      else rows.push(row = { userId, clientId, firstUsedAt: new Date(), lastUsedAt: new Date(), blockedAt: null });
      return { rows: [{ blocked: row.blockedAt !== null }] };
    }
    if (sql.includes("UPDATE library_agent_connections")) {
      const row = rows.find(r => r.userId === userId && r.clientId === clientId);
      if (!row) return { rows: [] };
      row.blockedAt = blocked ? row.blockedAt ?? new Date() : null;
      return { rows: [{ client_id: clientId }] };
    }
    if (sql.includes("FROM library_agent_connections")) {
      return { rows: rows.filter(r => r.userId === userId).map(r => ({ clientId: r.clientId, firstUsedAt: r.firstUsedAt,
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
