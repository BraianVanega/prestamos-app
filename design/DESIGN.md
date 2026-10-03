---
name: Financial Precision Dashboard
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434655'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#006242'
  on-tertiary: '#ffffff'
  tertiary-container: '#007d55'
  on-tertiary-container: '#bdffdb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Geist
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.015em
  headline-sm:
    fontFamily: Geist
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  body-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  data-currency-primary:
    fontFamily: JetBrains Mono
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 22px
    letterSpacing: -0.02em
  data-currency-secondary:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0em
  data-cell:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Geist
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.06em
  badge-label:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 12px
    letterSpacing: 0.02em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-compact: 0.5rem
  margin: 1rem
  margin-panel: 1.25rem
  space-2xs: 0.125rem
  space-xs: 0.25rem
  space-sm: 0.375rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

This design system is engineered for internal financial operations, reconciliation, credit risk assessment, and liquidation workflows. The emotional tone is authoritative, sober, and unyielding in precision. Administrative operators and risk officers require immediate cognitive parsing over decorative flair; trust is earned through high data density, unambiguous hierarchy, and strict information architecture.

The design movement combines **Modern Corporate Minimalism** with the utilitarian discipline of high-frequency trading terminals:
- Surface layers prioritize flat, crisp boundary delineation over heavy volumetric shadows.
- Layouts are dense and compact, maximizing screen real estate for multi-column ledger reviews, risk matrices, and live payout splits.
- Contrast is deliberately calibrated to mitigate optical fatigue during sustained 8-hour administrative shifts under varying lighting environments.

## Colors

The palette establishes rigid semantic boundaries where color conveys strictly functional, actionable status. 

### Core Palette
- **Primary Accent (`#2563EB` / `#3B82F6`):** Dedicated to primary interactive targets, active navigation states, focused table rows, and positive system confirmations.
- **Secondary Slate (`#0F172A` in light, `#F8FAFC` in dark):** High-prominence foregrounds, primary labels, and structural anchors.
- **Structural Neutral (`#64748B`):** Supporting metadata, secondary currency counters, inactive breadcrumbs, and muted table headers.

### Boundary Tokens
- **Light Mode Grid Line & Border:** `#E2E8F0`
- **Dark Mode Grid Line & Border:** `#27272A`
- **Canvas Backgrounds:** `#F8FAFC` (Light) / `#09090B` (Dark)
- **Card & Surface Backgrounds:** `#FFFFFF` (Light) / `#121215` (Dark)
- **Sub-surface / Row Alt Backgrounds:** `#F1F5F9` (Light) / `#18181B` (Dark)

### Semantic Risk & Audit Tokens
Color application for financial indicators is non-negotiable:
- **Emerald Green (`#10B981`):** Exclusively signifies on-time settlement (*Al día*), positive yields, and fully reconciled batches.
- **Amber Warning (`#F59E0B`):** Moderate delinquency (1–30 days overdue) or soft audit alerts (*Bajo observación*).
- **Orange Alert (`#F97316`):** Severe delinquency (31–60 days overdue) and imminent liquidity breaches.
- **Crimson Red (`#EF4444`):** Defaulted tranches, hard reconciliation mismatch, or loss events (>60 days overdue).
- **Charcoal Black / Pure Slate (`#09090B` light badge / `#27272A` dark badge with `#F43F5E` pulse):** Extreme delinquency (*Riesgo Negro* / Irrecoverable / Legal stage).

## Typography

Typography relies on a dual-engine implementation: **Geist** handles standard operational reading, hierarchical page titles, navigation labels, and interactive form copy; **JetBrains Mono** governs all quantitative, currency, chronological, and identifier output.

### Numerical Integrity & Alignment
- Every currency amount (`USDT`, `ARS`), interest rate (`TNA`, `TEA`), transaction hash, loan ID, and installment sequence must render via the tabular monospaced engine with explicit `font-feature-settings: "tnum" 1, "zero" 1`.
- Primary stat card aggregates use `data-currency-primary` for the base USDT value, while the auxiliary ARS conversion renders directly beneath using `data-currency-secondary` in muted neutral weight.
- Table numerical values are strictly right-aligned with flush decimals across adjacent rows.

## Layout & Spacing

The system implements a compact, desktop-first workspace optimized for `1280px` through `1920px` display viewports, utilizing a fixed-fluid hybrid structure:
- **Left Navigation Sidebar:** Fixed width of `240px` (expandable) or `64px` (collapsed icon-rail mode).
- **Workspace Top Bar:** Fixed height of `48px`, sticky, containing breadcrumbs, active liquidity pool switcher, environment mode, and batch trigger CTA.
- **Main Ledger Canvas:** Fluid grid with standard `gutter` (`0.75rem`), dynamically scaling up to 16 columns for split views.

### Split Panel & Two-Phase Layout
When executing settlement batches or editing repayment terms:
- Left main pane retains 60% width (installment tables and audit log).
- Right collateral pane occupies 40% width with a sticky, real-time recalculation panel showing balance deltas, withholding taxes, and payment confirmation inputs.

