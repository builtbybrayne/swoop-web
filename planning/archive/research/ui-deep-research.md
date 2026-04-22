# React + Tailwind UI kits for AI agents in 2026

**The ecosystem has consolidated around shadcn/ui + Tailwind + Vercel AI SDK message-parts as a de facto standard.** For LOPE's three hard requirements — streaming, interim status, and inline custom React widgets — only a handful of libraries hit all three with minimal baked-in styling. The clearest winners are **assistant-ui**, **Vercel AI Elements**, and **Tambo AI**, with **Prompt Kit** and **Kibo UI** as excellent pick-and-mix primitives. Most other options either ship opinionated CSS, are full apps rather than libraries, or haven't kept up with 2025's tool-call/generative-UI patterns.

Context: Vercel AI SDK v5 introduced a `message.parts` schema (text parts, tool-call parts with `input-streaming`/`input-available`/`output-available` states, reasoning parts) that essentially every modern Tailwind-native library now mirrors. This is why so many libraries below look feature-identical at a surface level — they're all rendering the same underlying stream.

## The headline comparison

| Library | Style approach | Install model | Streaming | Interim/tool status | Custom widgets | Backend coupling | Maintained |
|---|---|---|---|---|---|---|---|
| **assistant-ui** | Headless Radix-style primitives + shadcn starter | Hybrid: npm core + `npx assistant-ui create` scaffold | ✅ First-class | ✅ Dedicated `tool-call` part + `useToolArgsStatus`, reasoning, HITL interrupts | ✅ **Best-in-class** via `makeAssistantToolUI({ toolName, render })` with partial-arg streaming | Agnostic (adapters: AI SDK, LangGraph, Mastra, AG-UI, A2A, custom) | Very active (~9.6k ⭐, weekly releases) |
| **Vercel AI Elements** | shadcn registry, Tailwind-native | `npx ai-elements@latest add …` (copy-paste) | ✅ Via AI SDK 5 parts | ✅ `Tool`, `Reasoning`, `Sources`, `Task`, `Plan`, `Queue` components | ⚠️ DIY: switch on `part.type === 'tool-getX'` yourself | Hard-tied to Vercel AI SDK 5 `useChat` | Very active (~1.9k ⭐, v1.9.0 Mar 2026) |
| **Tambo AI** | shadcn + Tailwind tokens ("neutral by default") | `npx tambo add` for UI + `@tambo-ai/react` runtime | ✅ Streams props into components | ✅ Via stream status, MCP tool-call state | ✅ **Thesis of the library** — Zod-schema component registry, `withInteractable` persistent widgets | Uses its own agent runtime (Tambo Cloud or self-hosted backend) | Very active (~10.8k ⭐, daily commits) |
| **Prompt Kit** | shadcn registry, Tailwind-native | `npx shadcn add prompt-kit/…` | ✅ `ResponseStream`, streaming Markdown | ✅ `Reasoning`, `Thinking Bar`, `Chain of Thought`, `Tool`, `Steps`, `Loader` | ⚠️ Pattern-based, plus `JSXPreview`; no registry abstraction | Agnostic, AI-SDK-aligned | Active (~2.7k ⭐) |
| **Kibo UI (AI)** | shadcn registry, Tailwind-native | `npx kibo-ui@latest add …` | ✅ | ✅ `ai-reasoning`, `ai-tool`, `ai-source` | ⚠️ Pattern-based on `message.parts` | Agnostic, AI-SDK-aligned | Active (MIT, recently acquired by Shadcnblocks) |
| **@llamaindex/chat-ui** | shadcn + Tailwind | npm or `npx shadcn add https://ui.llamaindex.ai/r/chat.json` | ✅ Via AI SDK `useChat` | ⚠️ Relies on AI SDK parts | ✅ "Custom widgets" is a headline feature | AI-SDK-aligned | Active |
| **CopilotKit** | Own CSS tokens (not shadcn); headless hooks available | `@copilotkit/react-core/ui/runtime` | ✅ Tokens + agent state | ✅ Tool-call + `useCoAgent` live state | ✅ `useCopilotAction` with `render` prop | AG-UI protocol (LangGraph/Mastra/CrewAI/etc.) | Very active (~30k ⭐) |
| **LangGraph agent-chat-ui** | shadcn + Tailwind, **full Next.js app** | Template clone / `create-agent-chat-app` | ✅ `useStream` | ✅ Tool calls, HITL `HumanInterrupt` UI | ✅ LangGraph generative UI (`push_ui_message`) | **LangGraph-only** | Active (~2.5k ⭐) |
| **Vercel AI Chatbot template** | shadcn + Tailwind + Radix, **full Next.js app** | Fork the repo | ✅ | ✅ | ✅ RSC `streamUI` | AI SDK + Postgres + Auth.js + Blob | Active |
| **shadcn-chat (jakobhoeg)** | shadcn + Tailwind | `npx shadcn-chat-cli add` | ⚠️ UI only, wire it yourself | ❌ Typing dots only | ❌ | Agnostic | **Stale** (last commit May 2025) |
| **deep-chat** | Web Component, **Shadow DOM** | `npm i deep-chat-react` | ✅ | ⚠️ `displayLoadingBubble` | ⚠️ Custom HTML/props | Agnostic | Active (~3.3k ⭐) |
| **NLUX** | Own CSS themes | npm per-package | ✅ | ❌ No tool-call primitive | ⚠️ Personas/renderers | Agnostic | **Slowing** (no 2026 commits confirmed) |
| **@chatscope/chat-ui-kit-react** | Bundled SCSS | npm + mandatory CSS import | ❌ Wire it yourself | ❌ No AI primitives | ❌ | Agnostic | **Stagnant** (styles pkg unpublished ~4 yrs) |
| **Mastra Playground UI** | Tailwind + shadcn-style | `mastra dev` serves it | ✅ | ✅ | ⚠️ Dev console only | Mastra-only (dev) | Very active |
| **LibreChat** | Tailwind + Radix, **full app** | Self-host (Mongo + Meilisearch) | ✅ | ✅ MCP, artifacts, reasoning | ⚠️ Artifacts/code-interp only | Full backend | Very active (~35k ⭐, ISC) |
| **mckaywrigley/chatbot-ui** | shadcn + Tailwind, full app | Fork | ✅ | ⚠️ Pre-modern | ❌ | Next.js + Supabase | **Dormant** |
| **LangChain Open Agent Platform** | shadcn + Tailwind, full app | Fork | ✅ | ✅ | ✅ | LangGraph Platform | **⚠️ Archived Feb 25 2026** |
| **Agent Inbox** | shadcn + Tailwind, full app | Fork | N/A (inbox, not chat) | ✅ `HumanInterrupt` schema | Narrow: HITL review only | LangGraph | Active |

