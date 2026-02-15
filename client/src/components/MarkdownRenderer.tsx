import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  const normalizedContent = React.useMemo(
    () => content?.replace(/\n{3,}/g, "\n\n") ?? "",
    [content]
  );

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none",
        "prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
        className
      )}
      components={{
        table: ({ node, ...props }) => (
          <div className="my-2 overflow-x-auto">
            <table
              className="w-full border-collapse text-sm [&_thead_tr]:bg-muted [&_th]:font-semibold"
              {...props}
            />
          </div>
        ),
        th: ({ node, ...props }) => (
          <th
            className="border border-border px-3 py-1 text-left leading-tight"
            {...props}
          />
        ),
        td: ({ node, ...props }) => (
          <td className="border border-border px-3 py-1 align-top" {...props} />
        ),
        ul: ({ node, ...props }) => (
          <ul className="list-disc space-y-1 pl-5 leading-snug" {...props} />
        ),
        ol: ({ node, ...props }) => (
          <ol className="list-decimal space-y-1 pl-5 leading-snug" {...props} />
        ),
        li: ({ node, ...props }) => (
          <li className="my-0.5 leading-snug" {...props} />
        ),
        p: ({ node, ...props }) => (
          <p className="my-1 leading-relaxed" {...props} />
        ),
        h3: ({ node, ...props }) => (
          <h3 className="mt-3 mb-1 text-base font-semibold" {...props} />
        ),
        h4: ({ node, ...props }) => (
          <h4 className="mt-3 mb-1 text-base font-semibold" {...props} />
        ),
      }}
    >
      {normalizedContent}
    </ReactMarkdown>
  );
}


