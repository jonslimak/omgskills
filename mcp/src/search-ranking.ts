import type { SearchOptions, Skill } from "./library.js";
import { compareText, nameKey, PagingError, validCount, type PagedSearchOptions } from "./paging.js";

export const searchRankingPolicy = "web-v1";
export const rankingIdentity = "web-v1:normalization-1:scoring-2:collection-origin-v1";
export type RankedSearchOptions = PagedSearchOptions & { ranking: typeof searchRankingPolicy };
type PreparedEntry = { skill: Skill; fields: string[]; author: string; tags: string[] };
type Document = { entry: PreparedEntry; fields: string[]; name: string; stars: number; bonus: number };
type Token = { token: string; partial: boolean };
type Candidate = { document: Document; matchedAll: boolean; exactId: boolean };
export type RankedMatch = { skill: Skill; score: number; matchedAll: boolean; exactId: boolean; name: string; stars: number };
const stopwords = new Set(["skill", "skills", "claude", "agent", "agents", "code"]);
const weights = [[100, 75], [60, 45], [30, 20], [25, 12], [20, 10], [10, 5]];
const normalize = (value: string) => value.normalize("NFKC").toLowerCase()
  .replace(/app[\s-]*store/g, "appstore").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const fieldOrder = [0, 3, 2, 4, 1, 5];
const unicodeWord = /[\p{L}\p{N}]/u;
function boundary(text: string, offset: number) {
  let code = text.charCodeAt(offset);
  if (Number.isNaN(code)) return true;
  if (code < 128) return !(code >= 97 && code <= 122 || code >= 48 && code <= 57);
  if (code >= 0xdc00 && code <= 0xdfff) code = text.codePointAt(offset - 1)!;
  else code = text.codePointAt(offset)!;
  return !unicodeWord.test(String.fromCodePoint(code));
}
function fieldScore(text: string, token: string, partial: boolean, exactWeight: number, partialWeight: number) {
  let offset = text.indexOf(token);
  if (offset < 0) return 0;
  do {
    if (boundary(text, offset - 1) && boundary(text, offset + token.length)) return exactWeight;
    offset = text.indexOf(token, offset + 1);
  } while (offset >= 0);
  return partial ? partialWeight : 0;
}

export function rankedRequest(options: SearchOptions) {
  let query = options.query.trim(), author = options.author?.toLowerCase().trim().replace(/^@/, "");
  if (query.startsWith("@")) {
    const [head, ...rest] = query.split(/\s+/), handle = head.slice(1);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(handle) || handle.includes("--")
      || rest.some(token => token.startsWith("@")) || (author && author !== handle.toLowerCase())) throw new PagingError("invalid_cursor");
    author = handle.toLowerCase(); query = rest.join(" ");
  }
  const raw = [...new Set(normalize(query).split(" ").filter(Boolean))];
  const meaningful = raw.filter(token => !stopwords.has(token));
  return { query, author, tokens: meaningful.length ? meaningful : raw };
}

