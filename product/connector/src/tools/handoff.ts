/**
 * `handoff` handler — open the lead-capture widget.
 *
 * Per decision E.13: this tool returns `{ status: 'widget_triggered',
 * widgetToken }` and nothing else. No durable side-effect. The widget consumes
 * the token + the input args via the assistant-ui tool-call lifecycle;
 * submission is a separate HTTP route (`POST /handoff/submit`).
 *
 * Per HITL Q6 ratification: widgetToken is stateless for M1 — a debugging
 * breadcrumb the widget echoes back, not an auth surface. `crypto.randomUUID()`.
 */

import { randomUUID } from 'node:crypto';

import {
  HandoffInputSchema,
  HandoffOutputSchema,
  type HandoffInput,
  type HandoffOutput,
} from '@swoop/common';

export async function handoffBody(
  _input: HandoffInput,
): Promise<HandoffOutput> {
  return HandoffOutputSchema.parse({
    status: 'widget_triggered' as const,
    widgetToken: randomUUID(),
  });
}

export const handoffSpec = {
  name: 'handoff' as const,
  inputSchema: HandoffInputSchema,
  outputSchema: HandoffOutputSchema,
};
