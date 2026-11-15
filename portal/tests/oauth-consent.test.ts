import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { agentName, consentDestination, consentRequest, OAuthConsentContent } from "../src/oauth-consent/OAuthConsentPage";

const search = "?client_id=abc&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fcallback&scope=profile+email+private_metadata&state=s1&consented=true&organization_id=o";

test("the request keeps Clerk's parameters, minus what the form sets", () => {
  const request = consentRequest(search);
  assert.equal(request.clientId, "abc");
  assert.equal(request.redirectUri, "http://127.0.0.1:1455/callback");
  assert.equal(request.scope, "profile email private_metadata");
  assert.deepEqual(request.forward.map(([key]) => key), ["client_id", "redirect_uri", "scope", "state"]);
});

test("agent names fall back when empty or overlong", () => {
  assert.equal(agentName(" Codex "), "Codex");
  assert.equal(agentName(""), "Your agent");
  assert.equal(agentName(null), "Your agent");
  assert.equal(agentName("x".repeat(61)), "Your agent");
});

test("the ready page names the agent, folds the details, and posts Allow or Cancel to Clerk", () => {
  const html = renderToStaticMarkup(createElement(OAuthConsentContent, { request: consentRequest(search), view: { state: "ready",
    action: "https://clerk.example/v1/me/oauth/consent/abc",
    data: { oauthApplicationName: "Codex", redirectDomain: "127.0.0.1", scopes: [{ scope: "profile", description: "Your name" }, { scope: "email" }] } } }));
  assert.match(html, /<h1>Connect Codex<\/h1>/);
  assert.match(html, /Codex can read your My skills\./);
  assert.match(html, /<details[^>]*><summary>Show details<\/summary>/);
  assert.match(html, /<li>Your name<\/li><li>email<\/li>/);
  assert.match(html, /<form action="https:\/\/clerk\.example\/v1\/me\/oauth\/consent\/abc" method="POST">/);
  assert.match(html, /name="state" value="s1"/);
  assert.doesNotMatch(html, /name="organization_id"/);
  assert.match(html, /<button[^>]*type="submit" value="true" name="consented">Allow</);
  assert.match(html, /<button[^>]*type="submit" value="false" name="consented">Cancel</);
});

test("a broken request says to start again; no form", () => {
  for (const state of ["invalid", "error"] as const) {
    const html = renderToStaticMarkup(createElement(OAuthConsentContent, { request: consentRequest("?client_id=abc"), view: { state } }));
    assert.match(html, /Start again from your agent\./);
    assert.doesNotMatch(html, /<form/);
  }
});

test("the destination never throws, and a non-local one is shown up front", () => {
  assert.equal(consentDestination("claude.ai", "https://claude.ai/cb"), "claude.ai");
  assert.equal(consentDestination(null, "http://127.0.0.1:1455/cb"), "127.0.0.1");
  assert.equal(consentDestination(null, "com.foo.app:/cb"), "com.foo.app");
  assert.equal(consentDestination(null, "not a url"), "");
  const render = (redirectDomain: string | null, uri: string) => renderToStaticMarkup(createElement(OAuthConsentContent, {
    request: consentRequest(`?client_id=a&redirect_uri=${encodeURIComponent(uri)}`),
    view: { state: "ready", action: "#", data: { oauthApplicationName: "Codex", redirectDomain, scopes: [] } } }));
  assert.match(render("claude.ai", "https://claude.ai/cb"), /Allow returns you to <strong>claude\.ai<\/strong>/);
  assert.doesNotMatch(render(null, "http://127.0.0.1:1455/cb"), /Allow returns you/);
  assert.doesNotMatch(render(null, "not a url"), /Allow returns you|go back to/);
});
