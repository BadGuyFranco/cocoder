# CoBuilder Fusion Design Spec Local Default

Snapshot date: 2026-06-24.

Upstream source of truth: `CoBuilder/infrastructure/design-system`, specifically
`design/tokens-website.css`, `design/tokens-ide.css`, `README.md`, `AGENTS.md`,
`ARCHITECTURE.md`, and the live website consumer at `cobuilder-website/app/globals.css`.
Re-sync is mechanical against that upstream SSOT; the founder accepted the drift trade-off versus a
live cross-repo reference.

## Resolution Rule

A workspace that defines its own CSS or design language wins. Otherwise this local default applies.
This file is the single owner for the seeded local-default design catalog; workspace copies are seeded
create-only and are never overwritten once a workspace has its own.

## Design Language

Fusion is CoBuilder's final cross-product visual language for the IDE and website: Art Deco x Liquid
Glass, Warm Espresso dark mode, Warm Linen light mode, champagne/deep-gold accents, low radii, thin
gold structure lines, and soft glass depth. It is a token system, not a component library.

## Web `--cb-*` Tokens

The web surface uses hex and rgba `--cb-*` tokens for direct CSS consumption. The snapshot below uses
the live website values from `cobuilder-website/app/globals.css` when that file diverges from
`design/tokens-website.css`.

