/** Where to go after logging in: the ?next= path if it's on this site, otherwise the Studio. */
export const safeNext = (next: string | null): string =>
    next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')
        ? next
        : '/studio';
