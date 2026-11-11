import { expect, test } from '@playwright/test';
import { buildConsumer, origin, routeTo, type ConsumerName } from './build-consumer.ts';

const colorSchemes = ['light', 'dark'] as const;

for (const consumer of ['imported', 'linked'] as const satisfies ConsumerName[]) {
	test.describe(`a production consumer that ${consumer === 'imported' ? 'imports' : 'statically links'} appkit.css`, () => {
		let outDir: string;
		test.beforeAll(async () => {
			outDir = await buildConsumer(consumer);
		});

		for (const colorScheme of colorSchemes) {
			test(`paints the sign-in grid, glows and legal row in ${colorScheme}`, async ({ page }) => {
				await page.emulateMedia({ colorScheme });
				await routeTo(page, outDir);
				await page.goto(`${origin}/`);

				const card = page.getByRole('main');
				await expect(card.getByRole('heading')).toBeVisible();

				// No class names are read: the layers are the card's three earlier siblings (grid, then two
				// glows), so a decorative layer added to or removed from SignInPage must update this count.
				const layers = card.locator('xpath=preceding-sibling::*');
				await expect(layers).toHaveCount(3);
				const [grid, ...glows] = await layers.all();
				await expect(grid).toHaveCSS('background-image', /gradient/);
				for (const glow of glows) {
					await expect(glow).toBeVisible();
					await expect(glow).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
				}

				const viewport = page.viewportSize()!;
				for (const name of ['Imprint', 'Privacy']) {
					const link = page.getByRole('link', { name });
					await expect(link).toBeVisible();
					const box = (await link.boundingBox())!;
					expect(box.x).toBeGreaterThanOrEqual(0);
					expect(box.y).toBeGreaterThanOrEqual(0);
					expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
					expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
				}
			});
		}

		test('names the app once in the card for screen readers', async ({ page }) => {
			await routeTo(page, outDir);
			await page.goto(`${origin}/`);

			const snapshot = await page.getByRole('main').ariaSnapshot();
			expect(snapshot.match(/Probe/gi)).toHaveLength(1);
		});

		test('keeps the case of typed text in an uppercase heading', async ({ page }) => {
			await routeTo(page, outDir);
			await page.goto(`${origin}/?typed`);

			const heading = page.getByRole('heading', { level: 1 });
			const typed = heading.locator('.as-typed');
			await expect(typed).toHaveCSS('text-transform', 'none');
			expect(await typed.innerText()).toBe('talks');
			expect(await heading.innerText()).toBe('SOURCE talks');
		});
	});
}
