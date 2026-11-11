// What a recording may be: the three containers browsers record speech in, each told by its first bytes,
// and the size that bounds three minutes. The server can't hear the audio (decoding it would cost more
// CPU than a request is given), so it bounds bytes and checks that the bytes are the type they claim.

/** The largest recording: 3 minutes at about 178 kbit/s, above anything a phone's speech recorder writes. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

/** Room in the request for the form's text fields and the multipart framing, beyond the audio. */
export const FORM_OVERHEAD_BYTES = 16 * 1024;

/** The longest recording, in whole seconds; the browser stops there too. */
export const MAX_SECONDS = 180;

/** A declared type: one of the three bases, with parameters such as `codecs=opus` allowed. */
const TYPE_SHAPE = /^audio\/(webm|mp4|ogg)(\s*;\s*[a-z0-9-]{1,30}=("[^"\r\n]{0,80}"|[a-z0-9.+-]{1,80}))*$/i;

type Base = "webm" | "mp4" | "ogg";

/** The base container a declared type names, or null when the type isn't one this site takes. */
export function baseOf(type: string): Base | null {
  if (type.length > 200) return null;
  const match = TYPE_SHAPE.exec(type);
  return match ? (match[1]?.toLowerCase() as Base) : null;
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** Whether a file's first bytes are the container its type names. */
export function bytesMatch(base: Base, head: Uint8Array): boolean {
  const at = (offset: number, expected: number[]): boolean => expected.every((byte, i) => head[offset + i] === byte);
  switch (base) {
    case "webm":
      return at(0, [0x1a, 0x45, 0xdf, 0xa3]); // EBML
    case "mp4":
      return at(4, ascii("ftyp"));
    case "ogg":
      return at(0, ascii("OggS"));
  }
}
