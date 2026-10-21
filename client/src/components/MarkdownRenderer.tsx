import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  content: string;
  className?: string;
};

export function MarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const normalizedContent = React.useMemo(
    () => content?.replace(/\n{3,}/g, "\n\n") ?? "",
    [content]
  );

  return (
    <div
      className={cn(
        "prose prose-sm dark:prose-invert max-w-none min-w-0",
        "prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node, ...props }) => (
            <div className="my-2 min-w-0 max-w-full">
              <div className="mb-1 text-xs text-muted-foreground">Широкую таблицу можно прокрутить влево и вправо.</div>
              <div role="region" aria-label="Таблица: горизонтальная прокрутка" tabIndex={0}
                style={{maxWidth:"100%",overflowX:"auto",overscrollBehaviorX:"contain"}}>
              <table
                className="border-collapse text-sm [&_thead_tr]:bg-muted [&_th]:font-semibold"
                style={{tableLayout:"auto",width:"max-content",minWidth:"100%",maxWidth:"none",wordBreak:"normal",overflowWrap:"normal"}}
                {...props}
              />
              </div>
            </div>
          ),
          th: ({ node, ...props }) => (
            <th
              className="border border-border px-3 py-1 text-left leading-tight"
              style={{minWidth:110,maxWidth:280,whiteSpace:"normal",wordBreak:"normal",overflowWrap:"normal"}}
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td
              className="border border-border px-3 py-1 align-top"
              style={{minWidth:110,maxWidth:280,whiteSpace:"normal",wordBreak:"normal",overflowWrap:"normal"}}
              {...props}
            />
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc space-y-1 pl-5 leading-snug" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol
              className="list-decimal space-y-1 pl-5 leading-snug"
              {...props}
            />
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
    </div>
  );
}
