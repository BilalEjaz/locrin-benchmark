// @ts-check
// The talk flow behind every "Talk to me" button: a native dialog that walks a visitor from
// pressing the button to a thank-you, through recording (up to 3 minutes), listening back and an
// optional name and email. It also owns the screens for a blocked microphone, a browser that
// cannot record, today's limit and a send that failed. The microphone, the bot check and the upload
// sit behind talk-recorder.js's two calls; this file never touches any of them. Opening the page at
// #talk opens the flow, so a video description can link straight to it, and so can a page that
// shows no button yet.

import { openMicrophone, send } from './talk-recorder.js';

/** The longest recording, in seconds; the server enforces it too. */
const CAP_SECONDS = 180;

/** Minute marks and the last-30-seconds warning, announced once each to screen readers. */
const ANNOUNCE_AT = [60, 120, 150];

/**
 * @typedef {'ready' | 'asking' | 'recording' | 'review' | 'sending' | 'thanks'
 *   | 'blocked' | 'unsupported' | 'limit'} State
 * @typedef {{ level(): number, elapsed(): number, stop(): Promise<Take> }} Recording
 * @typedef {{ blob: Blob, type: string, seconds: number }} Take
 */

const PRIVACY =
  "Your recording goes to Suresh. An AI writes out the words so he can read them. It's deleted once he's dealt with it. Your email is used only to reply to you.";

const SHEET = `
  <div class="talk-sheet">
    <div class="sheet-top">
      <span class="sheet-name">Talk to Suresh</span>
      <button type="button" class="close-button" data-close aria-label="Close">&times;</button>
    </div>
    <p class="visually-hidden" aria-live="polite" data-live></p>

    <section class="state" data-state="ready" aria-labelledby="talk-h-ready">
      <h2 id="talk-h-ready" tabindex="-1">Say what's on your mind</h2>
      <p>Up to 3 minutes, in any language. You can listen back before you send it.</p>
      <button type="button" class="talk-button big" data-start>${micIcon()}Start recording</button>
      <p class="fine">Your browser will ask to use the microphone.</p>
    </section>

    <section class="state" data-state="asking" aria-labelledby="talk-h-asking" hidden>
      <h2 id="talk-h-asking" tabindex="-1">Allow the microphone</h2>
      <p>Your browser is asking to use your microphone. Choose Allow, and the recording starts.</p>
    </section>

    <section class="state" data-state="recording" aria-labelledby="talk-h-recording" hidden>
      <h2 id="talk-h-recording" tabindex="-1" class="rec-dot">Recording</h2>
      <div class="clock" role="timer" aria-hidden="true"><span data-clock>0:00</span> <span class="cap">of 3:00</span></div>
      <div class="level" aria-hidden="true"><span data-level></span></div>
      <button type="button" class="talk-button big" data-stop>${stopIcon()}Stop</button>
      <p class="fine">It stops by itself at 3 minutes.</p>
    </section>

    <section class="state" data-state="review" aria-labelledby="talk-h-review" hidden>
      <h2 id="talk-h-review" tabindex="-1">Listen back</h2>
      <p class="notice" data-capped hidden>You reached 3 minutes, so the recording stopped there.</p>
      <p class="notice" data-failed hidden>That didn't send. Check your connection and press Send again; your recording is still here.</p>
      <audio controls preload="metadata" data-audio></audio>
      <p class="fine"><span data-length></span> recorded. <button type="button" class="text-button" data-again>Record again</button></p>
      <form class="state" data-form novalidate>
        <div class="field">
          <label for="talk-name">Your name <span class="hint">(optional)</span></label>
          <input id="talk-name" name="name" autocomplete="name" maxlength="80">
        </div>
        <div class="field">
          <label for="talk-email">Your email <span class="hint">(optional: leave it if you'd like to hear back)</span></label>
          <input id="talk-email" name="email" type="email" autocomplete="email" maxlength="200" aria-describedby="talk-email-error">
          <p id="talk-email-error" class="fine" data-email-error hidden>That email doesn't look complete. Fix it, or leave it empty.</p>
        </div>
        <p class="fine">${PRIVACY}</p>
        <button type="submit" class="talk-button big" data-send>Send to Suresh</button>
      </form>
    </section>

    <section class="state" data-state="sending" aria-labelledby="talk-h-sending" hidden>
      <h2 id="talk-h-sending" tabindex="-1">Sending</h2>
      <p>This takes a few seconds.</p>
    </section>

    <section class="state" data-state="thanks" aria-labelledby="talk-h-thanks" hidden>
      <h2 id="talk-h-thanks" tabindex="-1">Thank you</h2>
      <p data-thanks-line></p>
      <div class="actions">
        <button type="button" class="ghost-button" data-close>Close</button>
        <a class="text-button" href="/feedback">How Suresh handles feedback and ideas</a>
      </div>
    </section>

    <section class="state" data-state="blocked" aria-labelledby="talk-h-blocked" hidden>
      <h2 id="talk-h-blocked" tabindex="-1">The microphone is blocked</h2>
      <p>Your browser said no to the microphone. Allow it for this site, then try again.</p>
      <ul>
        <li><strong>Chrome:</strong> click the icon left of the address, turn Microphone on, then reload.</li>
        <li><strong>Safari on iPhone:</strong> tap <strong>aA</strong> in the address bar, then Website Settings, then Microphone: Allow.</li>
        <li><strong>Safari on a Mac:</strong> Safari menu, Settings for this website, Microphone: Allow.</li>
      </ul>
      <button type="button" class="ghost-button big" data-start>Try again</button>
    </section>

    <section class="state" data-state="unsupported" aria-labelledby="talk-h-unsupported" hidden>
      <h2 id="talk-h-unsupported" tabindex="-1">This browser can't record</h2>
      <p>Open whysosuresh.com in an up-to-date Chrome or Safari and try again.</p>
    </section>

    <section class="state" data-state="limit" aria-labelledby="talk-h-limit" hidden>
      <h2 id="talk-h-limit" tabindex="-1">Lots of people talked to Suresh today</h2>
      <p>Try again tomorrow. Your recording wasn't sent.</p>
      <button type="button" class="ghost-button big" data-close>Close</button>
    </section>
  </div>`;

