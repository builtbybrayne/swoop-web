// -----------------------------------------------------------------------------
// Streaming message parts.
//
// Aligned to Vercel AI SDK v5 `message.parts` shape per planning/02-impl-foundations.md
// §6 + planning/02-impl-agent-runtime.md §2.4. The library moves — confirm the
// exact part discriminators at implementation time (B.t4 / D.t2). This stub
// covers the four block types Puma emits:
//
//   - TextPart       — user-visible `<utter>` content.
//   - ToolCallPart   — tool invocation lifecycle (input-streaming / input-available
//                      / output-available). `<adjunct>` blocks surface here too.
//   - ReasoningPart  — `<reasoning>`. PERSISTED to session history for agent memory,
//                      but STRIPPED from the outbound SSE stream (chunk B §2.4).
//   - CustomDataPart — discriminated-union slot for custom part types. The first
//                      consumer is `data-fyi` (the `<fyi>` side-channel, chunk B §2.5a).
//
// Kept tight; chunk B owns the translator that produces these and chunk D owns
// the renderer that consumes them.
// -----------------------------------------------------------------------------

import { z } from "zod";

// -----------------------------------------------------------------------------
// Text
// -----------------------------------------------------------------------------

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextPart = z.infer<typeof TextPartSchema>;

// -----------------------------------------------------------------------------
// Reasoning — never sent to the browser; kept here so the translator can
// emit it as a structured part into session history before stripping the
// outbound copy.
// -----------------------------------------------------------------------------

export const ReasoningPartSchema = z.object({
  type: z.literal("reasoning"),
  text: z.string(),
});
export type ReasoningPart = z.infer<typeof ReasoningPartSchema>;

// -----------------------------------------------------------------------------
// Tool-call — three lifecycle states modelled as a discriminated union on
// `state`. `input` is the tool's Zod-validated input; `output` is its
// Zod-validated output (shape depends on the tool).
// -----------------------------------------------------------------------------

export const ToolCallInputStreamingSchema = z.object({
  type: z.literal("tool-call"),
  state: z.literal("input-streaming"),
  toolCallId: z.string(),
  toolName: z.string(),
  inputFragment: z.string().optional(),
});
export type ToolCallInputStreaming = z.infer<typeof ToolCallInputStreamingSchema>;

export const ToolCallInputAvailableSchema = z.object({
  type: z.literal("tool-call"),
  state: z.literal("input-available"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
});
export type ToolCallInputAvailable = z.infer<typeof ToolCallInputAvailableSchema>;

export const ToolCallOutputAvailableSchema = z.object({
  type: z.literal("tool-call"),
  state: z.literal("output-available"),
  toolCallId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  isError: z.boolean().optional(),
});
export type ToolCallOutputAvailable = z.infer<typeof ToolCallOutputAvailableSchema>;

export const ToolCallPartSchema = z.discriminatedUnion("state", [
  ToolCallInputStreamingSchema,
  ToolCallInputAvailableSchema,
  ToolCallOutputAvailableSchema,
]);
export type ToolCallPart = z.infer<typeof ToolCallPartSchema>;

// -----------------------------------------------------------------------------
// Custom data parts — discriminated union slot. First member: `data-fyi` (the
// `<fyi>` side-channel; chunk B §2.5a). New custom types are added by
// extending this union.
// -----------------------------------------------------------------------------

export const DataFyiPartSchema = z.object({
  type: z.literal("data-fyi"),
  data: z.object({
    message: z.string(),
    timestamp: z.string().datetime(),
  }),
});
export type DataFyiPart = z.infer<typeof DataFyiPartSchema>;

export const CustomDataPartSchema = z.discriminatedUnion("type", [DataFyiPartSchema]);
export type CustomDataPart = z.infer<typeof CustomDataPartSchema>;

// -----------------------------------------------------------------------------
// Composite message part — what the translator emits per stream event.
// -----------------------------------------------------------------------------

export const MessagePartSchema = z.union([
  TextPartSchema,
  ReasoningPartSchema,
  ToolCallPartSchema,
  CustomDataPartSchema,
]);
export type MessagePart = z.infer<typeof MessagePartSchema>;