| Token | Light value | Dark value | Role |
|---|---:|---:|---|
| `--cb-font-display` | `'Josefin Sans', sans-serif` | `'Josefin Sans', sans-serif` | Display headings, wordmarks, short labels. |
| `--cb-font-body` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Body text and general UI. |
| `--cb-font-mono` | `'JetBrains Mono', 'Fira Code', ui-monospace, monospace` | `'JetBrains Mono', 'Fira Code', ui-monospace, monospace` | Code, metadata, counters, IDs. |
| `--cb-bg` | `#F3EEE6` | `#14110E` | Page/app canvas. |
| `--cb-bg-soft` | `#EDE8DF` | `#1A1714` | Recessed surface fill. |
| `--cb-surface` | `#EDE8DF` | `rgba(30, 26, 22, 0.55)` | Standard surface. |
| `--cb-surface-solid` | `#EDE8DF` | `#1E1A16` | Opaque fallback surface. |
| `--cb-surface-raised` | `#FAF6EE` | `#221E19` | Raised surface. |
| `--cb-surface-glass` | `rgba(255, 252, 248, 0.65)` | `rgba(30, 26, 22, 0.55)` | Frosted glass panels. |
| `--cb-text` | `#1E1B17` | `#E5DCD0` | Primary text. |
| `--cb-text-secondary` | `#6B6358` | `#8E8477` | Secondary text. |
| `--cb-text-muted` | `#6F685F` | `#6B6358` | Muted labels and helper text. |
| `--cb-text-on-accent` | `#FFFFFF` | `#14110E` | Text on accent fills. |
| `--cb-accent` | `#7A663B` | `#C9A96E` | Primary gold accent. |
| `--cb-accent-hover` | `#75623A` | `#D6B97D` | Accent hover fill. |
| `--cb-accent-muted` | `rgba(122, 102, 59, 0.12)` | `rgba(201, 169, 110, 0.12)` | Soft accent backgrounds. |
| `--cb-accent-subtle` | `rgba(122, 102, 59, 0.06)` | `rgba(201, 169, 110, 0.06)` | Quiet accent backgrounds. |
| `--cb-accent-30` | `rgba(122, 102, 59, 0.30)` | `rgba(201, 169, 110, 0.30)` | Strong accent borders and focus cues. |
| `--cb-accent-25` | `rgba(122, 102, 59, 0.25)` | `rgba(201, 169, 110, 0.25)` | Selection fill. |
| `--cb-accent-15` | `rgba(122, 102, 59, 0.15)` | `rgba(201, 169, 110, 0.15)` | Quiet accent borders and badges. |
| `--cb-highlight` | `#C0584F` | `#D4766E` | Highlight/destructive text. |
| `--cb-highlight-muted` | `rgba(192, 88, 79, 0.12)` | `rgba(212, 118, 110, 0.15)` | Muted highlight fill. |
| `--cb-error` | `#C0584F` | `#D4766E` | Error alias. |
| `--cb-success` | `#4A8040` | `#7DAF6E` | Success text. |
| `--cb-success-muted` | `rgba(74, 128, 64, 0.10)` | `rgba(125, 175, 110, 0.12)` | Success chip fill. |
| `--cb-border` | `rgba(100, 85, 55, 0.10)` | `rgba(200, 170, 120, 0.08)` | Default border. |
| `--cb-border-strong` | `rgba(100, 85, 55, 0.22)` | `rgba(200, 170, 120, 0.16)` | Strong border. |
| `--cb-gold-line` | `rgba(122, 102, 59, 0.20)` | `rgba(201, 169, 110, 0.15)` | Structural gold separator. |
| `--cb-hover` | `rgba(100, 85, 55, 0.06)` | `rgba(200, 170, 120, 0.06)` | Neutral hover fill. |
| `--cb-active` | `rgba(122, 102, 59, 0.10)` | `rgba(200, 170, 120, 0.10)` | Neutral active fill. |
| `--cb-glass-blur` | `22px` | `22px` | Backdrop blur radius. |
| `--cb-glass-highlight` | `rgba(255, 255, 255, 0.60)` | `rgba(255, 245, 230, 0.04)` | Inset glass highlight. |
| `--cb-ambient-1` | `rgba(122, 102, 59, 0.06)` | `rgba(201, 169, 110, 0.07)` | First ambient radial wash. |
| `--cb-ambient-2` | `rgba(122, 102, 59, 0.04)` | `rgba(201, 169, 110, 0.05)` | Second ambient radial wash. |
| `--cb-radius-xs` | `2px` | `2px` | Tiny marks and tags. |
| `--cb-radius-sm` | `3px` | `3px` | Badges and compact controls. |
| `--cb-radius-md` | `4px` | `4px` | Buttons and inputs. |
| `--cb-radius-lg` | `6px` | `6px` | Cards. |
| `--cb-radius-xl` | `8px` | `8px` | Panels. |
| `--cb-radius-pill` | `9999px` | `9999px` | Pills. |
| `--cb-space-xs` | `4px` | `4px` | Tight spacing. |
| `--cb-space-sm` | `8px` | `8px` | Compact spacing. |
| `--cb-space-md` | `12px` | `12px` | Default local gap. |
| `--cb-space-lg` | `16px` | `16px` | Panel/control spacing. |
| `--cb-space-xl` | `24px` | `24px` | Section spacing. |
| `--cb-space-2xl` | `32px` | `32px` | Broad section spacing. |
| `--cb-space-3xl` | `48px` | `48px` | Large page rhythm. |
| `--cb-space-4xl` | `64px` | `64px` | Maximum section rhythm. |
| `--cb-duration-fast` | `150ms` | `150ms` | Hover/focus/control motion. |
| `--cb-duration-normal` | `250ms` | `250ms` | Standard transitions. |
| `--cb-duration-slow` | `400ms` | `400ms` | Slow expressive transitions. |
| `--cb-ease-default` | `ease-out` | `ease-out` | Default easing. |
| `--cb-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Expressive easing. |

### Web Drift Notes

Live `cobuilder-website/app/globals.css` wins over `design/tokens-website.css` for this snapshot.
Recorded divergences:

| Token | Theme | Token SSOT value | Snapshotted live value |
|---|---|---:|---:|
| `--cb-accent` | light | `#8B7545` | `#7A663B` |
| `--cb-accent-muted` | light | `rgba(139, 117, 69, 0.12)` | `rgba(122, 102, 59, 0.12)` |
| `--cb-accent-subtle` | light | `rgba(139, 117, 69, 0.06)` | `rgba(122, 102, 59, 0.06)` |
| `--cb-accent-30` | light | `rgba(139, 117, 69, 0.3)` | `rgba(122, 102, 59, 0.30)` |
| `--cb-accent-25` | light | `rgba(139, 117, 69, 0.25)` | `rgba(122, 102, 59, 0.25)` |
| `--cb-active` | light | `rgba(140, 115, 65, 0.10)` | `rgba(122, 102, 59, 0.10)` |
| `--cb-gold-line` | light | `rgba(139, 117, 69, 0.20)` | `rgba(122, 102, 59, 0.20)` |
| `--cb-ambient-1` | light | `rgba(139, 117, 69, 0.06)` | `rgba(122, 102, 59, 0.06)` |
| `--cb-ambient-2` | light | `rgba(139, 117, 69, 0.04)` | `rgba(122, 102, 59, 0.04)` |
| `--cb-text-muted` | light | `#9E9689` | `#6F685F` |
| `--cb-accent-30` | dark | `rgba(201, 169, 110, 0.3)` | `rgba(201, 169, 110, 0.30)` |
| `--cb-glass-highlight` | light | `rgba(255, 255, 255, 0.6)` | `rgba(255, 255, 255, 0.60)` |

