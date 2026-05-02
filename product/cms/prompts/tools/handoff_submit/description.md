Internal — the model does not invoke this. The lead-capture widget calls `handoff_submit` directly when the visitor enters contact details and grants tier-2 consent. The MCP surface is registered for symmetry (every advertised tool has a registration the assistant-ui's tool-result registry can validate against) and as future-proofing for an MCP-fronted submission path; today the widget POSTs to `/handoff/submit` over HTTP per decision E.13.

The handler is a thin wrapper over `submitHandoff()` from `@swoop/connector` — it persists the durable record and (if enabled) sends the verdict-aware email. Tier-1 (conversation) and tier-2 (handoff) consent are both checked at the boundary; missing either rejects the call without persisting.

*When to pick this:* never. If the agent ever finds itself reaching for `handoff_submit`, that's a misbehaviour — the widget owns submission. Reach for `handoff` instead, and let the visitor complete the form.