## Deep dives on the five that actually matter for LOPE

### assistant-ui is the default choice for tool-driven agents

`@assistant-ui/react` is the only library with a **convention-driven tool-call → React-component registry** (`makeAssistantToolUI({ toolName, render })`), complete with **partial-arg streaming** (`useToolArgsStatus` exposes `propStatus` per arg key as it streams), human-in-the-loop `interrupt`/`resume`, and a default fallback UI for unregistered tools. The architecture is Radix-style headless primitives layered with a shadcn/ui + Tailwind starter theme that gets copied into your repo via `npx assistant-ui create`. Runtime is pluggable — you pick an adapter (AI SDK, LangGraph, Mastra, A2A, AG-UI) or write a custom one. Users include LangChain, Helicone, Stack AI, Browser Use. **Watch the churn**: pre-1.0 semver with weekly releases, several open integration bugs around AI SDK v5 (#2369, #2490), and `ExternalStoreRuntime` docs are thin. License MIT; optional paid Assistant Cloud for persistence is a soft upsell but everything works without it.

### Vercel AI Elements is the pragmatic shadcn choice if you're already on AI SDK 5

`vercel/ai-elements` — authored by Hayden Bleasel (also creator of Kibo UI) — ships 25+ components as a **pure shadcn registry** (`npx ai-elements@latest add <component>`): Conversation, Message, PromptInput (+ Tools/Richtext), Reasoning (auto-opens during streaming), Sources, Suggestion, Tool (+ ToolHeader/Input/Output with `input-streaming`/`output-available` states), Task, Plan, Queue, Checkpoint, CodeBlock, Terminal, FileTree, Persona. Generative UI is deliberately **unabstracted** — you write `switch(part.type) { case 'tool-getWeather': return <MyWeatherCard/> }` yourself. That's more wiring than assistant-ui, but zero magic. **Trade-off**: hard-coupled to `@ai-sdk/react` `useChat` and AI SDK 5's `message.parts` shape. Actively developed (v1.9.0 March 2026).

### Tambo AI is the right pick if your agent *is* the UI

If LOPE's UX is "the agent paints arbitrary dashboards, forms, charts" more than "chat bubbles with occasional cards", **Tambo is structurally better than assistant-ui**. You register React components with Zod schemas via `TamboProvider` and the agent streams props into them. Two modes: generative (one-shot) and **`withInteractable(Component, {…})`** for widgets that persist across turns and can be updated by the agent (forms, task boards, spreadsheets). Full MCP support. **Cost**: adopting Tambo means adopting its conversation runtime — either Tambo Cloud (SOC 2 / HIPAA claimed) or self-hosted `tambo-cloud` — rather than dropping components into an existing `useChat` loop. Users include Zapier, Rocket Money, Solink. MIT, ~10.8k ⭐, extremely active.

### Prompt Kit and Kibo UI are great primitive-libraries to mix and match

Both are pure shadcn-style copy-paste registries, both Tailwind-native, both MIT, both active. **Prompt Kit** (ibelick) leans into streaming text primitives — `ResponseStream`, `Reasoning`, `Thinking Bar`, `Chain of Thought`, `JSXPreview` — but has no tool-to-component registry abstraction; you wire generative UI by pattern-matching `message.parts` yourself. **Kibo UI** covers similar ground (`ai-input`, `ai-reasoning`, `ai-tool`, `ai-response`) inside a broader component library (Gantt/Kanban/etc. dominate its identity). Neither is a complete chat framework — they're primitives you compose into your own flow. **Idiomatic use**: run assistant-ui's runtime for state + tool registry, but pull Prompt Kit's `PromptInput` or Kibo's `ai-reasoning` if you prefer their specific designs.

### CopilotKit is powerful but its styling story doesn't fit

CopilotKit is the AG-UI protocol maker (adopted by Google, LangChain, AWS, Microsoft, Mastra, Pydantic AI) and has **generative UI nailed** via `useCopilotAction` with a `render` prop. But its pre-built `<CopilotPopup/>`/`<CopilotSidebar/>` components ship **their own CSS token system, not shadcn/ui or Tailwind**. As of v1.52 they added a `cpk` Tailwind-merge prefix to stop leaking into host styles — acknowledging the pain. To use CopilotKit cleanly in a Tailwind/shadcn project, you drop the pre-built UI and use only the headless hooks (`useCopilotChat`, `useCoAgent`, `useFrontendTool`, `useRenderToolCall`) — at which point you're doing the same work as assistant-ui with a more complex runtime. Worth it only if LOPE needs AG-UI's cross-framework agent interop.

## Projects to quietly skip

**shadcn-chat (jakobhoeg)** — last meaningful commit May 2025, demo down, no tool-call primitives. Too limited and too stale. **NLUX** — pre-bundled CSS, no tool-call UI, commits trailed off after November 2025. **@chatscope/chat-ui-kit-react** — designed pre-LLM for human-to-human chat, bundled SCSS, styles package unpublished in ~4 years. **deep-chat** — excellent feature breadth but its Shadow DOM makes Tailwind utilities useless; styling is JS-object config. Only pick it if you need a drop-in widget for a non-React host. **mckaywrigley/chatbot-ui** — dormant since mid-2024, good as a reference fork, not a 2026 foundation. **LangChain Open Agent Platform** — **archived 25 Feb 2026**; don't start new work on it.

The **full apps** (Vercel AI Chatbot template, LibreChat, Chatbot UI) are fine references but not libraries — you'd fork and gut them, not embed components. LibreChat is the only one of the three that's thriving, but it's a self-hosted ChatGPT clone, not a UI kit.

## The gaps in the ecosystem

Three real holes remain. **First, no library yet cleanly handles multi-agent / hierarchical agent UIs** — rendering a supervisor that spawns child agents with their own tool calls. Assistant-ui gets closest via sub-conversation tool UIs but it's not a first-class pattern anywhere. **Second, tool-picker input UX** (think Cursor-style `@`-mentions for available tools in the composer) is not built-in in any shadcn-registry library — Prompt Kit has an open issue requesting it (#66). **Third, agent-observability components in the chat itself** (latency, token counts, cost, trace links inline per message) are absent — you either punt to LangSmith/Langfuse/Helicone or build them yourself. For LOPE as a prompt-engineering tool, that last gap may matter; consider budgeting component work for a cost/latency sidebar.

## Opinionated shortlist for LOPE

1. **assistant-ui** — best overall fit. Only library with a first-class tool-call registry + partial-arg streaming + HITL interrupts, on a headless-primitives + shadcn-starter model you fully own.
2. **Vercel AI Elements** — best pragmatic pick if LOPE is already on Vercel AI SDK 5. Pure shadcn copy-paste, 25+ AI-specific primitives, zero magic, deep SDK coupling.
3. **Tambo AI** — best if LOPE's UX is "agent-drives-the-screen" rather than chat-first. Zod-schema component registry is unmatched; accept their runtime as the cost.
4. **Prompt Kit** — best for mixing into any of the above. Clean shadcn primitives for reasoning/thinking/chain-of-thought, drop in alongside assistant-ui or AI Elements.
5. **Kibo UI (AI)** — honorable mention; same mix-and-match role as Prompt Kit with a slightly different design sensibility.

**Concrete recommendation**: Start with assistant-ui for the runtime + tool-UI registry, and cherry-pick individual primitives from Vercel AI Elements or Prompt Kit where their designs happen to match LOPE's aesthetic. If LOPE evolves toward agent-rendered dashboards rather than conversational UI, migrate the generative-UI surface to Tambo while keeping assistant-ui for the chat pane.