# CoCoder Dashboard Local-Default Design Spec

## Resolution Rule

Any new or onboarded workspace that defines no CSS or design language of its own inherits this local-default design spec. A workspace-specified design wins. This document is the single owner for the local-default design catalog; the `--cb-*` custom properties in `fusion.css` and their consumers in `oz.css` remain the runtime source of truth, so this document catalogs those values instead of forking them.

## Color & Surface Tokens

`fusion.css` defines the default dark theme on `:root` and light overrides on `[data-theme='light']`. Tokens not listed with a light override keep the default value.

| Token | Default dark value | Light override | Role |
|---|---:|---:|---|
| `--cb-bg` | `#2A251F` | `#F0E9DF` | App canvas background. |
| `--cb-bg-soft` | `#25211C` | `#EAE3D8` | Recessed controls, chips, and priority-panel fill. |
| `--cb-surface` | `rgba(20, 17, 14, 0.96)` | `#FAF6EE` | General surface color. |
| `--cb-surface-solid` | `#16120F` | `#EDE8DF` | Opaque surface base. |
| `--cb-surface-raised` | `#1B1713` | `#FAF6EE` | Raised popovers and tooltips. |
| `--cb-surface-glass` | `rgba(20, 17, 14, 0.96)` | `rgba(255, 252, 248, 0.94)` | Blurred shell and panel surfaces. |
| `--cb-text` | `#E5DCD0` | `#1E1B17` | Primary readable text. |
| `--cb-text-secondary` | `#8E8477` | `#6B6358` | Secondary labels and inactive navigation. |
| `--cb-text-muted` | `#6B6358` | `#9E9689` | Metadata, helper text, and disabled-adjacent labels. |
| `--cb-text-on-accent` | `#14110E` | `#FFFFFF` | Text placed on accent fills. |
| `--cb-accent` | `#C9A96E` | `#8B7545` | Primary gold accent for active states and CTAs. |
| `--cb-accent-hover` | `#D6B97D` | `#75623A` | Primary CTA hover fill. |
| `--cb-accent-muted` | `rgba(201, 169, 110, 0.12)` | `rgba(139, 117, 69, 0.12)` | Soft accent backgrounds. |
| `--cb-accent-subtle` | `rgba(201, 169, 110, 0.06)` | `rgba(139, 117, 69, 0.06)` | Very quiet accent backgrounds. |
| `--cb-accent-30` | `rgba(201, 169, 110, 0.30)` | `rgba(139, 117, 69, 0.30)` | Strong translucent accent borders, focus cues, and handles. |
| `--cb-accent-25` | `rgba(201, 169, 110, 0.25)` | `rgba(139, 117, 69, 0.25)` | Selection background strength. |
| `--cb-accent-15` | `rgba(201, 169, 110, 0.15)` | `rgba(139, 117, 69, 0.15)` | Quiet accent borders and active badges. |
| `--cb-highlight` | `#D4766E` | `#C0584F` | Highlight and destructive-state text. |
| `--cb-highlight-muted` | `rgba(212, 118, 110, 0.15)` | `rgba(192, 88, 79, 0.12)` | Destructive button background. |
| `--cb-error` | `#D4766E` | `#C0584F` | Error color alias. |
| `--cb-success` | `#7DAF6E` | `#4A8040` | Success-state text. |
| `--cb-success-muted` | `rgba(125, 175, 110, 0.12)` | `rgba(74, 128, 64, 0.10)` | Success chip background. |
| `--cb-border` | `rgba(200, 170, 120, 0.08)` | `rgba(100, 85, 55, 0.10)` | Default hairline borders and dividers. |
| `--cb-border-strong` | `rgba(200, 170, 120, 0.16)` | `rgba(100, 85, 55, 0.22)` | Stronger borders for hover or raised elements. |
| `--cb-gold-line` | `rgba(201, 169, 110, 0.15)` | `rgba(139, 117, 69, 0.20)` | Decorative gold divider line. |
| `--cb-hover` | `rgba(200, 170, 120, 0.06)` | `rgba(100, 85, 55, 0.06)` | Neutral hover fill. |
| `--cb-active` | `rgba(200, 170, 120, 0.10)` | `rgba(140, 115, 65, 0.10)` | Neutral active or selected fill. |
| `--cb-glass-blur` | `22px` | Same as default | Backdrop-filter blur radius for glass surfaces. |
| `--cb-glass-highlight` | `rgba(255, 245, 230, 0.04)` | `rgba(255, 255, 255, 0.60)` | Inset highlight on glass panels. |
| `--cb-ambient-1` | `rgba(201, 169, 110, 0.025)` | `rgba(139, 117, 69, 0.020)` | First ambient radial background wash. |
| `--cb-ambient-2` | `rgba(201, 169, 110, 0.018)` | `rgba(139, 117, 69, 0.014)` | Second ambient radial background wash. |

