import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SongSource from './SongSource';
import SongNotes from './SongNotes';
import SpotifyNowPlaying from './SpotifyNowPlaying';
import ColorSwatch from '../../ColorSwatch';
import ColorEntryForm from './ColorEntryForm';
import { keyClass } from '../../ui/buttons';
import SectionLabel from '../../ui/SectionLabel';
import Nameplate from '../../ui/Nameplate';
import { activeAt } from '../../../utils/timeline';
import usePlaybackPosition from '../../../hooks/usePlaybackPosition';
import Timeline from '../../Timeline';
import {
    addColor,
    deleteColor,
    getSong,
    saveColor,
    saveSongNotes,
    updateColor,
} from '../../databaseAPI';
import { insertInSongOrder, replaceInSongOrder } from '../../../utils/colorOrder';
import { colorEntryChanges, fieldsFromEntry } from '../../../utils/colorEntryForm';
import {
    login,
    logout,
    getToken,
    getUsername,
    getNowPlayingItem,
    currentToken,
} from './SpotifyAPI';
import type {
    AddColorRequest,
    ColorEntry,
    HexColor,
    NowPlaying,
    SongWithColors,
} from '@chromesthesia/shared';

const POLL_INTERVAL_MS = 5000;

interface SpotifyElementProps {
    /** The color currently selected in the picker */
    color: HexColor;
    /** Sets the picker's color (editing an entry loads its color into the picker) */
    onColorChange: (color: HexColor) => void;
}

