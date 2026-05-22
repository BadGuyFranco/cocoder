# Startup Packet Fragment

- Treat the startup packet as the bounded launch context.
- Use the selected priority excerpt, recent session tail, route, profile, resolved priority write boundary, and safety flags from the packet.
- Treat `warnings` as advisory launch context, not launch blockers. If a warning reports priority handoff drift, the lead must reconcile or explicitly acknowledge it before dispatching implementation; teammate lanes wait for the lead's concrete dispatch.
- Do not full-read large priority or session files during launch unless the route explicitly authorizes it.
- If the selected priority is stale, missing, archived, superseded, or closed, do not proceed as ready.
