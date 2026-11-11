import { NavLink, Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCompass, faEyeDropper, type IconDefinition } from '@fortawesome/free-solid-svg-icons';

interface Page {
    to: string;
    icon: IconDefinition;
    label: string;
}

const PAGES: Page[] = [
    { to: '/', icon: faCompass, label: 'Explore' },
    { to: '/studio', icon: faEyeDropper, label: 'Studio' },
];

const keyType = 'font-bold uppercase tracking-[0.1em]';

/** Desktop: the title on the left and a row of page keys on the right. Phones: just the title. */
export const TopBar = () => (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-edge bg-case-dark px-4 shadow-[inset_0_-1px_0_#e4e3de] md:h-15 md:px-7">
        <Link to="/" className="flex items-center gap-2.5 font-bold tracking-[-0.02em]">
            <span className="text-[17px] md:text-[19px]">Chromesthesia Visualizer</span>
            <span className="border border-silk px-1 py-0.5 text-[10px] leading-none silk">
                CV-1
            </span>
        </Link>
        <nav aria-label="Pages" className="hidden items-center gap-2 md:flex">
            {PAGES.map(({ to, label }) => (
                <NavLink
                    key={to}
                    to={to}
                    end
                    className={({ isActive }) =>
                        `${isActive ? 'key-down' : 'key'} flex h-8 items-center gap-2 px-3 text-[11px] ${keyType}`
                    }
                >
                    {({ isActive }) => (
                        <>
                            {isActive && (
                                <span aria-hidden className="size-1.5 rounded-full bg-ink" />
                            )}
                            {label}
                        </>
                    )}
                </NavLink>
            ))}
        </nav>
    </header>
);

/** Phones only: a bottom row of page keys, in easy reach of a thumb. */
export const TabBar = () => (
    <nav
        aria-label="Pages"
        className="flex shrink-0 gap-2 border-t border-edge bg-case-dark px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
    >
        {PAGES.map(({ to, icon, label }) => (
            <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                    `${isActive ? 'key-down' : 'key'} flex h-12 flex-1 flex-col items-center justify-center gap-1 text-[10px] ${keyType}`
                }
            >
                <FontAwesomeIcon icon={icon} className="text-sm" />
                {label}
            </NavLink>
        ))}
    </nav>
);
