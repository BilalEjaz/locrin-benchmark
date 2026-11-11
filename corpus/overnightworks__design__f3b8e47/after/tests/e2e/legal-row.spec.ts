import { expect, test, type Locator } from '@playwright/test';
import { buildConsumer, origin, routeTo, type ConsumerName } from './build-consumer.ts';

const colorSchemes = ['light', 'dark'] as const;
const rowProperties = ['display', 'flex-wrap', 'justify-content', 'gap', 'font-size'] as const;
const linkProperties = ['color', 'border-bottom-color', 'border-bottom-style', 'border-bottom-width'] as const;

const computedOf = (element: Locator, properties: readonly string[]) =>
	element.evaluate((node, names) => {
		const style = getComputedStyle(node);
		return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
	}, properties);

for (const consumer of ['imported', 'linked'] as const satisfies ConsumerName[]) {
	test.describe(`the legal row in a production consumer that ${consumer === 'imported' ? 'imports' : 'statically links'} appkit.css`, () => {
		let outDir: string;
		test.beforeAll(async () => {
			outDir = await buildConsumer(consumer);
		});

		for (const colorScheme of colorSchemes) {
			test(`a hand-written legal row looks like the component's in ${colorScheme}`, async ({ page }) => {
				await page.emulateMedia({ colorScheme });
				await routeTo(page.context(), outDir);
				await page.goto(`${origin}/?legal`);

				const written = page.locator('#written nav');
				const component = page.locator('#component nav');
				await expect(written.getByRole('link')).toHaveCount(2);
				expect(await computedOf(written, rowProperties)).toEqual(
					await computedOf(component, rowProperties)
				);
				expect(await computedOf(written.getByRole('link').first(), linkProperties)).toEqual(
					await computedOf(component.getByRole('link').first(), linkProperties)
				);

				const probes = await page.evaluate(() => {
					const probe = document.createElement('div');
					probe.style.color = 'var(--text-muted)';
					probe.style.borderBottom = '1px solid var(--border)';
					document.body.append(probe);
					const style = getComputedStyle(probe);
					const colors = { text: style.color, border: style.borderBottomColor };
					probe.remove();
					return colors;
				});
				const link = written.getByRole('link').first();
				await expect(link).toHaveCSS('color', probes.text);
				await expect(link).toHaveCSS('border-bottom-color', probes.border);
				await expect(link).toHaveCSS('border-bottom-style', 'solid');
			});
		}
	});
}