/** @returns {string} */
function micIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
}

/** @returns {string} */
function stopIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>';
}

/** @param {number} seconds */
function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** @param {number} seconds */
function spoken(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  if (r || !m) parts.push(`${r} second${r === 1 ? '' : 's'}`);
  return parts.join(' ');
}

/**
 * @template {Element} T
 * @param {ParentNode} root
 * @param {string} selector
 * @param {new () => T} kind
 * @returns {T}
 */
function find(root, selector, kind) {
  const el = root.querySelector(selector);
  if (!(el instanceof kind)) throw new Error(`talk: missing ${selector}`);
  return el;
}

/** @param {unknown} err */
function reasonOf(err) {
  return err instanceof Error && 'reason' in err ? String(err.reason) : 'failed';
}

class TalkFlow {
  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'talk-dialog';
    this.dialog.setAttribute('aria-label', 'Talk to Suresh');
    this.dialog.innerHTML = SHEET;
    document.body.append(this.dialog);

    /** @type {State} */
    this.state = 'ready';
    /** @type {Recording | null} */
    this.recording = null;
    /** @type {Take | null} */
    this.take = null;
    /** @type {string | null} */
    this.audioUrl = null;
    /** @type {Set<number>} */
    this.announced = new Set();
    this.frame = 0;
    this.stillMotion = matchMedia('(prefers-reduced-motion: reduce)');

    this.live = find(this.dialog, '[data-live]', HTMLElement);
    this.clockEl = find(this.dialog, '[data-clock]', HTMLElement);
    this.levelEl = find(this.dialog, '[data-level]', HTMLElement);
    this.audio = find(this.dialog, '[data-audio]', HTMLAudioElement);
    this.form = find(this.dialog, '[data-form]', HTMLFormElement);
    this.nameInput = find(this.dialog, '#talk-name', HTMLInputElement);
    this.emailInput = find(this.dialog, '#talk-email', HTMLInputElement);

