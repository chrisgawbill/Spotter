/** One finding per axe rule; selectors stay in details, outside fingerprints. */
export async function runAccessibility(page, axePath, report) {
  await page.addScriptTag({ path: axePath });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'] })).violations);
  for (const violation of violations) {
    report({
      check: 'accessibility',
      severity: ['serious', 'critical'].includes(violation.impact) ? 'medium' : 'low',
      title: `${violation.id}: ${violation.help}`,
      detail: `${violation.impact}: ${violation.nodes.length} affected elements\n${violation.nodes.slice(0, 2).map((node) => `${node.target.join(' ')}: ${node.failureSummary}`).join('\n')}`,
      repro: violation.helpUrl,
      key: { rule: violation.id },
    });
  }
}

/** Advisory smoke test: actual Tab traversal, with a bounded visit count. */
export async function runKeyboardSmoke(page, report) {
  const candidates = await page.locator('a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable=true], [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=combobox], [role=slider], [role=spinbutton]').all();
  const elements = [];
  for (const candidate of candidates) {
    if (await candidate.isVisible() && await candidate.isEnabled()) elements.push(candidate);
  }
  const handles = await Promise.all(elements.map((element) => element.elementHandle()));
  const reached = new Set();
  const missingFocus = [];
  // Start from the document rather than wherever axe or the app left focus.
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  const limit = Math.min(elements.length * 2 + 2, 500);
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate((elements) => {
      const element = document.activeElement;
      const style = getComputedStyle(element);
      return { index: elements.indexOf(element), visibleFocus: (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== 'rgba(0, 0, 0, 0)') || style.boxShadow !== 'none' };
    }, handles);
    if (focused.index >= 0) {
      if (reached.has(focused.index)) break;
      reached.add(focused.index);
      if (!focused.visibleFocus) missingFocus.push(await elements[focused.index].evaluate(describeElement));
    }
    if (reached.size === handles.length) break;
  }
  const unreachable = [];
  for (let i = 0; i < elements.length; i++) {
    if (reached.has(i)) continue;
    if (await elements[i].evaluate((element, visited) => element.matches('input[type=radio]') && element.name && visited.some((other) => other?.matches('input[type=radio]') && other.name === element.name && other.form === element.form), [...reached].map((index) => handles[index]))) continue;
    // Roving tabindex and composite widgets deliberately have one tab stop.
    if (await elements[i].evaluate((element) => !!element.closest('[role=tablist], [role=menu], [role=menubar], [role=grid], [role=tree], [role=listbox]'))) continue;
    unreachable.push(await elements[i].evaluate(describeElement));
  }
  for (const handle of handles) await handle?.dispose();
  if (unreachable.length) report({ check: 'keyboard-reachability', severity: 'low', title: 'interactive elements not reached by Tab', detail: `${unreachable.length} elements (up to ${limit} Tab presses): ${unreachable.slice(0, 3).join('; ')}` });
  if (missingFocus.length) report({ check: 'keyboard-focus', severity: 'low', title: 'check keyboard focus visibility', detail: `No outline or box shadow on: ${missingFocus.slice(0, 3).join('; ')}. Verify manually; other visual focus styles may be valid.` });
}

/** "tag#id \"accessible name\"" for finding details. Runs in the page, so it must stay self-contained. */
export function describeElement(element) {
  const text = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
  const labelledBy = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent).join(' ');
  const name = [element.getAttribute('aria-label'), labelledBy, element.labels?.[0]?.innerText, element.getAttribute('placeholder'),
    element.getAttribute('title'), element.innerText, element.getAttribute('name')].map(text).find(Boolean) ?? '';
  // Library and framework ids (mantine-x91aq68rp, :r0:, «r0», radix-…) change per render and say nothing.
  const generated = /^(?:mantine-|radix-|headlessui-|react-aria|:r|«r|_r_)/.test(element.id)
    || element.id.split(/[-_:.]/).some((part) => part.length >= 5 && /[a-z]/i.test(part) && (part.match(/\d/g)?.length ?? 0) / part.length >= 0.25);
  return `${element.tagName.toLowerCase()}${element.id && !generated ? `#${element.id}` : ''}${name ? ` "${name.slice(0, 60)}"` : ''}`;
}
