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
