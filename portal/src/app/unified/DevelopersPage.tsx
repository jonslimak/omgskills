import { useState, type ReactNode } from "react";
import { Activity, ArrowRight, Braces, Check, Copy, Database, Globe, Package, ShieldCheck, type LucideIcon } from "lucide-react";

// The app's version of the static /developers/ page (scripts/build-web-library.mjs,
// renderDevelopersPage); keep the two in step.
const site = "https://omgskills.com";
const localConfig = `{
  "mcpServers": {
    "omgskills": {
      "command": "npx",
      "args": ["-y", "omgskills-mcp"]
    }
  }
}`;

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <div className="ua-dev-copy">
    <code>{value}</code>
    <button type="button" className="ua-icon" aria-label={`Copy ${value}`} title="Copy" onClick={async () => {
      try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* Clipboard blocked. */ }
    }}>{copied ? <Check /> : <Copy />}</button>
  </div>;
}

function Item({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return <div className="ua-dev-item">
    <h3>{href ? <a href={href} rel={href.startsWith(site) ? undefined : "noreferrer"}>{title} <ArrowRight aria-hidden="true" /></a> : title}</h3>
    <p>{children}</p>
  </div>;
}

function Card({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return <section className="ua-dev-card">
    <h2><span className="ua-dev-card-icon"><Icon aria-hidden="true" /></span>{title}</h2>
    {children}
  </section>;
}

export function DevelopersPage() {
  return <div className="ua-dev">
    <section className="ua-dev-intro">
      <h2>When to use omgskills</h2>
      <p>Use omgskills when you need to find or evaluate trusted skills for Claude Code, Codex, or other coding agents.
        Search the public catalog by task, tool, or creator through the read-only MCP endpoint, Markdown mirrors, or JSON
        manifests; use the macOS app to install or manage skills.</p>
    </section>
    <div className="ua-dev-grid">
      <Card icon={Globe} title="Hosted MCP (live catalog)">
        <CopyValue value={`${site}/mcp`} />
        <p>Public, read-only, no authentication. Available tools: <code>search_skills</code>, <code>get_skill</code>,{" "}
          <code>get_install_plan</code>, <code>get_skill_content</code>, <code>related_skills</code>, and more.</p>
      </Card>
      <Card icon={Package} title="npm local MCP">
        <CopyValue value="npx -y omgskills-mcp" />
        <pre>{localConfig}</pre>
      </Card>
      <Card icon={Braces} title="OpenAPI specification">
        <CopyValue value={`${site}/openapi.json`} />
        <p>Machine-readable description of every public endpoint: catalog manifest, data assets, discovery files, and the hosted MCP server.</p>
      </Card>
      <Card icon={Database} title="Public data">
        <Item title="Agent guide" href={`${site}/agents.md`}>When to use omgskills and the preferred machine-readable access paths.</Item>
        <Item title="Catalog manifest" href={`${site}/data/manifest.json`}>Current public data assets and hashes.</Item>
        <Item title="AI catalog" href={`${site}/.well-known/ai-catalog.json`}>ARD discovery manifest for the hosted MCP server.</Item>
        <Item title="Markdown library" href={`${site}/skills/index.md`}>Profiles, collections, and selected skill pages.</Item>
        <Item title="Curated export" href={`${site}/llms-gold.txt`}>One-file export of the generated Gold library.</Item>
      </Card>
      <Card icon={Activity} title="Status & support">
        <Item title="MCP health" href={`${site}/mcp/health`}>Live catalog status and loaded skill count.</Item>
        <Item title="Contact" href="mailto:hi@omgskills.com">Questions, corrections, and support: hi@omgskills.com.</Item>
      </Card>
      <Card icon={ShieldCheck} title="Links & safety">
        <Item title="npm package" href="https://www.npmjs.com/package/omgskills-mcp">Install the local MCP server.</Item>
        <Item title="Source" href="https://github.com/jonslimak/omgskills">Repository, documentation, and issue tracking.</Item>
        <Item title="Safety">The MCP tools only read public catalog data. They do not install skills, write files, run shell commands, or receive private skill content.</Item>
      </Card>
    </div>
  </div>;
}
