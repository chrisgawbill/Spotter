// These functions run inside the page via page.evaluate, so each must be
// self-contained: no imports, no closures over module scope.

/**
 * Finds content wider than the viewport. Returns null when there is none;
 * otherwise `kind` is `scrolls` (the page scrolls sideways) or `cut-off` (the
 * page clips overflow, so content straddling the right edge is hidden), with
 * the overflow in px and up to three outermost offending elements. Content
 * clipped by any scroll/hidden container inside the viewport, and off-canvas elements that
 * sit wholly past the edge of a clipping page, are not offenders.
 */
export function findHorizontalOverflow() {
  const root = document.documentElement;
  const viewportWidth = root.clientWidth;
  const clipsSideways = (element) => ['hidden', 'clip'].includes(getComputedStyle(element).overflowX);
  const pageScrolls = !clipsSideways(root) && !clipsSideways(document.body) && root.scrollWidth - viewportWidth > 1;

  const isClippedByAncestor = (element) => {
    for (let ancestor = element.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
      // Any clipping ancestor inside the viewport hides the overflow (e.g. a carousel scroller
      // around a peeking card that itself clips its own children).
      if (getComputedStyle(ancestor).overflowX !== 'visible' && ancestor.getBoundingClientRect().right <= viewportWidth + 1) {
        return true;
      }
    }
    return false;
  };
  const isShown = (element) => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const stickingOut = [...document.body.querySelectorAll('*')].filter((element) => {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0 || box.right <= viewportWidth + 1) return false;
    if (!pageScrolls && box.left >= viewportWidth - 1) return false;
    return isShown(element) && !isClippedByAncestor(element);
  });
  if (!pageScrolls && stickingOut.length === 0) return null;

  const stickingOutSet = new Set(stickingOut);
  const outermost = stickingOut.filter((element) => {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (stickingOutSet.has(ancestor)) return false;
    }
    return true;
  });
  const describe = (element) => {
    const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join('');
    const id = element.id ? `#${element.id}` : '';
    const text = (element.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
    const right = Math.round(element.getBoundingClientRect().right);
    return `${element.tagName.toLowerCase()}${id}${classes}${text ? ` "${text}"` : ''} (right edge ${right}px)`;
  };
  const widestRight = Math.max(...stickingOut.map((element) => element.getBoundingClientRect().right), viewportWidth);
  return {
    kind: pageScrolls ? 'scrolls' : 'cut-off',
    overflowPx: Math.round(pageScrolls ? root.scrollWidth - viewportWidth : widestRight - viewportWidth),
    elements: outermost.slice(0, 3).map(describe),
  };
}

/** Visible text (for error-text checks) and whether anything rendered at all. */
export function measureVisibleContent() {
  const text = document.body?.innerText ?? '';
  return {
    text,
    textLength: text.trim().length,
    mediaCount: document.querySelectorAll('img, svg, canvas, video').length,
  };
}
