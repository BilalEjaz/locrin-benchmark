/**
 * The Google callback is a browser navigation, so it can't return JSON — it redirects
 * with a short code and the sign-in pages turn it back into a sentence here.
 */
const MESSAGES: Record<string, string> = {
  "google-cancelled": "Google sign-in was cancelled.",
  "google-state": "That sign-in link expired. Try again.",
  "google-failed": "Google couldn't complete the sign-in. Try again in a moment.",
  "google-email": "Google didn't give us a verified email address for that account.",
  "google-exists":
    "An account already uses that email address. Log in with your password, then connect Google from your profile.",
  "google-username": "We couldn't find a free username for that account. Sign up with the form instead.",
  "google-session": "Your session expired. Log in again, then connect Google.",
  "google-taken": "That Google account is already connected to a different StreakArena account.",
};

export function authErrorMessage(code: string | null): string {
  if (!code) return "";
  return MESSAGES[code] ?? "Something went wrong signing in.";
}
