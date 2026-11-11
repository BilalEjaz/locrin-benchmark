import './app.css';
import { mount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { AccountMenu, LegalLinks, SignInPage, type ThemeChoice } from 'overnightworks-appkit';

declare global {
	interface Window {
		/** Every report the menu made, in order. */
		reports: string[];
	}
}

const legalLinks = [
	{ label: 'Imprint', href: '/imprint' },
	{ label: 'Privacy', href: '/privacy' }
];

/** Long enough that the row wraps in the 256 px panel, as an app's real labels do. */
const menuLegalLinks = [
	{ label: 'Impressum', href: '/imprint' },
	{ label: 'Datenschutz', href: '/privacy' },
	{ label: 'Nutzungsbedingungen', href: '/terms' }
];

/** The app's side of the theme: it keeps the choice in memory and sets data-theme, as an app would. */
function themeHolder(takesChoice: boolean) {
	const held = new SvelteMap<string, ThemeChoice>([['choice', 'follow-system']]);
	const apply = (choice: ThemeChoice): void => {
		if (choice === 'follow-system') document.documentElement.removeAttribute('data-theme');
		else document.documentElement.setAttribute('data-theme', choice);
	};
	return {
		get choice() {
			return held.get('choice')!;
		},
		onChange(choice: ThemeChoice) {
			window.reports.push(`theme:${choice}`);
			if (!takesChoice) return;
			held.set('choice', choice);
			apply(choice);
		}
	};
}

function mountMenu(variant: string): void {
	window.reports = [];
	const report = (what: string) => () => void window.reports.push(what);
	const common = {
		name: 'Felix mcDonald',
		accountHref: '/account',
		onAccountOpen: report('account'),
		appRows: [{ label: 'Settings', icon: 'settings', onSelect: report('settings') }] as const,
		legalLinks: menuLegalLinks
	};
	const logOut =
		variant === 'action' ? { logOutAction: '/logout' } : { onLogOut: report('logout') };
	const theme = variant === 'no-theme' ? undefined : themeHolder(variant !== 'ignore');
	mount(AccountMenu, { target: document.body, props: { ...common, ...logOut, theme } });
}

if (location.search === '?typed') {
	// A person typed the name; the app wrote the words around it.
	document.body.innerHTML = '<main><h1>Source <span class="as-typed">talks</span></h1></main>';
} else if (location.search === '?legal') {
	// The markup contract of a page that cannot render Svelte, beside the component's own row.
	document.body.innerHTML = `<div id="written"><nav class="legal" aria-label="Legal">${legalLinks
		.map((link) => `<a href="${link.href}">${link.label}</a>`)
		.join('')}</nav></div><div id="component"></div>`;
	mount(LegalLinks, {
		target: document.getElementById('component')!,
		props: { links: legalLinks }
	});
} else if (location.search.startsWith('?menu')) {
	mountMenu(new URLSearchParams(location.search).get('menu') ?? '');
} else {
	mount(SignInPage, {
		target: document.body,
		props: {
			appName: 'Probe',
			state: { page: 'signed-out', signInHref: '/login' },
			legalLinks: legalLinks.slice(0, 2)
		}
	});
}