const SpotifyElement = ({ color, onColorChange }: SpotifyElementProps) => {
    // ?song=<id> pins the Studio to a saved song; without it the Studio follows Spotify
    const [searchParams, setSearchParams] = useSearchParams();
    const pickedId = searchParams.get('song');
    // The song's saved record, with the id it was loaded for. song is null when it isn't saved
    // (yet); error is set when loading failed.
    const [stored, setStored] = useState<{
        id: string;
        song: SongWithColors | null;
        error?: string;
    } | null>(null);
    const [loggedIn, setLoggedIn] = useState(Boolean(currentToken.access_token));
    const [username, setUsername] = useState('');
    const [currentSong, setCurrentSong] = useState<NowPlaying | null>(null);
    // When currentSong was fetched, so the playback position can count forward between polls
    const [polledAt, setPolledAt] = useState(0);
    // Colors are stored with the song they were loaded for, so a stale list is never shown
    const [loadedColors, setLoadedColors] = useState<{
        songId: string;
        colors: ColorEntry[];
    } | null>(null);
    // The entry being edited, and the picker's color from before, to put back afterwards
    const [editing, setEditing] = useState<{ entry: ColorEntry; colorBefore: HexColor } | null>(
        null,
    );
    // A short confirmation shown beside the Add color button. The id restarts the timer when
    // the same message comes up twice in a row.
    const [notice, setNotice] = useState<{ text: string; id: number } | null>(null);
    const exchangedCode = useRef(false);

    useEffect(() => {
        if (!notice) return;
        const timeout = setTimeout(() => setNotice(null), 3000);
        return () => clearTimeout(timeout);
    }, [notice]);

    // Handle the redirect back from Spotify: swap ?code=... for tokens.
    // The ref guards against StrictMode running this twice (a code is single-use).
    useEffect(() => {
        const code = new URLSearchParams(window.location.search).get('code');
        if (!code || exchangedCode.current) return;
        exchangedCode.current = true;

        getToken(code)
            .then(() => setLoggedIn(true))
            .catch((err) => console.error(err))
            .finally(() => {
                // Remove ?code from the URL so a refresh doesn't reuse it
                const url = new URL(window.location.href);
                url.searchParams.delete('code');
                window.history.replaceState({}, document.title, url.href);
            });
    }, []);

    useEffect(() => {
        if (!loggedIn) return;
        getUsername().then(setUsername);
    }, [loggedIn]);

    // Poll Spotify for the currently playing song
    useEffect(() => {
        if (!loggedIn) return;
        let cancelled = false;

        const poll = async () => {
            const song = await getNowPlayingItem().catch(() => null);
            if (cancelled) return;
            if (!currentToken.access_token) {
                setLoggedIn(false); // refresh failed, tokens were cleared
                return;
            }
            setCurrentSong(song);
            setPolledAt(Date.now());
        };

        poll();
        const interval = setInterval(poll, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [loggedIn]);

    // The song being worked on: the picked one, or else the one playing
    const songId = pickedId ?? currentSong?.id;

    // Load the song's saved record (details, notes and colors) whenever the song changes
    useEffect(() => {
        if (!songId) return;
        let cancelled = false;
        getSong(songId)
            .then((song) => {
                if (cancelled) return;
                setStored({ id: songId, song });
                setLoadedColors({ songId, colors: song?.colors ?? [] });
            })
            .catch((err: Error) => {
                if (!cancelled) setStored({ id: songId, song: null, error: err.message });
            });
        return () => {
            cancelled = true;
        };
    }, [songId]);
    const colors = loadedColors && loadedColors.songId === songId ? loadedColors.colors : [];
    // Editing ends when the song changes
    const editingEntry = editing && editing.entry.songId === songId ? editing.entry : null;

    const storedLoad = songId && stored?.id === songId ? stored : null;
    // The song's details for the display and form; null while a picked song loads
    const song = pickedId ? (storedLoad?.song ?? null) : currentSong;
    // Playback only counts when it's this song that's playing
    const playingThis = currentSong !== null && currentSong.id === songId;

    const pickSong = (id: string | null) => setSearchParams(id ? { song: id } : {});

    const handleLogout = () => {
        logout();
        setLoggedIn(false);
        setUsername('');
        setCurrentSong(null);
    };

    const playbackMs = usePlaybackPosition(currentSong, polledAt);
    const positionMs = playingThis ? playbackMs : null;

    const notify = (text: string) => setNotice({ text, id: Date.now() });

    // Throws on failure so the form keeps its values and shows the error
    const handleSave = async (request: AddColorRequest) => {
        // A picked song is already saved; the playing one is saved (or updated) first
        const saved = pickedId
            ? await addColor(pickedId, request)
            : currentSong
              ? await saveColor(currentSong, request)
              : null;
        if (!saved) return;
        setLoadedColors((prev) => ({
            songId: saved.songId,
            colors: prev?.songId === saved.songId ? insertInSongOrder(prev.colors, saved) : [saved],
        }));
        notify('Color added');
        // The song's first color saved the song itself; load its record so notes can be added
        if (!storedLoad?.song) {
            getSong(saved.songId)
                .then((record) => {
                    if (record) setStored({ id: record.id, song: record });
                })
                .catch((err) => console.error(err));
        }
    };

    // Throws on failure so the notes field keeps what was typed
    const handleSaveNotes = async (notes: string[]) => {
        if (!storedLoad?.song) return;
        const updated = await saveSongNotes(storedLoad.song, notes);
        setStored((prev) =>
            prev?.song && prev.id === updated.id
                ? { ...prev, song: { ...prev.song, ...updated } }
                : prev,
        );
    };

    const startEditing = (entry: ColorEntry) => {
        // Switching from one entry to another keeps the color from before the first
        setEditing((prev) => ({ entry, colorBefore: prev ? prev.colorBefore : color }));
        setNotice(null);
        onColorChange(entry.color);
    };

    const stopEditing = () => {
        if (editing) onColorChange(editing.colorBefore);
        setEditing(null);
    };

    // Throws on failure so the form keeps its values and shows the error
    const handleUpdate = async (request: AddColorRequest) => {
        if (!editingEntry) return;
        const changes = colorEntryChanges(editingEntry, request);
        if (Object.keys(changes).length > 0) {
            const updated = await updateColor(editingEntry.id, changes);
            setLoadedColors((prev) =>
                prev ? { ...prev, colors: replaceInSongOrder(prev.colors, updated) } : prev,
            );
        }
        stopEditing();
        notify('Changes saved');
    };

    // Throws on failure so the swatch or form can stay put and let you retry
    const handleDelete = async (id: string) => {
        await deleteColor(id);
        setLoadedColors((prev) =>
            prev ? { ...prev, colors: prev.colors.filter((entry) => entry.id !== id) } : prev,
        );
        if (editingEntry?.id === id) {
            stopEditing();
            notify('Color deleted');
        }
    };

    // Everything sounding right now: the whole-song colors plus the parts under the playhead
    const activeIds = new Set(
        positionMs === null ? [] : activeAt(colors, positionMs).map((entry) => entry.id),
    );
    const activeColors = colors.filter(
        (entry) => entry.startMs === undefined || activeIds.has(entry.id),
    );
    // The status light shows the color of the part playing now, like a meter on the device
    // (only when the song in the Studio is the one playing)
    const lightColor = playingThis
        ? (colors.find((entry) => activeIds.has(entry.id))?.color ?? activeColors[0]?.color)
        : undefined;

    return (
        <div className="flex flex-col gap-6 p-5 sm:p-7 lg:p-9">
            <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2.5">
                    <span
                        aria-hidden
                        className={`size-2 shrink-0 rounded-full ${
                            loggedIn ? 'bg-ink shadow-[0_0_0_2px_#8f8e89]' : 'ring-1 ring-silk'
                        }`}
                        style={loggedIn && lightColor ? { backgroundColor: lightColor } : undefined}
                    />
                    <span className="shrink-0 text-[11px] silk">
                        {loggedIn ? 'Spotify connected' : 'Spotify not connected'}
                    </span>
                    {username && <span className="truncate text-sm text-silk">{username}</span>}
                </span>
                {loggedIn ? (
                    <button onClick={handleLogout} className={keyClass}>
                        Log out
                    </button>
                ) : (
                    <button onClick={login} className={keyClass}>
                        Connect Spotify
                    </button>
                )}
            </div>
            <SongSource pickedId={pickedId} onPick={pickSong} />
            {pickedId && storedLoad && !storedLoad.song ? (
                <div className="flex flex-col items-start gap-3 well rounded-md p-4">
                    <p className="text-sm" role="alert">
                        {storedLoad.error ?? 'There’s no saved song with this id.'}
                    </p>
                    <button type="button" className={keyClass} onClick={() => pickSong(null)}>
                        Back to now playing
                    </button>
                </div>
            ) : (
                <SpotifyNowPlaying
                    song={song}
                    status={
                        playingThis
                            ? currentSong?.isPlaying
                                ? 'Now playing'
                                : 'Paused'
                            : pickedId
                              ? song
                                  ? 'Saved song'
                                  : 'Loading…'
                              : 'Nothing playing'
                    }
                    isPlaying={playingThis && Boolean(currentSong?.isPlaying)}
                    emptyMessage={pickedId ? '' : undefined}
                    activeColors={activeColors}
                />
            )}
            {song && (
                <section className="flex flex-col gap-3">
                    <SectionLabel>Timeline</SectionLabel>
                    <Timeline
                        entries={colors}
                        durationMs={song.durationMs}
                        positionMs={positionMs}
                        selectedId={editingEntry?.id}
                        onSelect={startEditing}
                    />
                </section>
            )}
            {editingEntry && (
                <ColorEntryForm
                    key={editingEntry.id}
                    editing={editingEntry}
                    initial={fieldsFromEntry(editingEntry)}
                    color={color}
                    positionMs={positionMs}
                    durationMs={song?.durationMs}
                    onSubmit={handleUpdate}
                    onCancel={stopEditing}
                    onDelete={() => handleDelete(editingEntry.id)}
                />
            )}
            {/* Hidden rather than unmounted while editing, so it keeps what you'd typed. Keyed
                by song so a new song starts empty. The part stays filled in after saving, so
                several colors can go on the same part. */}
            <div className={editingEntry ? 'hidden' : undefined}>
                <ColorEntryForm
                    key={songId ?? 'none'}
                    color={color}
                    positionMs={positionMs}
                    durationMs={song?.durationMs}
                    disabled={!song}
                    status={notice?.text}
                    onSubmit={handleSave}
                />
            </div>
            <section className="flex flex-col gap-4">
                {/* A song is only saved once it has a color, so the link never leads to a 404 */}
                <SectionLabel
                    aside={
                        songId && colors.length > 0 ? (
                            <span className="flex items-center gap-3">
                                {colors.length}
                                <Link
                                    to={`/songs/${encodeURIComponent(songId)}`}
                                    className="font-body text-[11px] silk hover:text-ink hover:underline"
                                >
                                    Song page →
                                </Link>
                            </span>
                        ) : undefined
                    }
                >
                    Colors for this song
                </SectionLabel>
                {colors.length > 0 ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 2xl:grid-cols-4">
                        {colors.map((entry) => (
                            <ColorSwatch
                                entry={entry}
                                key={entry.id}
                                onDelete={() => handleDelete(entry.id)}
                                onEdit={() => startEditing(entry)}
                            />
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-silk">
                        {song
                            ? 'No colors yet for this song.'
                            : 'Colors for the song you’re playing show up here.'}
                    </p>
                )}
            </section>
            {song && (
                <SongNotes
                    key={songId}
                    notes={storedLoad?.song?.notes ?? []}
                    saved={Boolean(storedLoad?.song)}
                    onSave={handleSaveNotes}
                />
            )}
            <div className="mt-2">
                <Nameplate details={['Model CV-1', 'Color studio']} />
            </div>
        </div>
    );
};

export default SpotifyElement;
