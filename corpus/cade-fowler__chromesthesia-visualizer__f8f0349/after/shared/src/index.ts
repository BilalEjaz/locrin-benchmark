// Types shared by the client and the server.
// Type-only: nothing in here exists at runtime, so it needs no build step.

/** A hex color string such as "#ff8800". */
export type HexColor = string;

/** The album a song is on, from Spotify. */
export interface Album {
    /** Spotify album id */
    id: string;
    name: string;
    /** The album's Spotify page */
    url: string;
    /** "YYYY", "YYYY-MM" or "YYYY-MM-DD", depending on releaseDatePrecision */
    releaseDate: string;
    releaseDatePrecision: 'year' | 'month' | 'day';
    type: 'album' | 'single' | 'compilation';
}

/** Song details from Spotify beyond the basics. Songs saved before these existed lack them. */
export interface SongDetails {
    album?: Album;
    /** Each artist's Spotify page, in the same order as the artists */
    artistUrls?: string[];
}

/** The song Spotify reports as currently playing, shaped for the UI. */
export interface NowPlaying extends SongDetails {
    id: string;
    title: string;
    /** Artist names, as Spotify lists them (a name may itself contain a comma) */
    artists: string[];
    albumImageUrl?: string;
    songUrl: string;
    isPlaying: boolean;
    /** Playback position when Spotify was polled */
    progressMs: number;
    /** Length of the track */
    durationMs: number;
}

/** A song's metadata as stored in MongoDB and returned by the API. */
export interface Song extends SongDetails {
    /** Spotify track id */
    id: string;
    title: string;
    artists: string[];
    albumImageUrl?: string;
    songUrl: string;
    /** Length of the track, from Spotify. Older songs get it the next time they're saved. */
    durationMs?: number;
    /** Impressions of the song as a whole, such as a texture ("glossy") */
    notes?: string[];
}

/** One color assigned to a song, or to part of it. */
export interface ColorEntry {
    /** Opaque id (a Mongo ObjectId as hex) */
    id: string;
    /** The Spotify track id of the song this color belongs to */
    songId: string;
    /** Lowercase #rrggbb */
    color: HexColor;
    /** Start of the part this color applies to; omitted (with endMs) for the whole song */
    startMs?: number;
    /** End of the part this color applies to; always greater than startMs */
    endMs?: number;
    /** A name for the part, such as "chorus" */
    label?: string;
    /** Impressions of this color, such as a texture ("glossy") */
    notes?: string[];
    /** ISO 8601 timestamp of when the color was assigned */
    createdAt: string;
}

/**
 * Response of GET /api/songs/:id: the song with its colors in song order, which is the order
 * GET /api/songs/:id/colors uses too. Whole-song colors come first, then parts by startMs;
 * ties go to whichever was saved first.
 */
export interface SongWithColors extends Song {
    colors: ColorEntry[];
}

/**
 * Body of PUT /api/songs/:id (the id comes from the URL). Leaving out notes, durationMs, album or
 * artistUrls keeps the song's current value, so saving from Spotify never wipes notes; send [] to clear them.
 */
export type UpsertSongRequest = Omit<Song, 'id'>;

/** Body of POST /api/songs/:id/colors. Colors may be #rgb or #rrggbb in any case. */
export type AddColorRequest = Pick<ColorEntry, 'color' | 'startMs' | 'endMs' | 'label' | 'notes'>;

/**
 * Body of PATCH /api/colors/:id. Only the fields given change; null clears a field. Clearing
 * startMs and endMs together turns a part back into a whole-song color. Send at least one field.
 */
export interface UpdateColorRequest {
    color?: HexColor;
    startMs?: number | null;
    endMs?: number | null;
    label?: string | null;
    notes?: string[] | null;
}

/** Body of POST /api/auth/login. */
export interface LoginRequest {
    password: string;
}

/** Response of GET /api/auth/me. */
export interface AuthStatus {
    /** Whether this browser is logged in as the owner, who is the only one who can write */
    owner: boolean;
}

/** Shape of every API error response. */
export interface ApiError {
    error: string;
}
