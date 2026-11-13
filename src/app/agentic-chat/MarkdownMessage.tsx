"use client";

import { useRef, type ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { copyText } from "@/lib/mutate";
import { safeMarkdownUrl, stabilizeStreamingMarkdown } from "./markdown";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <CopyablePre>{children}</CopyablePre>,
};

function CopyablePre({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="relative">
      <button
        type="button"
        className="absolute right-2 top-2 min-h-11 rounded-lg px-2 text-xs font-semibold text-white/90 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => void copyText(ref.current?.innerText ?? "")}
      >
        Copy
      </button>
      <pre ref={ref} className="md-pre">
        {children}
      </pre>
    </div>
  );
}

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