/** Reuse legacy text; only compatibility characters and app-store aliases need a copy. */
export class SearchRankingIndex {
  private readonly documents: Document[];
  constructor(entries: PreparedEntry[], collectionIds: ReadonlySet<string>, private readonly installable: ReadonlySet<string> | null = null,
    private readonly isCopy: (id: string) => boolean = () => false, private readonly isMirror: (id: string) => boolean = () => false) {
    this.documents = entries.map(entry => {
      const { skill } = entry;
      let fields = entry.fields;
      for (let i = 0; i < fields.length; i++) {
        const original = fields[i];
        let value = /[^\x00-\x7f]/.test(original) ? original.normalize("NFKC").toLowerCase() : original;
        if (value.includes("app")) value = value.replace(/app[\s-]*store/g, "appstore");
        if (value !== original) {
          if (fields === entry.fields) fields = fields.slice();
          fields[i] = value;
        }
      }
      const stars = validCount(skill.stars) ?? 0;
      return { entry, fields, stars, name: nameKey(skill.name),
        bonus: Math.min(20, Math.log10(stars + 1) * 4) - (stars <= 3 ? 150 : 0) - (collectionIds.has(skill.id) ? 250 : 0) };
    });
  }
  matches(options: SearchOptions, request: ReturnType<typeof rankedRequest>): RankedMatch[] {
    const candidates = this.candidates(options, request);
    return candidates.all.map(candidate => this.score(candidate, candidates.tokens));
  }
  select(options: SearchOptions, request: ReturnType<typeof rankedRequest>, offset: number, limit: number, validate: (id: string) => void) {
    const candidates = this.candidates(options, request, validate), total = candidates.all.length;
    if (offset > total) throw new PagingError("invalid_cursor");
    // Exact-ID/full-term matches always precede partial matches, regardless of score.
    const rows = offset + limit <= candidates.primary.length ? candidates.primary : candidates.all;
    return { total, matches: rankedWindow(rows.map(candidate => this.score(candidate, candidates.tokens)), offset, limit) };
  }
  private candidates(options: SearchOptions, request: ReturnType<typeof rankedRequest>, validate?: (id: string) => void) {
    const { tokens, author } = request, tag = options.tag?.toLowerCase().trim();
    const installable = options.installable ? this.installable : undefined;
    if (installable === null) throw new PagingError("installable_not_supported");
    const prepared = tokens.map(token => ({ token, partial: token.length >= 3 || /[^\x00-\x7f]/.test(token) }));
    const all: Candidate[] = [], primary: Candidate[] = [];
    for (const document of this.documents) {
      const { skill } = document.entry;
      if ((author && document.entry.author !== author)
        || (tag && !document.entry.tags.includes(tag)) || document.stars < (options.minStars ?? 0)
        || (installable && !installable.has(skill.id)) || this.isCopy(skill.id) || (author && this.isMirror(skill.id))) continue;
      let matched = 0;
      for (const token of prepared) {
        for (let i = 0; i < document.fields.length; i++) {
          const text = document.fields[i];
          if (token.partial ? text.includes(token.token) : fieldScore(text, token.token, false, 1, 0) > 0) {
            matched++; break;
          }
        }
      }
      const exactId = skill.id === request.query;
      if (!matched && !exactId) continue;
      validate?.(skill.id);
      const candidate = { document, matchedAll: matched === tokens.length, exactId };
      all.push(candidate);
      if (candidate.matchedAll || exactId) primary.push(candidate);
    }
    return { all, primary, tokens: prepared };
  }
  private score(candidate: Candidate, tokens: Token[]): RankedMatch {
    const { document, matchedAll, exactId } = candidate;
    let score = 0, matched = 0, corroboration = 0;
    for (const token of tokens) {
      let best = 0;
      for (let i = 0; i < fieldOrder.length; i++) {
        best = Math.max(best, fieldScore(document.fields[fieldOrder[i]], token.token, token.partial, weights[i][0], weights[i][1]));
        if (i === 0 && best === weights[0][0] && !corroboration
          && fieldScore(document.fields[3], token.token, false, 1, 0)) corroboration = 25;
        if (best >= (weights[i + 1]?.[0] ?? 0)) break;
      }
      if (best) { score += best; matched++; }
    }
    score += (matchedAll ? 1000 : -(tokens.length - matched) * 50) + document.bonus;
    score += corroboration;
    return { skill: document.entry.skill, score, matchedAll, exactId, name: document.name, stars: document.stars };
  }
}
export function compareRanked(a: RankedMatch, b: RankedMatch) {
  return Number(b.exactId) - Number(a.exactId) || Number(b.matchedAll) - Number(a.matchedAll)
    || b.score - a.score || b.stars - a.stars || compareText(a.name, b.name) || compareText(a.skill.id, b.skill.id);
}

/** Keep only the requested prefix; sorting every weak partial match dominates small pages. */
export function rankedWindow(matches: RankedMatch[], offset: number, limit: number) {
  const size = Math.min(matches.length, offset + limit);
  if (size >= matches.length / 2) return matches.sort(compareRanked).slice(offset, offset + limit);
  const heap: RankedMatch[] = [];
  for (const match of matches) {
    if (heap.length < size) {
      let index = heap.push(match) - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (compareRanked(heap[parent], heap[index]) >= 0) break;
        [heap[parent], heap[index]] = [heap[index], heap[parent]]; index = parent;
      }
    } else if (size && compareRanked(match, heap[0]) < 0) {
      heap[0] = match;
      let index = 0;
      while (index * 2 + 1 < size) {
        let child = index * 2 + 1;
        if (child + 1 < size && compareRanked(heap[child + 1], heap[child]) > 0) child++;
        if (compareRanked(heap[index], heap[child]) >= 0) break;
        [heap[index], heap[child]] = [heap[child], heap[index]]; index = child;
      }
    }
  }
  return heap.sort(compareRanked).slice(offset);
}
