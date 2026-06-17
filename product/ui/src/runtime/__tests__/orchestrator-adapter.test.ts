// product/ui/src/runtime/__tests__/orchestrator-adapter.test.ts
//
// RL.7 — text-segment separator restoration in `translatePart`.
//
// Every text part in an orchestrator turn shares ONE assistant text block
// (one id from `makeTextId`), so assistant-ui concatenates their deltas
// verbatim. When a tool call splits two text segments, the join lost its
// boundary (`…alive.` + `Patagonia…` → `…alive.Patagonia`). The fix restores
// a single-space boundary at that seam only — never between the token-level
// deltas of one continuous segment, and never when whitespace already exists.
//
// See planning/03-exec-crosscut-reasoning-leak-native-thinking.md (RL.7).

import { describe, expect, it } from "vitest";

import { translatePart } from "../orchestrator-adapter";

type Part = Parameters<typeof translatePart>[0];
type Chunk = { type: string; delta?: string; id?: string };

/** Run a sequence of parts through one shared text-run state. */
function run(parts: readonly Part[]): Chunk[] {
  const captured: Chunk[] = [];
  const controller = {
    enqueue: (c: Chunk) => {
      captured.push(c);
    },
  } as unknown as Parameters<typeof translatePart>[1];
  const textState: Parameters<typeof translatePart>[2] = { id: null };
  const seen: Parameters<typeof translatePart>[3] = new Set<string>();
  for (const p of parts) translatePart(p, controller, textState, seen);
  return captured;
}

const deltas = (chunks: readonly Chunk[]): string[] =>
  chunks.filter((c) => c.type === "text-delta").map((c) => c.delta ?? "");

const text = (t: string): Part => ({ type: "text", text: t });
const toolAvailable = (id: string): Part => ({
  type: "tool-call",
  state: "input-available",
  toolCallId: id,
  toolName: "find_options",
  input: {},
});

describe("translatePart — RL.7 text-segment separator", () => {
  it("restores a single space when a tool call splits two text segments", () => {
    const out = run([
      text("Keeps the spirit alive."),
      toolAvailable("call-1"),
      text("Patagonia sits at the tap."),
    ]);
    expect(deltas(out)).toEqual([
      "Keeps the spirit alive.",
      " Patagonia sits at the tap.",
    ]);
  });

  it("does not insert whitespace between streamed deltas of one continuous segment", () => {
    const out = run([text("Pata"), text("gonia"), text(" sits")]);
    expect(deltas(out)).toEqual(["Pata", "gonia", " sits"]);
    expect(deltas(out).join("")).toBe("Patagonia sits");
  });

  it("does not double the space when the post-tool segment already leads with whitespace", () => {
    const out = run([text("alive."), toolAvailable("call-1"), text(" Patagonia")]);
    expect(deltas(out)).toEqual(["alive.", " Patagonia"]);
  });

  it("does not add a space when the pre-tool segment already trails with whitespace", () => {
    const out = run([text("alive. "), toolAvailable("call-1"), text("Patagonia")]);
    expect(deltas(out)).toEqual(["alive. ", "Patagonia"]);
  });

  it("adds no leading separator when a tool call precedes the first text", () => {
    const out = run([toolAvailable("call-1"), text("Patagonia")]);
    expect(deltas(out)).toEqual(["Patagonia"]);
  });

  it("restores exactly one space across a multi-frame tool interruption", () => {
    const out = run([
      text("Let me look."),
      {
        type: "tool-call",
        state: "input-streaming",
        toolCallId: "c1",
        toolName: "find_options",
        inputFragment: "{",
      },
      {
        type: "tool-call",
        state: "input-available",
        toolCallId: "c1",
        toolName: "find_options",
        input: {},
      },
      {
        type: "tool-call",
        state: "output-available",
        toolCallId: "c1",
        toolName: "find_options",
        input: {},
        output: {},
      },
      text("Here are options."),
    ]);
    expect(deltas(out)).toEqual(["Let me look.", " Here are options."]);
  });

  it("keeps the whole turn in one text block (single text-start)", () => {
    const out = run([text("alive."), toolAvailable("call-1"), text("Patagonia")]);
    expect(out.filter((c) => c.type === "text-start")).toHaveLength(1);
  });
});
