# ADHD Design Rules

## Design Identity

Midnight Terminal — near-black surfaces with electric green accent and a green-to-cyan gradient. Matrix-meets-modern: monochrome neutral surfaces with one electric punch color. Sharp, technical, confident. The UI feels like a high-end terminal emulator that grew into a full control plane.

## Design Principles

1. **Status-first**: System state is always visible. Health dots in the app bar, status badges on jobs, colored borders on hosts — the user never has to dig to understand what's happening.
2. **Workflow-driven**: The UI mirrors the job lifecycle: create → start → monitor approvals → review results. Layout and action hierarchy follow this flow.
3. **Desktop-native**: Fixed app shell with independent scroll regions, keyboard shortcuts, compact information density. No page-level scrolling.
4. **Dark-first, neutral cool**: Near-black surfaces with electric green accent. The palette evokes a midnight terminal session — focused, immersive, and a little electric. No purple tint — pure neutral darks.
5. **Personality without friction**: Copy is casual and direct ("Throw something at the wall", "They're probably vibing somewhere") but never gets in the way of actual workflows. Primary actions stay professional.

## Color System

### Surfaces (Near-Black, Neutral Cool)
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#08080c` | Page background |
| `--surface-0` | `#111116` | App bar, chrome |
| `--surface-1` | `#18181f` | Cards, sidebar |
| `--surface-2` | `#1f1f28` | Elevated elements (approval cards, dropdowns) |
| `--surface-inset` | `#0c0c10` | Input backgrounds (darker than bg for depth) |
| `--surface-hover` | `rgba(255,255,255,0.06)` | Hover states |

### Text (Cool Neutral)
| Token | Value | Usage |
|-------|-------|-------|
| `--ink` | `#e8e8ed` | Primary text (clean near-white) |
| `--ink-secondary` | `#8b8b96` | Descriptions, metadata (neutral gray) |
| `--ink-tertiary` | `#555563` | Labels, placeholders, disabled (muted gray) |

### Accent (Electric Green → Cyan Gradient)
| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#00ff87` | Electric green — primary solid accent |
| `--accent-hover` | `#33ff9f` | Lighter green for hover states |
| `--accent-soft` | `rgba(0,255,135,0.12)` | Selected backgrounds |
| `--accent-end` | `#00d4ff` | Cyan — gradient endpoint |
| `--accent-end-soft` | `rgba(0,212,255,0.12)` | Cyan tinted backgrounds |
| `--gradient` | `linear-gradient(135deg, #00ff87, #00d4ff)` | Buttons, loading bars, active borders |

### Status Colors
| Token | Value | Semantic |
|-------|-------|----------|
| `--ready` | `#00ff87` | Completed, connected, success (electric green) |
| `--live` | `#00d4ff` | Running, planning, delegating (cyan) |
| `--blocked` | `#ff3b5c` | Failed, cancelled, error (red) |
| `--warning` | `#ffcc00` | Amber warnings |

Each status color has a `-soft` variant (~10-12% opacity) for badge/dot backgrounds.

### Shadows (Black, Green-Tinted Focus)
| Token | Value |
|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.5)` |
| `--shadow-md` | `0 4px 12px rgba(0,0,0,0.6)` |
| `--shadow-lg` | `0 12px 32px rgba(0,0,0,0.7)` |
| `--shadow-focus` | `0 0 0 2px rgba(0,255,135,0.3), 0 0 12px rgba(0,255,135,0.1)` |

## Typography

- **Sans**: Space Grotesk (400, 500, 600, 700) — all UI text and headings. Geometric and clean with personality.
- **Mono**: JetBrains Mono (400, 500) — code blocks, JSON output, technical data, **status badges**. Badges use mono to reinforce the terminal aesthetic.
- **No serif font.** Headings use Space Grotesk at heavier weights (600-700) instead.

### Scale
| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 0.6875rem (11px) | Badges, eyebrows, labels |
| `--text-sm` | 0.8125rem (13px) | Body text, buttons, inputs |
| `--text-base` | 0.9375rem (15px) | Section titles, default |
| `--text-lg` | 1.125rem (18px) | App bar title |
| `--text-xl` | 1.375rem (22px) | Detail card title |

## Gradient Usage Rules

Use the gradient (`--gradient`) for:
- **Primary buttons** — `background: var(--gradient)` with **dark text** (`#08080c`) for contrast
- **Loading bar** — shimmer sweep using gradient with wider `background-size`
- **Tab bar active state** — gradient underline via `border-image: var(--gradient) 1`
- **Success toasts** — green-to-cyan gradient tint

