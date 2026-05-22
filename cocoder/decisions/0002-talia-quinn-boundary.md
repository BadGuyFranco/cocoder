---
id: ADR-0002
title: "Talia and Quinn — test layer vs experience layer"
status: accepted
date: 2026-05-21
---

# ADR-0002: Talia and Quinn — test layer vs experience layer

## Context

CoBuilder combines broad QA orchestration (Talia) with CDP IDE scripts (Quinn). CoCoder targets generic software repos and needs a crisp, teachable split.

## Decision

| Persona | Layer | Question they answer | Typical outputs |
|---------|-------|----------------------|-----------------|
| **Talia** | Test | "Does the code behave correctly under automation?" | Unit/integration tests, test plans, CI commands, failure diagnosis on assertions |
| **Quinn** | Experience | "Does the product behave correctly when a human uses it?" | Browser/CDP scripts, screenshots, interaction traces, smoke flows |

**Line rule:** If the verification is defined by **code contracts** (inputs, outputs, APIs, DB state), Talia owns it. If verification requires **UI/state a user would see** (clicks, renders, navigation, accessibility), Quinn owns it.

**Overlap protocol:** Quinn finds a UX bug that needs regression coverage → Talia adds an automated test. Talia finds a passing test but founder reports UX wrong → Quinn reproduces in the running app. Neither overrides the other's lane without Oscar dispatch.

**Not in scope for either:** Architecture (Bob), priority process (Oscar), CRM/copy (Ian), cross-workspace control (Oz).

## Consequences

- Talia playbooks emphasize test runners, fixtures, mocks, coverage of business logic.
- Quinn remains primarily **scripts invoked by dispatch**, not a long-lived chat persona (same as CoBuilder).
- CoBuilder migration may remap legacy Talia "QA orchestration" work to Oscar-coordinated checklists until playbooks are rewritten.
