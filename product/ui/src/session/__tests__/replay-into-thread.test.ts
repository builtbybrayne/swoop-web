// product/ui/src/session/__tests__/replay-into-thread.test.ts
//
// Unit coverage for the assistant-ui replay translator — D.t9-mount-rehydrate.
//
// Isolates the assistant-ui-version-specific code per decision D.27. If the
// library upgrade changes the message-import surface, these are the tests
// that fail first.

import { describe, expect, it, vi } from "vitest";
import type { MessagePart } from "@swoop/common";
import {
  REHYDRATED_MESSAGE_ID,
  replayPartsIntoThread,
} from "../replay-into-thread";

function makeRuntime() {
  return {
    thread: { reset: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("replayPartsIntoThread", () => {
  it("no-ops on empty parts (HITL: empty replay === fresh chat)", () => {
    const runtime = makeRuntime();
    replayPartsIntoThread(runtime, []);
    expect(runtime.thread.reset).not.toHaveBeenCalled();
  });

  it("calls reset with one synthetic assistant message holding all parts", () => {
    const runtime = makeRuntime();
    const parts: MessagePart[] = [
      { type: "text", text: "Hello " },
      { type: "text", text: "Patagonia." },
    ];
    replayPartsIntoThread(runtime, parts);
    expect(runtime.thread.reset).toHaveBeenCalledTimes(1);
    const messages = runtime.thread.reset.mock.calls[0]![0] as Array<{
      id: string;
      role: string;
      content: Array<{ type: string; text?: string }>;
    }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe(REHYDRATED_MESSAGE_ID);
    expect(messages[0]!.role).toBe("assistant");
    expect(messages[0]!.content).toEqual([
      { type: "text", text: "Hello " },
      { type: "text", text: "Patagonia." },
    ]);
  });

  it("skips reasoning parts (chunk B §2.4 invariant — defence in depth)", () => {
    const runtime = makeRuntime();
    const parts: MessagePart[] = [
      { type: "text", text: "visible" },
      // Reasoning is invariant-violation if it reaches the UI; we skip
      // rather than render private chain-of-thought.
      { type: "reasoning", text: "private chain-of-thought" },
    ];
    replayPartsIntoThread(runtime, parts);
    const messages = runtime.thread.reset.mock.calls[0]![0] as Array<{
      content: Array<{ type: string }>;
    }>;
    const types = messages[0]!.content.map((c) => c.type);
    expect(types).toEqual(["text"]);
    expect(types).not.toContain("reasoning");
  });

  it("translates data-fyi parts to the prefixed-part form", () => {
    const runtime = makeRuntime();
    const parts: MessagePart[] = [
      {
        type: "data-fyi",
        data: { message: "Looking it up…", timestamp: "2026-05-12T09:00:00.000Z" },
      },
    ];
    replayPartsIntoThread(runtime, parts);
    const messages = runtime.thread.reset.mock.calls[0]![0] as Array<{
      content: Array<{ type: string; data?: unknown }>;
    }>;
    expect(messages[0]!.content[0]!.type).toBe("data-fyi");
    expect(messages[0]!.content[0]!.data).toEqual({
      message: "Looking it up…",
      timestamp: "2026-05-12T09:00:00.000Z",
    });
  });

  it("translates tool-call input-available without result", () => {
    const runtime = makeRuntime();
    const parts: MessagePart[] = [
      {
        type: "tool-call",
        state: "input-available",
        toolCallId: "call-1",
        toolName: "find_inspiring",
        input: { vibe: "windy" },
      },
    ];
    replayPartsIntoThread(runtime, parts);
    const messages = runtime.thread.reset.mock.calls[0]![0] as Array<{
      content: Array<{
        type: string;
        toolCallId: string;
        toolName: string;
        args: unknown;
        result?: unknown;
      }>;
    }>;
    const tc = messages[0]!.content[0]!;
    expect(tc.type).toBe("tool-call");
    expect(tc.toolCallId).toBe("call-1");
    expect(tc.toolName).toBe("find_inspiring");
    expect(tc.args).toEqual({ vibe: "windy" });
    expect(tc.result).toBeUndefined();
  });

  it("translates tool-call output-available with result", () => {
    const runtime = makeRuntime();
    const parts: MessagePart[] = [
      {
        type: "tool-call",
        state: "output-available",
        toolCallId: "call-2",
        toolName: "find_inspiring",
        input: { vibe: "windy" },
        output: { passages: [] },
      },
    ];
    replayPartsIntoThread(runtime, parts);
    const messages = runtime.thread.reset.mock.calls[0]![0] as Array<{
      content: Array<{ result?: unknown; isError?: boolean }>;
    }>;
    expect(messages[0]!.content[0]!.result).toEqual({ passages: [] });
    expect(messages[0]!.content[0]!.isError).toBeUndefined();
  });

  it("skips unexpected input-streaming tool-call parts in projection", () => {
    const runtime = makeRuntime();
    const parts: MessagePart[] = [
      {
        type: "tool-call",
        state: "input-streaming",
        toolCallId: "call-3",
        toolName: "find_inspiring",
        inputFragment: '{"vibe":',
      },
      { type: "text", text: "after" },
    ];
    replayPartsIntoThread(runtime, parts);
    const messages = runtime.thread.reset.mock.calls[0]![0] as Array<{
      content: Array<{ type: string }>;
    }>;
    const types = messages[0]!.content.map((c) => c.type);
    expect(types).toEqual(["text"]);
  });
});
