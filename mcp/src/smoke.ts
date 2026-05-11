import { OmgskillsLibrary } from "./library.js";

const library = await OmgskillsLibrary.load();

const swift = library.searchSkills({ query: "swift", limit: 3 });
const figma = library.searchSkills({ query: "figma", limit: 3 });
const mcp = library.searchSkills({ query: "mcp", limit: 3 });
const trending = library.listTrending(3);
const gold = library.listGoldBasket(3);
const invalid = library.getSkill("__missing__/__missing__");

if (swift.length === 0) throw new Error("Expected swift results");
if (figma.length === 0) throw new Error("Expected figma results");
if (mcp.length === 0) throw new Error("Expected mcp results");
if (trending.length === 0) throw new Error("Expected trending results");
if (gold.length === 0) throw new Error("Expected gold basket results");
if (invalid !== undefined) throw new Error("Expected invalid id to be undefined");

console.log(JSON.stringify({
  swift: swift.map((skill) => skill.id),
  figma: figma.map((skill) => skill.id),
  mcp: mcp.map((skill) => skill.id),
  trending: trending.map((skill) => skill.id),
  gold: gold.map((skill) => skill.id),
  invalidId: invalid ?? null
}, null, 2));
