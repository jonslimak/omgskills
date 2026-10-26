export function descriptionParagraphs(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const explicit = normalized.split(/[\n\v\f\u0085\u2028\u2029]/)
    .map(paragraph => paragraph.trim()).filter(Boolean);
  if (explicit.length > 1) return explicit;

  // Match the Mac's sentence boundaries without changing punctuation or bullets.
  const sentences = normalized.split(". ");
  return sentences.map((sentence, index) =>
    `${sentence}${index < sentences.length - 1 ? "." : ""}`.trim(),
  ).filter(Boolean);
}

// A sentence that tells the agent when to use the skill ("Use when ...", "This skill should be used when ...").
const whenSentence = /^\W*(always )?(use|apply|invoke|activate[sd]?|trigger(s|ed)?|load|run|consult|this skill should be used|should be used)\b[^.]{0,40}?\b(when|whenever|if|for|on|any time|before|after|during|proactively)\b/i;
const negativeSentence = /^\W*(do not|don't|not for|never|avoid|skip)\b/i;
// Mostly a list of quoted trigger phrases for the agent, e.g. Use when asked to "open chrome", "launch browser", ...
const quotedPhrase = /(^|[\s(,:])["“'‘][^"“”'‘’]{1,60}["”'’]/g;

/** The opening "Use when ..." phrase of a paragraph, shown semi-bold, or "" when it has none. */
export function whenLead(paragraph: string): string {
  return negativeSentence.test(paragraph) ? "" : paragraph.match(whenSentence)?.[0] ?? "";
}

/**
 * The one line shown before "Show more": the "Use when" sentence, or the first sentence when
 * there is none or it is a list of quoted trigger phrases. Null when the whole description is shown.
 */
export function descriptionSummary(text: string): string | null {
  const paragraphs = descriptionParagraphs(text);
  if (text.trim().length <= 200 || paragraphs.length <= 1) return null;
  const when = paragraphs.find(paragraph => whenSentence.test(paragraph) && !negativeSentence.test(paragraph));
  return when && (when.match(quotedPhrase)?.length ?? 0) < 3 ? when : paragraphs[0];
}
