import type {
    AddColorRequest,
    AuthStatus,
    ColorEntry,
    LoginRequest,
    NowPlaying,
    Song,
    SongWithColors,
    UpdateColorRequest,
    UpsertSongRequest,
} from '@chromesthesia/shared';

const songPath = (id: string) => `/api/songs/${encodeURIComponent(id)}`;

const sendJson = (url: string, method: string, body: unknown) =>
    fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

/** Reads the server's error message, falling back to the status code. */
const errorFrom = async (response: Response, what: string) => {
    const body = await response.json().catch(() => null);
    const detail = body && typeof body.error === 'string' ? `: ${body.error}` : '';
    return new Error(`${what} failed (${response.status})${detail}`);
};

/** Lists saved songs (the API returns up to 50). */
export const listSongs = async (): Promise<Song[]> => {
    const response = await fetch('/api/songs');
    if (!response.ok) throw await errorFrom(response, 'Loading songs');
    return response.json();
};

/** Gets one song with its colors in song order, or null if there's no such song. */
export const getSong = async (id: string): Promise<SongWithColors | null> => {
    const response = await fetch(songPath(id));
    if (response.status === 404) return null;
    if (!response.ok) throw await errorFrom(response, 'Loading song');
    return response.json();
};

/** Saves (creates or updates) the playing song's metadata. Its notes are left as they are. */
export const saveSong = async (song: NowPlaying): Promise<void> => {
    const { id, isPlaying: _isPlaying, progressMs: _progressMs, ...rest } = song;
    const metadata: UpsertSongRequest = rest;
    const response = await sendJson(songPath(id), 'PUT', metadata);
    if (!response.ok) throw await errorFrom(response, 'Saving song');
};

/**
 * Replaces a saved song's notes ([] clears them). The PUT needs the song's details too, so they
 * are sent back as they are.
 */
export const saveSongNotes = async (song: Song, notes: string[]): Promise<Song> => {
    const { title, artists, albumImageUrl, songUrl, durationMs, album, artistUrls } = song;
    const body: UpsertSongRequest = {
        title,
        artists,
        albumImageUrl,
        songUrl,
        durationMs,
        album,
        artistUrls,
        notes,
    };
    const response = await sendJson(songPath(song.id), 'PUT', body);
    if (!response.ok) throw await errorFrom(response, 'Saving notes');
    return response.json();
};

/** Assigns a color to a song that's already saved (for the whole song or one part). */
export const addColor = async (songId: string, request: AddColorRequest): Promise<ColorEntry> => {
    const response = await sendJson(`${songPath(songId)}/colors`, 'POST', request);
    if (!response.ok) throw await errorFrom(response, 'Saving color');
    return response.json();
};

/** Saves the playing song's metadata, then assigns it a color. */
export const saveColor = async (
    song: NowPlaying,
    request: AddColorRequest,
): Promise<ColorEntry> => {
    await saveSong(song);
    return addColor(song.id, request);
};

/** Changes some fields of one color entry; null clears a field. */
export const updateColor = async (id: string, patch: UpdateColorRequest): Promise<ColorEntry> => {
    const response = await sendJson(`/api/colors/${encodeURIComponent(id)}`, 'PATCH', patch);
    if (!response.ok) throw await errorFrom(response, 'Updating color');
    return response.json();
};

/** Deletes one color entry. One that's already gone counts as deleted. */
export const deleteColor = async (id: string): Promise<void> => {
    const response = await fetch(`/api/colors/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
        throw new Error(`Deleting color failed (${response.status})`);
    }
};

/** Whether this browser is logged in as the owner. */
export const getAuthStatus = async (): Promise<AuthStatus> => {
    const response = await fetch('/api/auth/me');
    if (!response.ok) throw await errorFrom(response, 'Checking login');
    return response.json();
};

/** Thrown by login() when there have been too many wrong passwords. */
export class TooManyAttemptsError extends Error {
    constructor(public retryAfterSeconds: number) {
        super('Too many attempts');
    }
}

/** Logs in as the owner. Resolves false for a wrong password. */
export const login = async (password: string): Promise<boolean> => {
    const body: LoginRequest = { password };
    const response = await sendJson('/api/auth/login', 'POST', body);
    if (response.status === 401) return false;
    if (response.status === 429) {
        throw new TooManyAttemptsError(Number(response.headers.get('Retry-After')) || 0);
    }
    if (!response.ok) throw await errorFrom(response, 'Logging in');
    return true;
};

/** Logs out of the owner session. */
export const logout = async (): Promise<void> => {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw await errorFrom(response, 'Logging out');
};
