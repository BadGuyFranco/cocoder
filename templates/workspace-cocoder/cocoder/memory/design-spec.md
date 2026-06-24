# Design Spec Local Default

The CoCoder dashboard design language is the local-default design spec for new UI, including color, type, spacing tokens, and component patterns.

The authoritative owner is `packages/ui/src/renderer/styles/design-spec.md`. Keep token tables, CSS values, and component pattern details there; this template file is only a pointer so scaffolded workspaces know which default applies.

Resolution: a workspace that specifies its own CSS or design language wins; otherwise this local default applies. This file is seeded create-only into each scaffolded repo's cocoder/memory/ and is never overwritten once a workspace has its own.
