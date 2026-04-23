// product/ui/src/parts/fyi-signaling-text.tsx
//
// Thin wrapper over the D.t1 default text renderer that also emits a
// `text-arrived` signal on the first render with non-empty content. The
// `<fyi>` renderer listens for this and fades its status line immediately so
// a stale "searching…"-style affordance doesn't linger once the real reply
// starts streaming (decision D.10 + planning/02-impl-chat-surface.md §2.3).
//
// Visual output MUST match the D.t1 scaffold's text treatment; we're only
// adding a side-effect-free subscription hook. If D.t1's text style changes,
// update the class list here to match.

import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { emitFyiChannel } from "./fyi-channel";

export type FyiSignalingTextProps = {
  /** Current text content of the part (as emitted by assistant-ui). */
  text: string;
};

/**
 * Signals the fyi channel once text content starts flowing, then renders
 * the text via react-markdown (GFM: bold, italic, lists, code, links, etc.).
 * No HTML pass-through — rehype-raw is NOT enabled, so model output cannot
 * inject HTML / scripts.
 */
export function FyiSignalingText({ text }: FyiSignalingTextProps) {
  useEffect(() => {
    if (text.length > 0) {
      emitFyiChannel("text-arrived");
    }
  }, [text.length === 0]);

  return (
    <div className="prose prose-slate prose-sm max-w-none break-words [&_a]:text-slate-900 [&_a]:underline [&_a]:underline-offset-2 [&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_pre]:bg-slate-100 [&_pre]:p-2 [&_pre]:rounded [&_code]:text-[13px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Ensure links open in a new tab safely. assistant-ui's default
          // text renderer would otherwise inherit target=_self behaviour.
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

FyiSignalingText.displayName = "FyiSignalingText";
