/**
 * `handoff_submit` handler — thin wrapper over submitHandoff().
 *
 * Per HITL Q2 ratification: MCP tool exists for symmetry with the eight-tool
 * advertised contract + future-proofing. **Sonnet does not invoke this** — the
 * widget POSTs to /handoff/submit directly per decision E.13. The wrapper
 * shape is here for the assistant-ui tool-result registry's validation.
 *
 * The MCP-shape input (`HandoffSubmitInputSchema` from @swoop/common — a
 * minimal trigger envelope with widgetToken + contact + consent) is not the
 * same as the full `HandoffPayload` `submitHandoff()` consumes. So this
 * handler currently rejects with a typed error pointing the caller at the
 * HTTP route — flagging the misuse loud enough that any actual invocation
 * surfaces it. If a future architecture shifts submission onto MCP, the
 * mapping from MCP-input → HandoffPayload lands here.
 */

import {
  HandoffSubmitInputSchema,
  HandoffSubmitOutputSchema,
  type HandoffSubmitInput,
  type HandoffSubmitOutput,
} from '@swoop/common';

export async function handoffSubmitBody(
  _input: HandoffSubmitInput,
): Promise<HandoffSubmitOutput> {
  return HandoffSubmitOutputSchema.parse({
    status: 'rejected' as const,
    rejectionReason:
      'handoff_submit must be invoked via POST /handoff/submit (decision E.13). Sonnet should reach for `handoff`, not `handoff_submit`.',
  });
}

export const handoffSubmitSpec = {
  name: 'handoff_submit' as const,
  inputSchema: HandoffSubmitInputSchema,
  outputSchema: HandoffSubmitOutputSchema,
};
