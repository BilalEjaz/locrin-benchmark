"use client";

import Link from "next/link";
import type { LobbySnapshot } from "@/lib/rooms";
import { Avatar } from "../Avatar";
import { Icon } from "../Icon";

export function LiveRooms({ snapshot, failed }: { snapshot: LobbySnapshot | null; failed: boolean }) {
  return (
    <section className="live" aria-labelledby="live-title" aria-busy={!snapshot}>
      <div className="live-head">
        <h2 id="live-title">Live now</h2>
        {failed ? <span className="form-error">Can&apos;t refresh the list. Retrying…</span> : null}
      </div>

      {!snapshot ? (
        <div className="room-list" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : snapshot.rooms.length === 0 ? (
        <div className="empty">
          <strong>No open rooms right now.</strong>
          <p>Start one and it shows up here for everyone. Private rooms stay off this list.</p>
        </div>
      ) : (
        <ul className="room-list">
          {snapshot.rooms.map((room) => (
            <li key={room.id} className="room-row">
              <h3>
                <Link className="full-link" href={`/r/${room.id}`}>
                  {room.title}
                </Link>
              </h3>
              <span className={room.count > 0 ? "count busy" : "count"}>
                {room.count > 0 ? `${room.count} inside` : "Empty"}
              </span>
              {room.topic ? <p className="topic">{room.topic}</p> : null}
              <div className="meta">
                <span>
                  <Icon name={room.kind === "voice" ? "wave" : "cam"} /> {room.kind === "voice" ? "Voice" : "Video"}
                </span>
                {room.people.length > 0 ? (
                  <span className="stack" aria-label={room.people.map((p) => p.name).join(", ")}>
                    {room.people.map((p, i) => (
                      <Avatar key={i} name={p.name} color={p.color} size="xs" />
                    ))}
                  </span>
                ) : (
                  <span>Be the first in</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