Use solid `--accent` (electric green) for:
- Focus rings and border highlights
- Selected item left-border color
- Toggle/link text color
- Anywhere a single color value is needed (can't use gradients)

## Glow Effects

- **Health dots**: `.health-dot.ok` gets `box-shadow: 0 0 6px var(--ready)` (green glow). `.health-dot.err` gets `box-shadow: 0 0 6px var(--blocked)` (red glow).
- **Selected items**: `.job-row.selected` and `.host-chip.selected` get `box-shadow: inset 3px 0 8px -4px var(--accent)` for a green glow on the left edge.
- **Approval cards**: `border-left: 3px solid rgba(0,255,135,0.35)` — subtle green left accent for pending approvals.
- **Focus ring**: `--shadow-focus` includes a green glow halo — applied on `:focus` for inputs and `:focus-visible` for buttons.
- **Pre blocks**: `#0a0a10` background with neutral text `#b8b8c4`, bordered with `--line` for definition.

## Spacing

4px base grid: `--space-1` (4px) through `--space-12` (48px). Use spacing tokens for all padding, margins, and gaps.

## Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | 6px | Badges, small chips |
| `--radius-md` | 8px | Buttons, inputs, job rows |
| `--radius-lg` | 12px | Cards, detail panels |
| `--radius-xl` | 16px | Large containers (reserved) |
| `--radius-full` | 999px | Dots, circular elements |

## Layout

### Desktop (> 1100px)
```
┌─────────────────────────────────────────────────┐
│ App Bar (52px): brand | health dots | status    │
├──────────────┬──────────────────────────────────┤
│   Sidebar    │           Content                │
│ (280-380px)  │        (flex: 1)                 │
│              │                                  │
│ - New Job    │   Detail Card                    │
│ - Hosts      │   - Header + badge               │
│ - Jobs       │   - Facts grid                   │
│   (scroll)   │   - Action buttons               │
│              │   - Tab bar                       │
│              │   - Approvals / Results           │
│              │           (scroll)               │
└──────────────┴──────────────────────────────────┘
```

### Tablet (720-1100px)
- Sidebar narrows to 260px
- Fact list collapses to single column

### Mobile (< 720px)
- Sidebar and content stack vertically
- Bottom navigation bar (56px) with: Jobs | Hosts | New | Detail
- Detail view has back button
- 44px minimum touch targets
- `env(safe-area-inset-bottom)` padding for notch devices

## Interaction Patterns

### Job Lifecycle Actions
| State | Primary Action | Secondary | Destructive |
|-------|---------------|-----------|-------------|
| queued | Start | Retry + Start | — |
| running | — | Refresh | Interrupt |
| completed | — | Refresh | — |
| failed | Retry + Start | Retry | — |

- **Start**: Gradient background (primary) with dark text
- **Interrupt**: Red/danger colored
- **Retry, Refresh**: Ghost (transparent with border)

### Health Drawer
- Two 8px colored dots in app bar summarize health (with glow)
- Click dots to toggle full health card drawer
- Hidden by default when healthy

### Intake Form
- Collapsible via "New Job" / "Hide" toggle
- Collapses after successful job creation
- `Cmd+K` focuses the intake textarea

### Tab Bar
- "Approvals (n)" and "Results" tabs in detail card
- Active tab has gradient underline (green-to-cyan)
- Both sections always present in DOM (for accessibility/test compat)
- Inactive tab hidden via CSS `display: none`

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Focus intake textarea |
| `Cmd/Ctrl + R` | Refresh all data |
| `j` | Select next job |
| `k` | Select previous job |
| `Escape` | Deselect job |

Shortcuts `j`/`k` are disabled when an input/textarea/select is focused.

## Toast Notifications

- Appear bottom-right (above bottom nav on mobile)
- Auto-dismiss after 4 seconds
- Types: info (surface-level bg, neutral text), error (red bg, white text), success (green-to-cyan gradient, dark text)
- Slide-up entrance animation

## Accessibility

- All interactive elements are focusable via keyboard
- Buttons use `:focus-visible` with green glow ring for keyboard navigation
- Custom checkboxes with green fill when checked, dark checkmark for contrast
- Status indicators use color + text labels (never color alone)
- Health dots have hover/click affordance for full details
- `color-scheme: dark` meta tag for system UI coordination
- Font smoothing enabled for crisp text rendering
- Text selection uses green-tinted highlight (`rgba(0,255,135,0.25)`)
- Custom scrollbars (6px, near-invisible track, subtle thumb) match the dark theme

## Motion Guidelines

| Property | Duration | Easing |
|----------|----------|--------|
| Hover states | 120ms (fast) | ease-out |
| Drawer open/close | 320ms (slow) | ease-out |
| Tab switches | immediate | — |
| Toast enter | 200ms (normal) | ease-out |
| Toast exit | 120ms (fast) | ease-in |
| Loading bar | 1.5s | ease (infinite) |
| Spinner | 0.6s | linear (infinite) |

Avoid decorative animation. Motion serves to communicate state changes and provide spatial continuity.
