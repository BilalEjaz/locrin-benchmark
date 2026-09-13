import crypto from "crypto";

export function fingerprint(password: string): string {
  return crypto.createHash("md5").update(password).digest("hex");
}
