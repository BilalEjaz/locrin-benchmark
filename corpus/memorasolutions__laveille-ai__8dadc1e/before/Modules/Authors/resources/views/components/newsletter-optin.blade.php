@props([
    'author',
    'variant' => 'inline',
    'title' => null,
    'description' => null,
])

@php
    $authorName = $author->user?->name ?? $author->slug;
    $title ??= "Reçois les billets de {$authorName}";
    $description ??= 'Newsletter hebdo. Désabo 1-clic. Zéro spam.';
    $endpoint = '/auteur/' . $author->slug . '/newsletter/subscribe';
    $componentId = 'nlopt-' . $author->id;
    $turnstileSiteKey = \Modules\Authors\Services\TurnstileVerificationService::siteKey();
@endphp

@if($turnstileSiteKey)
    @once
        <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
    @endonce
@endif

<div
    x-data="{
        email: '',
        consent: true,
        state: 'idle',
        message: '',
        async submit() {
            if (!this.email.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
                this.state = 'error';
                this.message = 'Adresse courriel invalide.';
                return;
            }
            this.state = 'loading';
            const turnstileToken = this.$root.querySelector('[name=cf-turnstile-response]')?.value ?? '';
            try {
                const res = await fetch('{{ $endpoint }}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]')?.content ?? '' },
                    body: JSON.stringify({ email: this.email, consent: this.consent, website: '', 'cf-turnstile-response': turnstileToken })
                });
                if (res.ok) {
                    this.state = 'success';
                    this.message = 'Merci ! Vérifie ta boîte courriel pour confirmer.';
                    this.email = '';
                } else {
                    this.state = 'error';
                    this.message = 'Erreur. Réessaie dans un moment.';
                }
            } catch (e) {
                this.state = 'error';
                this.message = 'Erreur réseau. Réessaie.';
            }
        }
    }"
    class="lv-nlopt lv-nlopt--{{ $variant }}"
    role="form"
    aria-labelledby="{{ $componentId }}-title"
>
    <h3 id="{{ $componentId }}-title" class="lv-nlopt__title">{{ $title }}</h3>
    <p class="lv-nlopt__desc">{{ $description }}</p>

    <form @submit.prevent="submit" class="lv-nlopt__form" novalidate>
        <label for="{{ $componentId }}-email" class="sr-only">Adresse courriel</label>
        <input
            id="{{ $componentId }}-email"
            type="email"
            inputmode="email"
            autocomplete="email"
            required
            placeholder="toncourriel@exemple.com"
            x-model="email"
            class="lv-nlopt__input"
            :class="{ 'lv-nlopt__input--error': state === 'error' }"
            aria-describedby="{{ $componentId }}-status"
        >
        <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;">

        @if($turnstileSiteKey)
            <div class="cf-turnstile lv-nlopt__turnstile" data-sitekey="{{ $turnstileSiteKey }}" data-size="invisible" data-action="newsletter-subscribe"></div>
        @endif

        <button
            type="submit"
            class="lv-nlopt__btn"
            :disabled="state === 'loading'"
        >
            <span x-show="state !== 'loading'">S'abonner</span>
            <span x-show="state === 'loading'" x-cloak>Envoi…</span>
        </button>
    </form>

    <label class="lv-nlopt__consent">
        <input type="checkbox" x-model="consent">
        <span>J'accepte de recevoir ces courriels. <a href="/page/confidentialite" target="_blank" rel="noopener">Politique de confidentialité</a></span>
    </label>

    <div
        id="{{ $componentId }}-status"
        x-cloak
        x-show="state === 'success' || state === 'error'"
        x-transition
        class="lv-nlopt__msg"
        :class="{ 'lv-nlopt__msg--success': state === 'success', 'lv-nlopt__msg--error': state === 'error' }"
        role="alert"
        aria-live="polite"
        x-text="message"
    ></div>
</div>

<style>
.lv-nlopt { background: var(--c-primary-light, #F0FAFB); border: 1px solid rgba(11,114,133,0.12); border-radius: 1rem; padding: 24px; font-family: 'DM Sans', sans-serif; max-width: 520px; }
.lv-nlopt--footer { padding: 16px; }
.lv-nlopt--modal { background: transparent; border: 0; padding: 0; }
.lv-nlopt__title { font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 700; color: var(--c-primary, #0B7285); font-size: 1.125rem; margin: 0 0 4px 0; }
.lv-nlopt__desc { color: var(--c-text-muted, #52586a); font-size: 0.875rem; margin: 0 0 12px 0; }
.lv-nlopt__form { display: flex; gap: 8px; flex-wrap: wrap; }
.lv-nlopt__input { flex: 1; min-width: 200px; padding: 12px 14px; min-height: 44px; border: 1px solid #d1d5db; border-radius: 0.5rem; font-family: inherit; font-size: 0.9375rem; background: #fff; color: #1A1D23; }
.lv-nlopt__input:focus { outline: 3px solid var(--c-primary, #0B7285); outline-offset: 1px; border-color: var(--c-primary); }
.lv-nlopt__input--error { border-color: var(--c-accent, #C2410C); outline-color: var(--c-accent); }
.lv-nlopt__btn { padding: 12px 20px; min-height: 44px; background: var(--c-accent, #C2410C); color: #fff; border: 0; border-radius: 0.5rem; font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 600; font-size: 0.9375rem; cursor: pointer; transition: background 0.2s, transform 0.1s; }
.lv-nlopt__btn:hover:not(:disabled) { background: var(--c-accent-hover, #9A3412); transform: translateY(-1px); }
.lv-nlopt__btn:focus-visible { outline: 3px solid var(--c-primary, #0B7285); outline-offset: 2px; }
.lv-nlopt__btn:disabled { opacity: 0.6; cursor: not-allowed; }
.lv-nlopt__consent { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; font-size: 0.8125rem; color: var(--c-text-muted, #52586a); }
.lv-nlopt__consent input { margin-top: 2px; width: 24px; height: 24px; min-width: 24px; min-height: 24px; accent-color: var(--c-primary, #064E5A); cursor: pointer; }
.lv-nlopt__consent a { color: var(--c-primary, #064E5A); text-decoration: underline; }
.lv-nlopt__msg { margin-top: 12px; padding: 10px 12px; border-radius: 0.5rem; font-size: 0.875rem; }
.lv-nlopt__msg--success { background: #ECFDF5; color: #064E3B; border: 1px solid #6EE7B7; }
.lv-nlopt__msg--error { background: #FEF2F2; color: #7F1D1D; border: 1px solid #FCA5A5; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
</style>
