# DESIGN

## Theme
Dark mode is the primary theme.

The UI is meant to feel like a focused evaluation surface used during active decision-making, often in low-distraction or evening contexts. Surfaces should stay calm and low-glare, while key comparison signals remain crisp and high-contrast.

## Color System
Existing direction is dark, warm-accented, and muted:
- Backgrounds use blue-gray / slate-leaning dark neutrals
- Accent uses a warm orange
- Supporting segment colors for timeline visualization are distinct but controlled

### Core Roles
- `--paper`: main app background
- `--surface-raised`: top bar / elevated surfaces
- `--surface-card`: controls and cards
- `--line`: dividers and structural edges
- `--ink`: primary text
- `--muted`: secondary text
- `--accent`: interactive highlight
- `--accent-hi`: brighter highlight state
- `--accent-soft`: subdued accent surface

### Color Principles
- Keep the interface predominantly restrained, with accent reserved for interaction, emphasis, and selected states.
- Maintain strong contrast for numeric information.
- Avoid introducing bright rainbow accents outside timeline/route differentiation.
- Do not drift toward neon, luxury-black, or travel-poster aesthetics.

## Typography
- Sans: `"Sora", system-ui, sans-serif`
- Serif support: `"Source Serif 4", Georgia, serif`

### Typographic Intent
- Numbers are a first-class visual element.
- Labels should be compact, uppercase where useful, and secondary to values.
- Hero values like price and trip stats should feel decisive and easy to compare.
- Travel metadata should remain compact and scannable.

## Layout
- Keep the app wide and scan-friendly on desktop.
- Prefer horizontal comparison where it improves decision speed.
- On mobile, collapse into narrow but still information-dense blocks.
- Sticky navigation/filter context is good when it preserves orientation during long result review.

## Components

### Search Bar
- Compact, utility-first
- Should feel fast and direct
- Avoid decorative inputs or oversized chrome

### Filters
- Emphasize current selected values
- Minimize layout shift
- Use compact controls on small screens
- Stops filter can behave more like a segmented control than a classic slider

### Price Block
- Price should remain the strongest numeric anchor
- Slider alignment and spacing should feel deliberate, not centered by accident

### Itinerary Header
- Direction, date, duration, and layover should read as one compact information cluster
- Hierarchy should support quick scanning between outbound and return

### Timeline
- Must communicate structure quickly
- Preserve meaningful differences between itineraries
- Avoid excessive label clutter on small screens
- Mobile should bias toward shape and proportion over annotation density

## Motion
- Use short, smooth, purposeful motion
- Good candidates: loading states, value transitions, layout updates, timeline repositioning
- Avoid bouncy or playful motion
- Motion should feel like responsive instrumentation, not celebration

## Responsive Priorities
- Protect readability of price and core stats first
- Reduce nonessential labels on small screens
- Let controls shrink intelligently before wrapping into awkward layouts
- Keep important actions visible without making the interface feel cramped

## Things To Avoid
- Card-heavy SaaS dashboard patterns
- Large empty gutters on mobile
- Overuse of badges, chips, or status decoration
- Excessively tiny labels for key itinerary information
- Over-animated travel motifs
