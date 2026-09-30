# scroll-motion Delta Specification

## MODIFIED Requirements

### Requirement: Popped content never overlaps the next node

Node spacing and exit travel SHALL be sized so that a node's popped content has fully exited the viewport before the next node's content begins to pop across the supported mobile band (~360px–767px). Viewports $\ge 768\text{px} \times \ge 600\text{px}$ are intercepted by `DesktopGate`.

#### Scenario: No simultaneous content at any scroll position

- **WHEN** the user scrubs through the timeline at any speed, in either direction on a mobile viewport
- **THEN** at no scroll position are two nodes' content blocks (photo/date/description) visible simultaneously

### Requirement: Timeline connectors render as fluid curves

Connector lines between consecutive story dots (line-1 through line-4) SHALL render as fluid curves rather than hard 90° corners, using the single shipped curve builder — one cubic Bézier S-curve per connector (M a C midX a.y, midX b.y, b.x b.y), giving horizontal tangents at both dots with no intermediate vertices — computed from the measured dot centers. The connector from dot-4 (November 2025) to dot-5 (11 April 2026) SHALL use the same S-curve construction (via the shared `setSmoothIntoNode5` builder, including its <360px narrow-screen guard that ends the curve short of node 5's centered card before approaching the dot horizontally). The final connector into the finale (line-5, dot-5 to the dot-6 anchor) SHALL remain orthogonal (V–H–V), with its layout sized for the supported mobile reference band (~360px–767px). Viewports $\ge 768\text{px} \times \ge 600\text{px}$ are intercepted by `DesktopGate`.

#### Scenario: Default fluid curves

- **WHEN** the timeline renders
- **THEN** lines 1–4 contain no sharp corners and leave/arrive horizontally at each connected dot

#### Scenario: November-to-April is one continuous curve

- **WHEN** the timeline renders
- **THEN** the November 2025 → 11 April 2026 gap is bridged by a single S-curve connector with no intermediate dots and no intermediate vertices, leaving dot-4 and arriving at dot-5 horizontally

#### Scenario: Finale connector stays angular

- **WHEN** the timeline renders
- **THEN** line-5 (dot-5 to the dot-6 anchor) keeps its orthogonal vertical-horizontal-vertical shape
