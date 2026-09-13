// synthetic fixture, not a real credential
const webhookSecret = "601zao4dsmIcGYMewuGRyQcwmGCgpvDv";

export function signingKey(): string {
  return webhookSecret;
}
