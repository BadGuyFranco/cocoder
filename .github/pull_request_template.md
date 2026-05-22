<!--
Thanks for your contribution! Please fill in this template so the review can stay focused.
For larger changes, please open a Discussion or Feature Request issue first so we can
align on direction before you invest in the code.
-->

## Summary

<!-- One paragraph: what changes, why, and what user-visible impact it has. -->

## Related work

<!-- Link to the issue, discussion, ADR, Playbook task, or audit finding this PR addresses.
Example: "Closes #42." or "Sub-Playbook A audit §H7." -->

## Test plan

<!-- Bulleted list of how you verified the change. CI runs `pnpm -r test` + the
stale-reference gate automatically; list any additional manual checks. -->

- [ ] `pnpm -F schemas build` clean
- [ ] `pnpm -r test` green
- [ ] `node packages/core/cli.mjs validate-contracts` clean
- [ ] Stale-reference CI gate (`rg 'cobuilder|COB_ORCH_'` / `rg '/Volumes/'`) returns 0 hits in shipped packages
- [ ] *(if applicable)* New behavior covered by a runtime test, not a source-grep

## Documentation

<!-- Check all that apply. -->

- [ ] No doc change required
- [ ] Updated `docs/`
- [ ] Updated or added an ADR in `cocoder/decisions/`
- [ ] Updated the active Playbook's Progress / Decision Log
- [ ] Added a SESSION_LOG entry (only if this PR represents a session-level outcome)

## Boundary check

- [ ] No mutation outside the priority's declared write boundary
- [ ] No CoBuilder-private path references introduced (`cobuilder-build/`, `COB_ORCH_*`)
- [ ] No machine-specific absolute paths (`/Volumes/...`, `/Users/...`) outside `*.example.*` files
- [ ] No secrets, API keys, or credentials in tracked files

## Notes for reviewers

<!-- Anything tricky, surprising, or worth a second look. -->