## Typography

| Token | Value | Role |
|---|---:|---|
| `--cb-font-display` | `'Josefin Sans', sans-serif` | Uppercase display headings, labels, brand marks, and section markers. |
| `--cb-font-body` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Body text, buttons, fields, and general UI copy. |
| `--cb-font-mono` | `'JetBrains Mono', 'Fira Code', ui-monospace, monospace` | Metadata, badges, code, counters, shortcuts, and numeric UI. |

The semantic type rules in `fusion.css` set display headings as uppercase with positive letter spacing: `h1/.cb-h1` at `24px`, weight `600`, `1.5px` letter spacing, line-height `1.2`; `h2/.cb-h2` at `20px`, weight `600`, `1.2px`, line-height `1.25`; `h3/.cb-h3` at `18px`, weight `500`, `1px`, line-height `1.3`; and `h4/.cb-h4` at `13px`, weight `500`, `0.8px`, line-height `1.4`. Body text uses `14px`, weight `400`, line-height `1.7`, and `-0.011em` letter spacing; small text uses `12px`; mono text enables tabular numerals through `font-feature-settings: 'tnum'` and `font-variant-numeric: tabular-nums`.

`oz.css` repeats the same convention at component scale: brand and section labels use display uppercase with `0.5px` to `2.5px` letter spacing, metadata uses the mono stack, and dense controls usually sit in the `10px` to `13px` range.

## Spacing & Radius Scale

| Spacing token | Value | Role |
|---|---:|---|
| `--cb-space-xs` | `4px` | Small gaps and tight offsets. |
| `--cb-space-sm` | `8px` | Compact control spacing. |
| `--cb-space-md` | `12px` | Default inner spacing. |
| `--cb-space-lg` | `16px` | Panel and toolbar spacing. |
| `--cb-space-xl` | `24px` | Larger layout padding. |
| `--cb-space-2xl` | `32px` | Broad section spacing. |

| Radius token | Value | Role |
|---|---:|---|
| `--cb-radius-xs` | `2px` | Tiny marks and active rails. |
| `--cb-radius-sm` | `3px` | Chips, shortcuts, and compact controls. |
| `--cb-radius-md` | `4px` | Default buttons, inputs, tabs, and nav items. |
| `--cb-radius-lg` | `6px` | Larger icons and empty-state blocks. |
| `--cb-radius-xl` | `8px` | Panels. |
| `--cb-radius-pill` | `9999px` | Fully rounded pills. |

## Motion

| Token | Value | Role |
|---|---:|---|
| `--cb-duration-fast` | `150ms` | Hover, focus, tooltip, and control transitions. |
| `--cb-duration-normal` | `250ms` | Standard transition duration. |
| `--cb-duration-slow` | `400ms` | Slower transitions when needed. |
| `--cb-ease-default` | `ease-out` | Default easing for interactive UI. |
| `--cb-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Spring-like easing for expressive motion. |

`oz.css` primarily applies the fast/default pair to hover, focus, tab, icon-button, resize-handle, and form-control transitions. The named keyframes (`ozPulse`, `ozSlideIn`, `ozFadeIn`) are component animations, not `--cb-*` tokens.

## Core Component Patterns

- Glass shell and panels: `.oz-sidebar`, `.oz-topbar`, `.oz-panel`, and active workspace tabs use `--cb-surface-glass`, `blur(var(--cb-glass-blur))`, `--cb-border`, and `--cb-glass-highlight`.
- Ambient depth: `.oz-app` layers two radial gradients from `--cb-ambient-1` and `--cb-ambient-2` over `--cb-bg`.
- Gold-line accents: `.oz-sidebar::after`, active nav rails, active workspace tabs, resize handles, brand dividers, selection color, and `.oz-frame` corners all use the accent ramp rather than separate decorative colors.
- Compact radii: controls and nav surfaces cluster around `--cb-radius-md`; panels use `--cb-radius-xl`; pills and badges use small fixed radii or the pill token where a fully rounded shape is needed.
- Hover and active treatment: neutral affordances use `--cb-hover` or `--cb-active`; accent affordances use `--cb-accent-muted`, `--cb-accent-15`, or `--cb-accent-30`; destructive affordances use the highlight tokens.
- Status chips: `.oz-chip-*` uses uppercase compact body text with muted fills, tokenized success/accent states, and highlight-colored blocked/failed/pending states.
- Forms and buttons: `.oz-input`, `.oz-textarea`, `.oz-select`, and `.oz-btn-*` use body typography, `--cb-bg-soft` or accent fills, `--cb-border`, `--cb-radius-md`, and tokenized focus or hover transitions.