Live website-only `--cb-*` additions are also snapshotted: `--cb-bg-soft`,
`--cb-surface-solid`, `--cb-surface-raised`, `--cb-text-on-accent`, `--cb-accent-hover`,
`--cb-accent-15`, `--cb-border-strong`, `--cb-radius-xs`, `--cb-radius-pill`, and the spacing tokens
above.

## IDE Shadcn HSL Tokens

The IDE surface uses shadcn/Tailwind-compatible HSL components without an `hsl()` wrapper. Consumers
wrap color values as `hsl(var(--token))`; opacity-bearing values include the slash component.

| Token | Light `:root` value | Dark `.dark` value | Role |
|---|---:|---:|---|
| `--background` | `34 28% 93%` | `28 20% 7%` | App background. |
| `--foreground` | `30 12% 10%` | `34 22% 87%` | Primary foreground. |
| `--card` | `34 20% 93%` | `28 14% 9%` | Card background. |
| `--card-foreground` | `30 12% 10%` | `34 22% 87%` | Card text. |
| `--popover` | `34 25% 95%` | `28 14% 8%` | Popover background. |
| `--popover-foreground` | `30 12% 10%` | `34 22% 87%` | Popover text. |
| `--primary` | `40 32% 40%` | `38 40% 55%` | Gold primary. |
| `--primary-foreground` | `0 0% 100%` | `28 20% 7%` | Text on primary. |
| `--secondary` | `34 18% 90%` | `28 10% 12%` | Secondary surface. |
| `--secondary-foreground` | `30 12% 15%` | `34 18% 85%` | Text on secondary. |
| `--muted` | `34 14% 88%` | `28 10% 12%` | Muted surface. |
| `--muted-foreground` | `30 8% 38%` | `30 6% 51%` | Muted text. |
| `--accent` | `34 18% 90%` | `28 10% 14%` | Hover/active background tint. |
| `--accent-foreground` | `40 32% 40%` | `34 18% 90%` | Accent foreground. |
| `--destructive` | `5 52% 53%` | `5 45% 47%` | Destructive/coral. |
| `--destructive-foreground` | `0 0% 100%` | `0 0% 100%` | Text on destructive. |
| `--success` | `110 28% 33%` | `110 24% 55%` | Success. |
| `--highlight` | `5 52% 53%` | `5 45% 47%` | Attention highlight. |
| `--highlight-foreground` | `0 0% 100%` | `0 0% 100%` | Text on highlight. |
| `--border` | `34 16% 84%` | `30 12% 14%` | Borders. |
| `--input` | `34 16% 84%` | `30 12% 14%` | Input border/fill. |
| `--ring` | `40 32% 40%` | `38 40% 55%` | Focus ring. |
| `--radius` | `0.375rem` | `0.375rem` | shadcn radius base. |
| `--surface` | `34 18% 91%` | `28 14% 10%` | Extended surface. |
| `--surface-raised` | `34 25% 95%` | `28 12% 14%` | Extended raised surface. |
| `--gold-line` | `40 32% 40% / 0.20` | `38 40% 55% / 0.15` | Gold separator. |
| `--glass-bg` | `34 50% 99% / 0.65` | `28 14% 10% / 0.55` | Glass surface fill. |
| `--glass-blur` | `22px` | `22px` | Glass blur. |
| `--glass-highlight` | `0 0% 100% / 0.6` | `36 100% 95% / 0.04` | Inset glass highlight. |
| `--glow` | `40 32% 40%` | `38 40% 55%` | Brand glow color. |
| `--ambient-1` | `rgba(139,117,69,0.06)` | `rgba(201,169,110,0.07)` | First ambient radial wash. |
| `--ambient-2` | `rgba(139,117,69,0.04)` | `rgba(201,169,110,0.05)` | Second ambient radial wash. |
| `--duration-fast` | `150ms` | `150ms` | Fast motion. |
| `--duration-normal` | `250ms` | `250ms` | Standard motion. |
| `--duration-slow` | `400ms` | `400ms` | Slow motion. |
| `--ease-default` | `ease-out` | `ease-out` | Default easing. |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Expressive easing. |

