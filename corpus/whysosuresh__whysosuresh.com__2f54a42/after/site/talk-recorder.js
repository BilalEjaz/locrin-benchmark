// @ts-check
// The talk flow's device: the microphone, the bot check and the upload, behind the two calls talk.js
// makes. openMicrophone() records with the browser's own recorder and gives a level for the meter;
// send() gets a fresh token from Cloudflare's Turnstile and posts the recording to /api/talk.
// Turnstile's script is loaded from Cloudflare's exact address the first time someone presses Start, so
// nobody who never records loads it, and it is ready long before Send. Its widget is invisible and runs
// only at Send, because a token lasts 5 minutes and a recording plus listening back can outlast one.

/**
 * @typedef {{ blob: Blob, type: string, seconds: number }} Take
 * @typedef {{ level(): number, elapsed(): number, stop(): Promise<Take> }} Recording
 * @typedef {Take & { name: string, email: string }} Outgoing
 * @typedef {{
 *   render(container: HTMLElement, options: Record<string, unknown>): string,
 *   execute(widget: string): void,
 *   reset(widget: string): void,
 * }} Turnstile
 * @typedef {{ resolve(token: string): void, reject(error: Error): void }} Waiting
 * @typedef {{ id: string, waiting: Waiting | null }} Widget
 */

/** The production widget's public key; it works only on whysosuresh.com. */
const SITE_KEY = '0x4AAAAAAFy5WgjeTVHRB3R9';

/** Cloudflare's public test key for an invisible widget that always passes, for runs on this machine. */
const TEST_SITE_KEY = '1x00000000000000000000BB';

/** Turnstile's script, from the one address Cloudflare supports: never proxied, never copied. */
const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** The containers to record in, best first: Chrome and Firefox take the first, Safari the second. */
const TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Speech at this rate is clear, and three minutes stay far under the server's size limit. */
const BITS_PER_SECOND = 32000;

/** How long Send waits for a token before calling the send failed. */
const TOKEN_TIMEOUT_MS = 30000;

/**
 * @param {string} message
 * @param {string} reason
 */
function failure(message, reason) {
  return Object.assign(new Error(message), { reason });
}

function siteKey() {
  return ['localhost', '127.0.0.1'].includes(location.hostname) ? TEST_SITE_KEY : SITE_KEY;
}

/** @type {Promise<Turnstile> | null} */
let turnstileLoading = null;

/** Loads Turnstile's script once; a failed load is tried again at the next call. */
function loadTurnstile() {
  turnstileLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => {
      const turnstile = /** @type {{ turnstile?: Turnstile }} */ (/** @type {unknown} */ (window)).turnstile;
      if (turnstile) resolve(turnstile);
      else reject(new Error('Turnstile loaded without its API'));
    });
    script.addEventListener('error', () => {
      script.remove();
      turnstileLoading = null;
      reject(new Error("Turnstile's script did not load"));
    });
    document.head.append(script);
  });
  return turnstileLoading;
}

/** @type {Widget | null} */
let widget = null;

/**
 * A fresh token from the invisible widget, which is rendered once and run on each call.
 * @returns {Promise<string>}
 */
async function token() {
  const turnstile = await loadTurnstile();
  if (!widget) {
    const box = document.createElement('div');
    document.body.append(box);
    /** @type {Widget} */
    const state = { id: '', waiting: null };
    state.id = turnstile.render(box, {
      sitekey: siteKey(),
      action: 'talk',
      execution: 'execute',
      callback: (/** @type {string} */ value) => state.waiting?.resolve(value),
      'error-callback': () => {
        state.waiting?.reject(new Error('The bot check failed.'));
        return true;
      },
      'timeout-callback': () => state.waiting?.reject(new Error('The bot check timed out.')),
    });
    widget = state;
  }
  const current = widget;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The bot check took too long.')), TOKEN_TIMEOUT_MS);
    current.waiting = {
      resolve: (value) => {
        clearTimeout(timer);
        current.waiting = null;
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        current.waiting = null;
        reject(error);
      },
    };
    turnstile.execute(current.id);
  });
}

/** Clears the widget's last token, so the next send asks for a new one. */
function resetWidget() {
  const turnstile = /** @type {{ turnstile?: Turnstile }} */ (/** @type {unknown} */ (window)).turnstile;
  if (widget && turnstile) turnstile.reset(widget.id);
}

/**
 * Asks for the microphone and starts recording. Must be called from the press itself: the audio context
 * for the level meter is made before anything is awaited, which iPhone Safari requires.
 * @returns {Promise<Recording>}
 */
export async function openMicrophone() {
  loadTurnstile().catch(() => {
    // Send loads it again, and fails there if it still can't.
  });
  const type = typeof MediaRecorder === 'undefined' ? undefined : TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!type || !navigator.mediaDevices?.getUserMedia) throw failure("This browser can't record.", 'unsupported');

  const context = new AudioContext();
  void context.resume();
  /** @type {MediaStream} */
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    void context.close();
    const name = err instanceof DOMException ? err.name : '';
    throw failure('The microphone is not available.', name === 'NotFoundError' ? 'unsupported' : 'blocked');
  }

  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);

  const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: BITS_PER_SECOND });
  /** @type {Blob[]} */
  const chunks = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start(1000);
  const started = performance.now();
  let stoppedAt = 0;
  const elapsed = () => ((stoppedAt || performance.now()) - started) / 1000;

  /** @type {Promise<Take> | null} */
  let stopping = null;
  return {
    level() {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
    elapsed,
    stop() {
      stopping ??= new Promise((resolve) => {
        stoppedAt = stoppedAt || performance.now();
        const finish = () => {
          // Ending the tracks turns off the browser's microphone indicator.
          for (const track of stream.getTracks()) track.stop();
          void context.close();
          const recorded = recorder.mimeType || type;
          resolve({ blob: new Blob(chunks, { type: recorded }), type: recorded, seconds: elapsed() });
        };
        if (recorder.state === 'inactive') finish();
        else {
          recorder.addEventListener('stop', finish, { once: true });
          recorder.stop();
        }
      });
      return stopping;
    },
  };
}

/**
 * Sends a recording to Suresh. Fails with reason `limit` when today's limit is reached, and with a plain
 * failure for anything else, which keeps the recording on screen to send again.
 * @param {Outgoing} take
 * @returns {Promise<void>}
 */
export async function send(take) {
  /** @type {Response} */
  let response;
  try {
    const form = new FormData();
    form.append('audio', take.blob, 'recording');
    form.append('seconds', String(Math.max(1, Math.round(take.seconds))));
    form.append('name', take.name);
    form.append('email', take.email);
    form.append('token', await token());
    response = await fetch('/api/talk', { method: 'POST', body: form });
  } catch (err) {
    throw failure(err instanceof Error ? err.message : "That didn't send.", 'failed');
  } finally {
    resetWidget();
  }
  if (response.status === 429) throw failure("Today's limit is reached.", 'limit');
  if (response.status !== 201) throw failure("That didn't send.", 'failed');
}
