# ADHD Design Rules

## Design Principles

1. **Status-first**: System state is always visible. Health dots in the app bar, status badges on jobs, colored borders on hosts - the user never has to dig to understand what's happening.
2. **Workflow-driven**: The UI mirrors the job lifecycle: create → start → monitor approvals → review results. Layout and action hierarchy follow this flow.
3. **Desktop-native**: Fixed app shell with independent scroll regions, keyboard shortcuts, compact information density. No page-level scrolling.
4. **Warm professionalism**: Earthy warm palette (burnt sienna accent, parchment surfaces) balances approachability with the seriousness of an orchestration control plane.

## Color System

### Surfaces
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#f4ede1` | Page background |
| `--surface-0` | `#ece5d8` | App bar, chrome |
| `--surface-1` | `rgba(255,252,246,0.94)` | Cards, sidebar |
| `--surface-2` | `rgba(255,248,234,0.98)` | Elevated elements |
| `--surface-inset` | `#f9f6f1` | Input backgrounds |
| `--surface-hover` | `rgba(33,27,21,0.04)` | Hover states |

### Text
| Token | Usage |
|-------|-------|
| `--ink` | Primary text |
| `--ink-secondary` | Descriptions, metadata |
| `--ink-tertiary` | Labels, placeholders, disabled |

### Accent
| Token | Value | Usage |
|-------|-------|-------|
| `--accent` | `#b85a24` | Primary buttons, active tabs, selection borders |
| `--accent-hover` | `#a34e1d` | Button hover |
| `--accent-soft` | `rgba(184,90,36,0.12)` | Selected backgrounds |

### Status Colors
| Token | Value | Semantic |
|-------|-------|----------|
| `--ready` | `#0f6a4d` | Completed, connected, success |
| `--live` | `#2563eb` | Running, planning, delegating |
| `--blocked` | `#dc2626` | Failed, cancelled, error |
| `--warning` | `#d97706` | Amber warnings |

Each status color has a `-soft` variant (10% opacity) for badge/dot backgrounds.

## Typography

- **Sans**: IBM Plex Sans (400, 500, 600, 700) — all UI text
- **Serif**: IBM Plex Serif — headings (app title, card titles, section titles)
- **Mono**: IBM Plex Mono (400, 500) — code blocks, JSON output

### Scale
| Token | Size | Usage |
|-------|------|-------|
| `--text-xs` | 0.6875rem (11px) | Badges, eyebrows, labels |
| `--text-sm` | 0.8125rem (13px) | Body text, buttons, inputs |
| `--text-base` | 0.9375rem (15px) | Section titles, default |
| `--text-lg` | 1.125rem (18px) | App bar title |
| `--text-xl` | 1.375rem (22px) | Detail card title |

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

- **Start**: Accent colored (primary)
- **Interrupt**: Red/danger colored
- **Retry, Refresh**: Ghost (transparent with border)

### Health Drawer
- Two 8px colored dots in app bar summarize health
- Click dots to toggle full health card drawer
- Hidden by default when healthy

### Intake Form
- Collapsible via "New Job" / "Hide" toggle
- Collapses after successful job creation
- `Cmd+K` focuses the intake textarea

### Tab Bar
- "Approvals (n)" and "Results" tabs in detail card
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
- Types: info (dark), error (red), success (green)
- Slide-up entrance animation

## Accessibility

- All interactive elements are focusable via keyboard
- Status indicators use color + text labels (never color alone)
- Health dots have hover/click affordance for full details
- `color-scheme: light` meta tag for system UI coordination
- Font smoothing enabled for crisp text rendering

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
