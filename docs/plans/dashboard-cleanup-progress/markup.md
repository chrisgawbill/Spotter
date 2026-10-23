# markup report

Changed: src/dashboard/index.html (items 1-11) and src/dashboard/dashboard.css (rewritten per brief). No other files touched.

Verified: npm test 41/41. ID set identical to HEAD (sorted diff of id="..." empty).

Notes:
- Mobile thead hiding uses the standard visually-hidden declarations written from memory (core.css has no matching `visually-hidden{` selector line to copy); equivalent clip pattern.
- Added `.scroll-region li{padding-block:2px}` (brief said to use 2px block padding on li separators).
- `.ds-input:focus-visible` rule kept as-is.
- Removed dead rules: header>span, .eyebrow, section>.ds-cluster, .ds-cluster h2, old #events/#current, button:disabled{cursor:wait}, .project-card h3/p old rules, #folder-list button, #detail[hidden] duplicate.

Unverified: rendering, keyboard, mobile layout, JS interplay (#status now has no chip class; JS must insert the chip). Coordinator runs Chromium checks.

## ESCALATIONS
None.

## Non-token literals kept (no core token exists)
1280px layout max width; 450px td max-width; 240px/180px grid/field minimums; 5rem sticky offsets (app bar height); 16rem/22rem scroll heights; 10rem button min-width; 80vh/70vh iframe; 4ch; 4px error border; 1px borders; 2px li padding (brief); -.02em letter-spacing; 1.5/1.6/1.7 line-heights; 8% color-mix; `white` iframe background (existing); 600px/800px breakpoints; ui-monospace stack.
Tokenized after reminder: config-layout gap, mobile table/cluster gaps, #config-source font size, .ds-input focus outline.
