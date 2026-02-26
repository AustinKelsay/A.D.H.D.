# ADHD Design Rules

## Purpose
Define a practical visual and interaction language for a control-focused orchestration UI.

## Design Direction
- Terminal-meets-control panel: high-signal status, compact controls, low-friction operations.
- Visual priority: system state and session health over decorative UI.
- Palette should support quick scanning in short coding bursts.

## Color and typography
- Base background: near-neutral dark surface for extended readability.
- Accent colors:
  - `idle`: muted gray
  - `running`: blue
  - `success`: green
  - `error`: amber/red
  - `warning`: amber
- Typography:
  - Use one expressive sans stack for labels and a monospaced stack for logs.
  - Keep contrast high and line heights generous for dense logs.

## Layout and spacing
- Screen sections:
  1. Capture and compose
  2. Active sessions
  3. Recent run catalog
  4. Session detail panel
- Use compact cards with fixed density; logs scroll independently.
- Mobile: vertical stack with sticky session controls and thumb-friendly action buttons.

## Interaction patterns
- Single primary action per state:
  - idle → start
  - running → stop/cancel
  - completed/failed → retry/open logs
- Profile selector is always visible before launch.
- Session rows are clickable/tappable for details.

## Accessibility
- Keyboard access for desktop operators (start/stop, cancel, retry, toggle profile).
- ARIA labels for live regions (`aria-live`) around state changes and log append.
- Contrast-first color use with non-color indicators (icons + text labels).

## Motion and feedback
- Use short transitions only for:
  - state badges appearing/disappearing
  - session row status changes
- Avoid heavy animation; focus on immediate feedback.

## Content and copy
- Error and status copy should include:
  - session id
  - current state
  - next action
- Keep copy short and deterministic.
