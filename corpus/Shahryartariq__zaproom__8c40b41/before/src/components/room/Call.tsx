"use client";

import {
  LiveKitRoom,
  RoomAudioRenderer,
  useAudioPlayback,
  useChat,
  useConnectionState,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { ConnectionState, DisconnectReason, RoomEvent, Track, type Participant } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { ControlBar } from "./ControlBar";
import { Reactions, useReactions } from "./Reactions";
import { SidePanel, type PanelTab } from "./SidePanel";
import { Tile } from "./Tile";
import type { Connection, MediaChoices, RoomInfo } from "./types";

type Props = {
  info: RoomInfo;
  conn: Connection;
  media: MediaChoices;
  onLeave: (reason: string) => void;
  /** Extra controls for the top bar (the stranger screen's Next button). */
  topExtra?: React.ReactNode;
  /** Called when everyone else has left (strangers: your match hung up). */
  onAlone?: (why: "left" | "no-show") => void;
  /** Strangers: give up if nobody else arrives within this time. */
  noShowMs?: number;
};

export function Call({ info, conn, media, onLeave, topExtra, onAlone, noShowMs }: Props) {
  const leftOnPurpose = useRef(false);
  const voice = info.kind === "voice";

  const roomOptions = useMemo(
    () => ({
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: { resolution: { width: 1280, height: 720, frameRate: 30 } },
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    }),
    [],
  );

  return (
    <LiveKitRoom
      className="call"
      serverUrl={conn.url}
      token={conn.token}
      connect
      audio={media.audio ? (media.audioDeviceId ? { deviceId: media.audioDeviceId } : true) : false}
      video={!voice && media.video ? (media.videoDeviceId ? { deviceId: media.videoDeviceId } : true) : false}
      options={roomOptions}
      onDisconnected={(reason) => {
        if (leftOnPurpose.current) return onLeave("You can rejoin while the room is open.");
        onLeave(disconnectMessage(reason));
      }}
      onError={(e) => console.error("[call]", e)}
    >
      <CallInner
        info={info}
        topExtra={topExtra}
        onAlone={onAlone}
        noShowMs={noShowMs}
        markLeaving={() => (leftOnPurpose.current = true)}
      />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

function disconnectMessage(reason?: DisconnectReason): string {
  switch (reason) {
    case DisconnectReason.ROOM_DELETED:
      return "The room closed.";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "You were removed from the room.";
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "You joined this room from another tab.";
    case DisconnectReason.ROOM_CLOSED:
      return "The room closed.";
    default:
      return "The connection dropped. Check your internet and rejoin.";
  }
}

function CallInner({
  info,
  topExtra,
  onAlone,
  noShowMs,
  markLeaving,
}: {
  info: RoomInfo;
  topExtra?: React.ReactNode;
  onAlone?: (why: "left" | "no-show") => void;
  noShowMs?: number;
  markLeaving: () => void;
}) {
  const room = useRoomContext();
  const state = useConnectionState();
  const participants = useParticipants();
  const { canPlayAudio, startAudio } = useAudioPlayback();
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [copied, setCopied] = useState(false);
  const toasts = useJoinLeaveToasts();
  const reactions = useReactions();
  const chat = useChat();
  const unread = useUnread(chat.chatMessages, panel === "chat", room.localParticipant.identity);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  const screens = tracks.filter((t) => t.source === Track.Source.ScreenShare);
  const cameras = tracks.filter((t) => t.source === Track.Source.Camera);

  // Strangers: when your match leaves, the call is over.
  const hadCompany = useRef(false);
  useEffect(() => {
    if (participants.length > 1) hadCompany.current = true;
    if (hadCompany.current && participants.length === 1) onAlone?.("left");
  }, [participants.length, onAlone]);
  useEffect(() => {
    if (!noShowMs || !onAlone) return;
    const timer = setTimeout(() => {
      if (!hadCompany.current) onAlone("no-show");
    }, noShowMs);
    return () => clearTimeout(timer);
  }, [noShowMs, onAlone]);

  async function copyInvite() {
    const url = `${location.origin}/r/${info.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function leave() {
    markLeaving();
    void room.disconnect();
  }

  const stranger = info.visibility === "stranger";

  return (
    <>
      <div className="call-top">
        <h1>{stranger ? "Meet a stranger" : info.title}</h1>
        <span className="chip">
          <Icon name="people" />
          {participants.length}
        </span>
        {state === ConnectionState.Reconnecting ? (
          <span className="chip" role="status">
            Reconnecting…
          </span>
        ) : state === ConnectionState.Connecting ? (
          <span className="chip" role="status">
            Connecting…
          </span>
        ) : null}
        <span className="spacer" />
        {!stranger ? (
          <button className="btn ghost" onClick={copyInvite} aria-live="polite">
            <Icon name={copied ? "check" : "link"} />
            {copied ? "Link copied" : "Copy invite link"}
          </button>
        ) : null}
        {topExtra}
      </div>

      <div className={panel ? "call-body with-panel" : "call-body"}>
        <section className={screens.length ? "stage has-screen" : "stage"} aria-label="People in the call">
          {screens[0] ? <Tile trackRef={screens[0]} screen /> : null}
          <div className="grid" data-count={Math.min(cameras.length, 6)} data-many={cameras.length > 6 || undefined}>
            {cameras.map((t) => (
              <Tile key={`${t.participant.identity}-cam`} trackRef={t} />
            ))}
          </div>
          {stranger && participants.length === 1 && state === ConnectionState.Connected ? (
            <p className="chip waiting-chip" role="status">
              Waiting for your match to connect…
            </p>
          ) : null}
          <Reactions items={reactions.items} />
        </section>
        {panel ? <SidePanel tab={panel} onTab={setPanel} onClose={() => setPanel(null)} chat={chat} /> : null}
      </div>

      <ControlBar
        voice={info.kind === "voice"}
        panel={panel}
        onPanel={(tab) => setPanel((cur) => (cur === tab ? null : tab))}
        unread={unread}
        onReact={reactions.send}
        onLeave={leave}
        leaveLabel={stranger ? "End" : "Leave"}
      />

      {!canPlayAudio ? (
        <div className="toast-stack">
          <button className="btn primary" onClick={() => void startAudio()}>
            Tap to hear the room
          </button>
        </div>
      ) : (
        <div className="toast-stack" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              {t.text}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function useJoinLeaveToasts() {
  const room = useRoomContext();
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    let n = 0;
    const push = (text: string) => {
      const id = ++n;
      setToasts((t) => [...t.slice(-2), { id, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
    };
    const joined = (p: Participant) => push(`${p.name || "Someone"} joined`);
    const left = (p: Participant) => push(`${p.name || "Someone"} left`);
    room.on(RoomEvent.ParticipantConnected, joined).on(RoomEvent.ParticipantDisconnected, left);
    return () => {
      room.off(RoomEvent.ParticipantConnected, joined).off(RoomEvent.ParticipantDisconnected, left);
    };
  }, [room]);
  return toasts;
}

function useUnread(messages: { id: string; from?: Participant }[], open: boolean, me: string): number {
  const [seen, setSeen] = useState(0);
  const total = messages.length;
  // Adjusting state during render: everything is read while the chat is open.
  if (open && seen !== total) setSeen(total);
  if (open) return 0;
  return messages.slice(seen).filter((m) => m.from?.identity !== me).length;
}
