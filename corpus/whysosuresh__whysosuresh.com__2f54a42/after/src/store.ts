// Keeping a recording: the audio into the recordings' bucket at `talk/<id>`, then its row into the
// database. A recording is never kept without its row: if the row can't be written, the object is deleted.

export interface Received {
  audio: File;
  type: string;
  seconds: number;
  name: string;
  email: string;
}

/** Where a recording came from: the talk flow is the one door so far. */
const SOURCE = "talk";
/** A new recording's place in the inbox. */
const STATUS = "received";

export async function keep(db: D1Database, bucket: R2Bucket, received: Received): Promise<string> {
  const id = crypto.randomUUID();
  const key = `${SOURCE}/${id}`;
  await bucket.put(key, received.audio, { httpMetadata: { contentType: received.type } });
  try {
    await db
      .prepare(
        `INSERT INTO inputs (id, received_at, source, name, email, audio_key, audio_type, audio_bytes, duration_s, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        id,
        new Date().toISOString(),
        SOURCE,
        received.name === "" ? null : received.name,
        received.email === "" ? null : received.email,
        key,
        received.type,
        received.audio.size,
        received.seconds,
        STATUS,
      )
      .run();
  } catch (error) {
    await bucket.delete(key);
    throw error;
  }
  return id;
}
