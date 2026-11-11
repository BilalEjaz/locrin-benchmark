import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { CATEGORIES, openCategory, openShowcase } from './showcase';

/**
 * What a screen reader is told about every catalog screen: each element's role, name
 * and state, compared against a reviewed baseline. Styling never changes it, so it only
 * fails when an announcement changes, such as an icon glyph leaking into a button's name.
 *
 * A deliberate change: `bun run test:web -- --update-snapshots`, then review the
 * .aria.yml diff like code. The clock is fixed so dates never change on their own.
 */
const UNNAMED_CONTROL =
  /- (?:button|tab|link|switch|checkbox|radio|textbox|combobox)(?: "[\uE000-\uF8FF\s]*")?(?=$|:| \[)/gm;

test.describe('Accessibility tree', () => {
  // One baseline: WebKit computes a few names differently, and a second set of
  // baselines would double the maintenance without catching a different bug.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium holds the baseline');

  for (const category of CATEGORIES) {
    test(category, async ({ page }) => {
      // Calendars name every day ("Wednesday 11 November 2026"); a fixed date keeps the
      // baseline exact instead of failing at the turn of each month.
      await page.clock.setFixedTime(new Date('2026-06-15T10:00:00'));
      await openShowcase(page);
      await openCategory(page, category);
      // Independent of the baseline, so accepting a baseline can never accept this: a
      // control named only by an icon font glyph (private-use characters) or nothing.
      const tree = await page.locator('body').ariaSnapshot();
      expect(tree.match(UNNAMED_CONTROL) ?? []).toEqual([]);
      const name = `${category.toLowerCase().replace(/\s+/g, '-')}.aria.yml`;
      const body = page.locator('body');
      await expect(body).toMatchAriaSnapshot({ name });
      // Snapshots match partially by default, so an added control would pass unseen, and
      // --update-snapshots drops a directive written into the file. Apply it here.
      const baseline = readFileSync(join(test.info().snapshotDir, name), 'utf8');
      await expect(body).toMatchAriaSnapshot(`- /children: equal\n${baseline}`);
    });
  }
});
