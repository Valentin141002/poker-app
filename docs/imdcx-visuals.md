# IMDCX visual refinement

For the September 13 home-only luxury salon update, its four runtime files, deployment commands and artwork prompt, use [imdcx-home-luxury.md](imdcx-home-luxury.md).

For the current competitive progression release, including server deployment and data preservation, use [imdcx-progression.md](imdcx-progression.md). The notes below describe the earlier visual-only updates.

The home screen, Bataille overlay, and multiplier wheel use an optional presentation layer:

- `poker-app/static/css/imdcx-premium.css`: scoped layout, materials, responsive styles, and motion preferences.
- `poker-app/static/js/imdcx-visuals.js`: DOM decoration, pointer tilt, procedural SVG wheel, and spin animation.
- `poker-app/poker.html`: loads those two assets.
- `poker-app/static/js/client.js`: optional presentation hooks at creation of the three views and at the existing wheel animation.

The original home artwork, component order, routes, Socket.IO events, scoring, card reveals, result text, and result dismissal timing remain in place. Poker table and other modal styles are outside the new CSS scopes.

The initial visual-only update retained **x2, x3, x5, x10**. The later competitive progression brief supersedes that choice with **x1, x2, x5, x10** and adds server-owned rewards and multiplier choices; see [imdcx-progression.md](imdcx-progression.md). The visual wheel still derives its segments from the client constants and lands on the server result.

## Home reference update — September 12

The latest home-only update follows the supplied luminous reference: points and rank to the left, victories and multiplier to the right, centered logo and capsule Play button, and three beveled navigation buttons over the reflective background. Stat values still come from the existing profile handler. Decorative SVG waves, footer text, and pointer tilt on buttons are added only by the home initializer. Narrow screens place the stats below the hero; the smallest screens use two columns for legible labels.

This update changes only the two existing runtime assets `imdcx-premium.css` and `imdcx-visuals.js`. Upload those two files to their existing locations and reload without the browser cache. No new images or server restart are required. Battle and wheel presentation and behavior are unchanged by this update.

## Restore the previous appearance

Remove the `imdcx-premium.css` link and `imdcx-visuals.js` script from `poker.html`, then reload. Both must be disabled together. The optional client hooks become no-ops, and the original spin animation remains as a fallback. No player data migration is needed.

## Verification

Run `node scripts/verify-imdcx-visuals.cjs` with Node 22+ and Chrome installed. `CHROME_PATH` can override the executable location. The check serves the actual application page locally with fixture Socket.IO events; it does not start the game server or change player files.

The check covers profile rendering, flanking desktop stats, Play hover/press and error feedback, settings navigation, practice battle actions and card reveals, all four wheel outcomes, reduced motion, and narrow/landscape layouts. Screenshots (including the reference viewport and hover/press states) and the check report are written to `build/imdcx-review/` (ignored by Git). Browser profiles are retained in that directory for inspection.

The animations use CSS transforms and opacity, and a requestAnimationFrame loop only during the 3.2-second wheel spin or active pointer interaction. Touch devices do not run pointer tilt. Reduced motion disables entrance/ambient effects and lands the wheel without spinning. Physical-device frame rates and production multiplayer were not measured by the fixture check.
