# IMDCX visual refinement

The home screen, Bataille overlay, and multiplier wheel use an optional presentation layer:

- `poker-app/static/css/imdcx-premium.css`: scoped layout, materials, responsive styles, and motion preferences.
- `poker-app/static/js/imdcx-visuals.js`: DOM decoration, pointer tilt, procedural SVG wheel, and spin animation.
- `poker-app/poker.html`: loads those two assets.
- `poker-app/static/js/client.js`: optional presentation hooks at creation of the three views and at the existing wheel animation.

The original home artwork, component order, routes, Socket.IO events, scoring, card reveals, result text, and result dismissal timing remain in place. Poker table and other modal styles are outside the new CSS scopes.

The user confirmed retaining the existing **x2, x3, x5, x10** rewards instead of the x1 variant in the initial visual brief. The wheel draws its segments from the existing client constants and lands on the existing server result. No probabilities or server code changed.

## Restore the previous appearance

Remove the `imdcx-premium.css` link and `imdcx-visuals.js` script from `poker.html`, then reload. Both must be disabled together. The optional client hooks become no-ops, and the original spin animation remains as a fallback. No player data migration is needed.

## Verification

Run `node scripts/verify-imdcx-visuals.cjs` with Node 22+ and Chrome installed. `CHROME_PATH` can override the executable location. The check serves the actual application page locally with fixture Socket.IO events; it does not start the game server or change player files.

The check covers profile rendering, Play and error feedback, settings navigation, practice battle actions and card reveals, all four wheel outcomes, reduced motion, and narrow/landscape layouts. Screenshots and the check report are written to `build/imdcx-review/` (ignored by Git). Browser profiles are retained in that directory for inspection.

The animations use CSS transforms and opacity, and a requestAnimationFrame loop only during the 3.2-second wheel spin or active pointer interaction. Touch devices do not run pointer tilt. Reduced motion disables entrance/ambient effects and lands the wheel without spinning. Physical-device frame rates and production multiplayer were not measured by the fixture check.
