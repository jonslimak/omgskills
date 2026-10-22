import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function readmeLink(url: string, sourceUrl: string): string {
  try {
    const resolved = new URL(url, sourceUrl);
    return ["https:", "http:"].includes(resolved.protocol) && !resolved.username && !resolved.password ? resolved.href : "";
  } catch { return ""; }
}

export default function ReadmeMarkdown({ markdown, sourceUrl }: { markdown: string; sourceUrl: string }) {
  return <div className="ua-readme-markdown">
    <Markdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={url => readmeLink(url, sourceUrl)} components={{
      img: () => null,
      a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
      table: ({ children }) => <div className="ua-readme-table"><table>{children}</table></div>,
    }}>{markdown}</Markdown>
  </div>;
}