## Typography

| Family | Stack | Use |
|---|---|---|
| Display | `'Josefin Sans', sans-serif` | Wordmark, product marks, headers, section IDs, short eyebrows. |
| Body/UI | `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` | Paragraphs, forms, buttons, dense UI. |
| Mono | `'JetBrains Mono', 'Fira Code', ui-monospace, monospace` | Code, metadata, IDs, counters, status numerals. |

Type scale:

| Use | Size | Weight | Letter spacing | Notes |
|---|---:|---:|---:|---|
| Display stamp | `42px` | `700` | `2.5px` | Uppercase, accent colored. |
| H1 | `24px` | `600` | `1.5px` | Uppercase, section header. |
| H2 | `20px` | `600` | `1.2px` | Uppercase subsection. |
| H3 | `18px` | `500` or `600` | `1px` | Canvas title/settings group. |
| Body | `14px` | `400` | `-0.011em` in IDE, `0` on current website | Line-height `1.7`. |
| UI label | `13px` | `500` | `0.2px` to `0.5px` | Buttons, nav, controls. |
| Small text | `12px` | `400` | `0` | Secondary metadata. |
| Micro/mono | `10px` to `11px` | `400` to `500` | `0.3px` to `0.5px` | IDs, counters, chips. |

Display text is architectural: use uppercase plus positive tracking for short headers and section IDs.
Do not use the display stack for long body copy. Mono text should use tabular numerals where numbers
must scan or align.

## Spacing, Radius, Glass, Motion

Spacing uses a 4px grid: `4`, `8`, `12`, `16`, `24`, `32`, `48`, and `64px`. Keep local component
gaps on this ladder unless the component is aligning to a fixed icon or native-control affordance.

Radius ladder:

| Use | Radius |
|---|---:|
| Tags and badges | `2px` to `3px` |
| Buttons and inputs | `3px` to `4px` |
| Cards and small panels | `6px` |
| Large panels | `8px` |
| Avatars, dots, true pills | `50%` or `9999px` |

Glass recipe:

| Part | Value |
|---|---|
| Surface fill | `--cb-surface-glass` or `hsl(var(--glass-bg))` |
| Backdrop blur | `blur(22px)` |
| Highlight | `inset 0 1px 0 0 var(--cb-glass-highlight)` or `hsl(var(--glass-highlight))` |
| Border | soft tokenized gold/brown border, usually `--cb-border` |
| Ambient depth | two radial gradients from ambient tokens on full-bleed backgrounds |

Motion tokens are `150ms`, `250ms`, and `400ms` with `ease-out` or
`cubic-bezier(0.34, 1.56, 0.64, 1)`. Use `150ms` for hover/focus/control transitions, `250ms` for
standard theme or panel transitions, and `400ms` only for deliberate expressive movement.

## Core Component Patterns

- Glass shell and panels: sidebars, top bars, popovers, cards, chat panels, and elevated panels use
  glass fill plus 22px blur, an inset highlight, and a low-contrast tokenized border. Avoid heavy
  drop shadows.
- Gold-line accents: use thin structural separators, active rails, center dots, resize handles, focus
  rings, and corner strokes from the gold/accent ramp. The line is structure, not decoration.
- Ambient backgrounds: full-bleed pages may layer the two ambient radial gradients over the theme
  background. Keep them subtle and never replace real content hierarchy with glow.
- Status chips: compact, uppercase, low-radius chips use muted fills, mono or small UI text, and
  semantic success/highlight/accent tokens. Numbered chips are preferred when an icon would be generic.
- Forms and buttons: body/UI typography, `3px` to `4px` radii, tokenized focus rings, neutral fills
  for secondary controls, and accent fills for primary actions. Hover changes should be short and
  restrained.
- Wordmark and brand marks: the live-text wordmark is lowercase Josefin Sans `300` with a thin gold
  pipe. Use uppercase Josefin Sans for display stamps and section labels, not for body copy.