### Responsive Behavior
- **Desktop (>=1280px):** Full dual-pane preview, expanded tables with comprehensive inline audit metadata.
- **Laptop / Tablet Landscape (1024px - 1279px):** Collateral calculation panels shift into sliding drawers; lower-priority financial columns collapse under expandable row toggles.
- **Mobile / Emergency View (<1024px):** Operational access restricted to audit view, critical KPI inspection, and approval actions; desktop grid converts into single-column cards with horizontally scrollable tables.

## Elevation & Depth

Visual hierarchy does not rely on soft skeuomorphism or ambient diffusion. Instead, separation is achieved via **low-contrast outlines, high-contrast surface layering, and micro-elevation**:

- **Tier 0 (Canvas):** Ground layer (`#F8FAFC` light / `#09090B` dark).
- **Tier 1 (Surface Containers & Tables):** Elevated flat panels bounded by crisp 1px borders (`#E2E8F0` light / `#27272A` dark). Absolutely zero box shadow under resting states.
- **Tier 2 (Sticky Headers & Toolbars):** Grounded with a 1px border-bottom and a subtle translucent backdrop blur (`backdrop-filter: blur(8px); background-color: rgba(..., 0.85)`).
- **Tier 3 (Dropdown Menus & Live Filter Popovers):** Defined by a 1px structural border plus a tight, technical drop shadow: `0 4px 12px -2px rgba(15, 23, 42, 0.08)`.
- **Tier 4 (Critical Modal Dialogs / Liquidation Overlays):** Semi-opaque backdrop (`#0F172A` at 60% opacity) coupled with high-contrast panel edge definition (`0 20px 25px -5px rgba(0, 0, 0, 0.2)`).

## Shapes

The design system employs a **Soft Architectural (`1`)** shape geometry. Financial data requires structural compactness; exaggerated radii waste screen real estate and soften the authoritative posture required for auditing tools.

- Standard inputs, buttons, and data cards leverage an edge radius of `4px` (`0.25rem`).
- Large floating drawers and reconciliation modals max out at `8px` (`0.5rem`).
- **Pill Shape Exception:** Risk status badges, tag counters, and audit state chips explicitly use fully rounded caps (`9999px`) to immediately isolate discrete categorization metadata from actionable rectangular interactive controls.

## Components

### 1. Data Tables
- **Row Height:** Dense mode at `32px`, standard operational mode at `40px`.
- **Headers:** `10px` uppercase bold tracking, border-bottom `1px` solid, background tinted with sub-surface gray.
- **Zebra & Hover:** Alternating rows subtle tint; row hover applies primary-colored 2px left border strip and 4% primary background wash.
- **Numeric Cells:** Tabular mono font, right-aligned, decimals rendered with 80% opacity for enhanced scanning.

### 2. Compact Financial KPI Cards
- Single-line structural container framed by standard 1px border.
- Top slot contains a condensed label (`label-caps`) paired with an optional variance pill badge (`+4.2%`).
- Value slot features primary `USDT` figure in bold 18px mono font, immediately paired below with secondary subdued equivalent (e.g., `≈ 1.450.200 ARS`) in 11px mono neutral text.

### 3. Risk Badges (Pill Tags)
- **Verde (Al día):** Background `#ECFDF5`, text `#065F46`, border `#A7F3D0` (Dark: `#064E3B`/`#34D399`).
- **Amarillo (Mora Leve):** Background `#FFFBEB`, text `#92400E`, border `#FDE68A` (Dark: `#78350F`/`#FBBF24`).
- **Naranja (Mora Media):** Background `#FFF7ED`, text `#9A3412`, border `#FED7AA` (Dark: `#7C2D12`/`#FB923C`).
- **Rojo (Mora Severa):** Background `#FEF2F2`, text `#991B1B`, border `#FECACA` (Dark: `#7F1D1D`/`#F87171`).
- **Negro (Riesgo Crítico / Judicial):** Background `#09090B`, text `#FFFFFF`, border `#27272A` with an inset `1px` ring of crimson.

### 4. Interactive Buttons & Sticky Top Actions
- **Primary:** Background `#2563EB`, text `#FFFFFF`, 0px shadow, high-contrast hover (`#1D4ED8`). Height: `32px` for dense actions, `36px` for primary submission.
- **Secondary / Outline:** Background transparent, text slate-800, border `1px` solid border-token.
- **Sticky ActionBar:** Fixed top position spanning the full canvas, anchoring critical batch processing controls: "Aprobar Cierre", "Simular Reparto", and "Exportar AFIP/SIRE".

### 5. Split-Panel Calculation Previews
- Two-column sync form: Left column accepts custom deduction percentages, withholding exemptions, and manual penalties.
- Right column instantly recalculates the payout breakdown: Gross Liquidation, Platform Cut, Retentions, and Net Distribution in real-time without layout shift.

### 6. Installment Schedule Grids (Cuotas)
- Miniaturized tabular grid embedded within loan detail views.
- Columns: Index (`#01`), Vencimiento (DD/MM/YY), Capital, Interés, Punitorios, Estado (Badge), and Acciones.
- Late fees dynamically highlight in crimson red upon crossing due timestamps.

### 7. Audit Timeline Nodes
- Vertical line with 1px border running through node dots.
- Node dots colored semantically based on event type: Green (Payment verified), Blue (System automated adjustment), Amber (Manual override applied by operator ID), Red (Rejection/Failed debit).