    this.dialog.addEventListener('click', (event) => this.onClick(event));
    this.dialog.addEventListener('cancel', (event) => {
      if (this.state === 'sending') event.preventDefault();
    });
    this.dialog.addEventListener('close', () => this.reset());
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.sendTake();
    });
  }

  open() {
    if (this.dialog.open) return;
    this.show('ready');
    this.dialog.showModal();
    this.focusHeading();
  }

  /** @param {MouseEvent} event */
  onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target === this.dialog) {
      // A click on the backdrop closes the sheet, except while a send is on its way.
      if (this.state !== 'sending' && this.state !== 'recording') this.dialog.close();
      return;
    }
    if (target.closest('[data-close]') && this.state !== 'sending') this.dialog.close();
    else if (target.closest('[data-start]')) void this.start();
    else if (target.closest('[data-stop]')) void this.stop(false);
    else if (target.closest('[data-again]')) {
      this.discardTake();
      void this.start();
    }
  }

  /** @param {State} state */
  show(state) {
    this.state = state;
    for (const section of this.dialog.querySelectorAll('[data-state]')) {
      if (section instanceof HTMLElement) section.hidden = section.dataset.state !== state;
    }
    if (this.dialog.open) this.focusHeading();
  }

  focusHeading() {
    const heading = this.dialog.querySelector(`[data-state="${this.state}"] h2`);
    if (heading instanceof HTMLElement) heading.focus();
  }

  /** @param {string} text */
  announce(text) {
    this.live.textContent = text;
  }

  async start() {
    this.show('asking');
    try {
      this.recording = await openMicrophone();
    } catch (err) {
      this.show(reasonOf(err) === 'unsupported' ? 'unsupported' : 'blocked');
      return;
    }
    if (!this.dialog.open) {
      await this.recording.stop();
      this.recording = null;
      return;
    }
    this.announced.clear();
    this.clockEl.textContent = '0:00';
    this.show('recording');
    this.announce('Recording. Press Stop when you are done.');
    this.tick();
  }

  tick() {
    const recording = this.recording;
    if (!recording) return;
    const elapsed = recording.elapsed();
    this.clockEl.textContent = clock(Math.min(elapsed, CAP_SECONDS));
    if (!this.stillMotion.matches) {
      this.levelEl.style.transform = `scaleX(${Math.max(0.04, Math.min(1, recording.level()))})`;
    }
    for (const mark of ANNOUNCE_AT) {
      if (elapsed >= mark && !this.announced.has(mark)) {
        this.announced.add(mark);
        this.announce(mark === 150 ? '30 seconds left.' : `${mark / 60} minute${mark === 60 ? '' : 's'} recorded.`);
      }
    }
    if (elapsed >= CAP_SECONDS) {
      void this.stop(true);
      return;
    }
    this.frame = requestAnimationFrame(() => this.tick());
  }

  /** @param {boolean} capped */
  async stop(capped) {
    const recording = this.recording;
    if (!recording) return;
    this.recording = null;
    cancelAnimationFrame(this.frame);
    const take = await recording.stop();
    this.take = { ...take, seconds: Math.min(take.seconds, CAP_SECONDS) };
    this.audioUrl = URL.createObjectURL(take.blob);
    this.audio.src = this.audioUrl;
    find(this.dialog, '[data-length]', HTMLElement).textContent = clock(this.take.seconds);
    find(this.dialog, '[data-capped]', HTMLElement).hidden = !capped;
    find(this.dialog, '[data-failed]', HTMLElement).hidden = true;
    this.show('review');
    this.announce(capped ? 'Three minutes reached. The recording stopped.' : `Recorded ${spoken(this.take.seconds)}.`);
  }

  async sendTake() {
    const take = this.take;
    if (!take) return;
    const email = this.emailInput.value.trim();
    const emailError = find(this.dialog, '[data-email-error]', HTMLElement);
    const emailOk = email === '' || this.emailInput.checkValidity();
    emailError.hidden = emailOk;
    this.emailInput.setAttribute('aria-invalid', String(!emailOk));
    if (!emailOk) {
      this.emailInput.focus();
      return;
    }
    const name = this.nameInput.value.trim();
    this.audio.pause();
    this.show('sending');
    try {
      await send({ ...take, name, email });
    } catch (err) {
      if (reasonOf(err) === 'limit') {
        this.discardTake();
        this.show('limit');
      } else {
        find(this.dialog, '[data-failed]', HTMLElement).hidden = false;
        this.show('review');
      }
      return;
    }
    const greeting = name ? `Thanks, ${name}. ` : '';
    find(this.dialog, '[data-thanks-line]', HTMLElement).textContent = email
      ? `${greeting}Suresh will listen to it, and he'll write to you at ${email}.`
      : `${greeting}Suresh will listen to it. You didn't leave an email, so he can't write back, and that's fine.`;
    this.discardTake();
    this.form.reset();
    this.show('thanks');
  }

  discardTake() {
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
    this.take = null;
  }

  reset() {
    cancelAnimationFrame(this.frame);
    const recording = this.recording;
    this.recording = null;
    if (recording) void recording.stop();
    this.discardTake();
    this.show('ready');
    if (location.hash === '#talk') {
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        // Some frames refuse history changes; the hash then stays, which is harmless.
      }
    }
  }
}

/** @type {TalkFlow | null} */
let flow = null;

function openTalk() {
  flow ??= new TalkFlow();
  flow.open();
}

for (const button of document.querySelectorAll('[data-talk]')) {
  button.addEventListener('click', (event) => {
    event.preventDefault();
    openTalk();
  });
}

function openFromHash() {
  if (location.hash === '#talk') openTalk();
}
window.addEventListener('hashchange', openFromHash);
openFromHash();
