"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { safeMarkdownUrl, stabilizeStreamingMarkdown } from "./markdown";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

/** Assistant text is markdown. Raw HTML is not passed through. */
export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={safeMarkdownUrl} components={components}>
        {stabilizeStreamingMarkdown(text)}
      </ReactMarkdown>
    </div>
  );
}
