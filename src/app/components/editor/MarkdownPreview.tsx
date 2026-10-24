"use client";

// Safe rendered reading preview for Markdown.
//
// react-markdown builds React elements from the mdast/hast tree — no
// dangerouslySetInnerHTML is used anywhere. Raw HTML in the source is not
// rendered (react-markdown ignores raw nodes by default); unsafe URLs are
// removed by the tested safePreviewUrl policy; remote images are never
// fetched and show an unsupported-resource notice; KaTeX runs with
// trust:false so math macros cannot inject extra resources.

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { safePreviewUrl } from '@/src/lib/markdown-preview';

function PreviewImage({ src, alt }: { src?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const safe = src ? safePreviewUrl(src, 'image') : null;
  if (!safe) {
    return (
      <span
        role="note"
        className="inline-block border border-warning/40 bg-warning-subtle text-warning rounded px-2 py-1 text-xs my-1"
      >
        Unsupported image{alt ? `: “${alt}”` : ''} — only images uploaded to this document are shown or compiled.
      </span>
    );
  }
  if (failed) {
    return (
      <span
        role="note"
        className="inline-block border border-destructive/40 bg-destructive-subtle text-destructive rounded px-2 py-1 text-xs my-1"
      >
        Image not found{alt ? `: “${alt}”` : ''} — upload it as a document asset.
      </span>
    );
  }
  return <img src={safe} alt={alt ?? ''} loading="lazy" onError={() => setFailed(true)} className="max-w-full h-auto" />;
}

function SafeLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const safe = href ? safePreviewUrl(href, 'link') : null;
  if (!safe) {
    return <span title="Unsafe link removed">{children}</span>;
  }
  const isExternal = /^https?:/i.test(safe);
  return (
    <a
      href={safe}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      target={isExternal ? '_blank' : undefined}
      className="text-action underline underline-offset-2"
    >
      {children}
    </a>
  );
}

interface MarkdownPreviewProps {
  source: string;
  /** Used for aria/labeling context by the pane. */
  className?: string;
}

export default function MarkdownPreview({ source, className }: MarkdownPreviewProps) {
  return (
    <div
      className={`markdown-preview font-serif max-w-none text-foreground leading-relaxed [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:whitespace-pre [&_table]:block [&_table]:overflow-x-auto [&_table]:max-w-full [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:my-3 [&_code]:font-mono [&_code]:bg-code-bg [&_code]:text-code-text [&_code]:px-1 [&_code]:rounded [&_pre_code]:bg-transparent [&_pre_code]:text-code-text [&_pre_code]:px-0 [&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_hr]:border-border [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_.katex]:overflow-x-auto [&_.katex]:max-w-full`}
      data-testid="markdown-reading-preview"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: 'html', throwOnError: false, strict: 'ignore', trust: false, errorColor: '#9c3a2e' }]]}
        urlTransform={(url) => (typeof url === 'string'
          ? safePreviewUrl(url, 'link') ?? safePreviewUrl(url, 'image') ?? ''
          : '')}
        components={{
          a: ({ node, ...props }) => <SafeLink {...props} />,
          pre: ({ node, className: preClassName, ...props }) => (
            <pre
              {...props}
              className={`my-4 max-w-full overflow-x-auto rounded-lg border border-border bg-code-bg px-4 py-3 font-mono text-[13px] leading-6 text-code-text ${preClassName ?? ''}`}
            />
          ),
          img: ({ node, ...props }) => (
            <PreviewImage
              src={typeof props.src === 'string' ? props.src : undefined}
              alt={typeof props.alt === 'string' ? props.alt : undefined}
            />
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
