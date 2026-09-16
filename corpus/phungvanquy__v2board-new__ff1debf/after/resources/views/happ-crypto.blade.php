<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ __('Happ Encrypted Link') }} — {{ config('v2board.app_name', 'V2Board') }}</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f5f5f5; color: #333; }
        .wrap { max-width: 760px; margin: 32px auto; padding: 0 16px; }
        .card { background: #fff; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
        h1 { margin: 0 0 8px; font-size: 22px; }
        h2 { margin: 0 0 12px; font-size: 16px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
        .muted { color: #888; font-size: 13px; }
        .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
        .form-row { display: flex; flex-direction: column; gap: 6px; margin: 16px 0; }
        .form-row label { font-weight: 600; font-size: 14px; }
        .hint { color: #888; font-size: 12px; }
        textarea { padding: 8px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; min-height: 88px; resize: vertical; }
        input[type=text], input[type=email], input[type=number] { padding: 8px 10px; border: 1px solid #d9d9d9; border-radius: 6px; font-size: 13px; }
        .inline { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        .inline input { flex: 1 1 auto; min-width: 180px; }
        .switch { display: flex; align-items: center; gap: 8px; font-weight: 400; font-size: 14px; }
        .switch input[type=checkbox] { width: 18px; height: 18px; }
        .seg { display: flex; gap: 8px; flex-wrap: wrap; }
        .seg label { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border: 1px solid #d9d9d9; border-radius: 6px; cursor: pointer; font-weight: 400; font-size: 13px; }
        .seg label.active { border-color: #1677ff; background: #e6f4ff; color: #1677ff; font-weight: 600; }
        .seg input { display: none; }
        .btn { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 14px; white-space: nowrap; }
        .btn-primary { background: #1677ff; color: #fff; }
        .btn-default { background: #fff; color: #333; border: 1px solid #d9d9d9; }
        .btn-ghost { background: #f5f5f5; color: #333; border: 1px solid #e8e8e8; }
        .btn:disabled { opacity: .5; cursor: not-allowed; }
        .alert { padding: 10px 14px; border-radius: 6px; font-size: 13px; margin: 10px 0; }
        .alert-error { background: #fff2f0; border: 1px solid #ffccc7; color: #a8071a; }
        .alert-success { background: #f6ffed; border: 1px solid #b7eb8f; color: #135200; }
        .alert-warn { background: #fffbe6; border: 1px solid #ffe58f; color: #614700; }
        .preview { background: #fafafa; border: 1px solid #eee; border-radius: 6px; padding: 10px 12px; font-size: 12px; font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; max-height: 320px; overflow: auto; }
        .tag { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 11px; margin-left: 6px; }
        .tag-local { background: #e6f4ff; color: #1677ff; border: 1px solid #91caff; }
        .tag-remote { background: #fff7e6; color: #d46b08; border: 1px solid #ffd591; }
        code { background: #f0f0f0; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
    </style>
</head>
<body>
<div class="wrap">
    <div class="card">
        <h1>{{ __('Happ Encrypted Link') }}</h1>
        <p class="muted">{{ __('Paste a user’s subscription URL (or look it up by email) → get its encrypted <code>happ://</code> deep link to hand to that user. Local <code>crypt4</code> = RSA-4096 in this app (nothing leaves the server). Remote <code>crypt5</code> = Happ’s official API.') }}</p>
        <p class="muted"><a href="{{ url('/' . $secure_path . '/advanced') }}">&larr; {{ __('Back to Advanced Settings') }}</a> · <a href="{{ url('/' . $secure_path) }}">{{ __('Admin') }}</a></p>
    </div>

    <div class="card">
        <h2>{{ __('Convert — paste a subscription URL') }}</h2>
        <div class="form-row">
            <label for="urlInput">{{ __('Subscription URL') }}</label>
            <textarea id="urlInput" placeholder="https://example.com/api/v1/client/subscribe?token=…"></textarea>
            <span class="hint">{{ __('Any link copied from the user list or from GET /api/v1/user/subscribe — one at a time.') }}</span>
        </div>

        <div class="form-row">
            <label>{{ __('Link type') }}</label>
            <div class="seg" id="modeSeg">
                <label data-mode="local"><input type="radio" name="mode" value="local" checked><span>{{ __('Local crypt4') }}</span></label>
                <label data-mode="remote"><input type="radio" name="mode" value="remote"><span>{{ __('Remote crypt5 (crypto.happ.su)') }}</span></label>
                <label data-mode="auto"><input type="radio" name="mode" value="auto"><span>{{ __('Use saved default') }}</span></label>
            </div>
            <span class="hint">
                {{ __('Local crypt4: RSA-4096 in this app — private, works in current Happ versions.') }}<br>
                {{ __('Remote crypt5: calls crypto.happ.su (sends the URL off-site) — use if your Happ build only accepts crypt5.') }}<br>
                {{ __('"Use saved default" picks the default saved below. Changing the default invalidates cached links, so results never go stale.') }}
            </span>
        </div>

        <div class="row">
            <button class="btn btn-primary" id="encryptBtn">{{ __('Encrypt') }}</button>
            <button class="btn btn-ghost" id="clearBtn">{{ __('Clear') }}</button>
            <span class="hint" id="modeTag"></span>
        </div>

        <div class="form-row">
            <label>{{ __('Or: lookup by user email') }}</label>
            <div class="inline">
                <input type="email" id="emailInput" placeholder="user@example.com">
                <button class="btn btn-default" id="lookupBtn">{{ __('Fill link for email') }}</button>
            </div>
            <span class="hint">{{ __('Fills the textarea above with that user’s current plain subscription URL.') }}</span>
        </div>

        <div class="form-row">
            <label>{{ __('Encrypted result') }}</label>
            <div class="preview" id="convertPreview" style="min-height:56px">—</div>
            <span class="hint">{{ __('Paste this happ:// line into Happ (Add via link / clipboard). It hides the https:// address from the user.') }}</span>
        </div>
        <div class="row">
            <button class="btn btn-default" id="copyBtn" disabled>{{ __('Copy encrypted link') }}</button>
            <span class="hint" id="copyHint"></span>
        </div>
        <div id="convertAlert"></div>
    </div>

    <div class="card">
        <h2>{{ __('Converter defaults') }}</h2>
        <p class="muted">{{ __('These are the settings the converter above uses. The link is generated on demand by you — nothing is added to the user API.') }}</p>

        <div class="form-row">
            <label>{{ __('Default link type') }}</label>
            <div class="seg" id="defaultModeSeg">
                <label data-mode="local"><input type="radio" name="defaultMode" value="local" checked><span>{{ __('Local crypt4') }}</span></label>
                <label data-mode="remote"><input type="radio" name="defaultMode" value="remote"><span>{{ __('Remote crypt5') }}</span></label>
            </div>
            <span class="hint">{{ __('Used when the converter is set to "Use saved default".') }}</span>
        </div>

        <div class="form-row">
            <label for="pem">{{ __('RSA-4096 public key (PEM) — optional override') }}</label>
            <textarea id="pem" placeholder="{{ __('Leave empty to use the bundled Happ crypt4 key.') }}"></textarea>
            <span class="hint">{{ __('Paste a new "-----BEGIN PUBLIC KEY-----" block only if Happ rotates its key.') }}</span>
        </div>

        <div class="form-row" style="max-width:280px">
            <label for="ttl">{{ __('Cache TTL (seconds)') }}</label>
            <input type="number" id="ttl" min="60" max="86400" step="60" value="3600">
            <span class="hint">{{ __('RSA is randomized, so links are cached per URL. Saving these settings clears the cache.') }}</span>
        </div>

        <div class="row">
            <button class="btn btn-primary" id="saveBtn">{{ __('Save defaults') }}</button>
            <span id="saveMsg" class="muted"></span>
        </div>
        <div id="settingsAlert"></div>
    </div>
</div>
<script>
const SECURE = @json($secure_path);
function getAuth() {
    try { const v = localStorage.getItem('authorization') || ''; if (v) return v; } catch(e) {}
    const m = document.cookie.match(/(?:^|;\s*)auth_data=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : '';
}
function showMsg(id, text, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = kind ? ('alert alert-' + kind) : 'muted';
}
function api(path, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    const auth = getAuth();
    if (auth) { opts.headers['authorization'] = auth; opts.headers['Authorization'] = auth; }
    const sep = path.indexOf('?') === -1 ? '?' : '&';
    const url = '/api/v1/' + SECURE + path + (auth ? sep + 'auth_data=' + encodeURIComponent(auth) : '');
    return fetch(url, opts);
}
function bindSeg(containerId) {
    const box = document.getElementById(containerId);
    function refresh() {
        box.querySelectorAll('label').forEach(l => l.classList.toggle('active', l.querySelector('input').checked));
    }
    box.querySelectorAll('input').forEach(i => i.addEventListener('change', refresh));
    refresh();
    return { get: () => { const c = box.querySelector('input:checked'); return c ? c.value : null; }, set: (v) => { const el = box.querySelector('input[value="'+v+'"]'); if (el) { el.checked = true; refresh(); } } };
}
const modeCtl = bindSeg('modeSeg');
const defaultModeCtl = bindSeg('defaultModeSeg');
let lastHapp = '';
let defaultMode = 'local';
function setConvertResult(happ, mode) {
    lastHapp = happ || '';
    const el = document.getElementById('convertPreview');
    const copyBtn = document.getElementById('copyBtn');
    const tag = document.getElementById('modeTag');
    if (happ) {
        el.textContent = happ;
        copyBtn.disabled = false;
        if (mode) {
            tag.innerHTML = 'produced: <span class="tag ' + (mode === 'local' ? 'tag-local' : 'tag-remote') + '">' + (mode === 'local' ? 'crypt4 (local RSA)' : 'crypt5 (remote)') + '</span>';
        } else {
            tag.textContent = '';
        }
    } else {
        copyBtn.disabled = true;
        tag.textContent = '';
    }
}
function load() {
    api('/happ-crypto/fetch').then(r=>r.json()).then(j=>{
        const d = (j && j.data) || {};
        document.getElementById('pem').value = d.happ_crypto_public_key || '';
        document.getElementById('ttl').value = d.happ_crypto_cache_ttl || 3600;
        defaultMode = d.default_mode || 'local';
        defaultModeCtl.set(defaultMode);
    }).catch(e=>{
        showMsg('settingsAlert', e.message || 'Failed to load settings.', 'error');
    });
}
document.getElementById('encryptBtn').addEventListener('click', function() {
    const url = (document.getElementById('urlInput').value || '').trim();
    if (!url) { showMsg('convertAlert', 'Paste a subscription URL first.', 'error'); return; }
    if (!/^https?:\/\//i.test(url)) { showMsg('convertAlert', 'URL must start with https:// or http://', 'error'); return; }
    const btn = this;
    btn.disabled = true;
    showMsg('convertAlert', '', '');
    document.getElementById('convertPreview').textContent = 'Encrypting…';
    const chosen = modeCtl.get();
    api('/happ-crypto/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url, mode: (chosen === 'auto' || !chosen) ? undefined : chosen })
    }).then(r=>r.json().then(j=>({r,j}))).then(({r,j})=>{
        if (!r.ok) throw new Error((j && j.message) || 'Encrypt failed ('+r.status+')');
        const d = (j && j.data) || {};
        setConvertResult(d.happ || '', d.mode || '');
    }).catch(e=>{
        setConvertResult('', '');
        document.getElementById('convertPreview').textContent = '—';
        showMsg('convertAlert', e.message || 'Encrypt failed.', 'error');
    }).finally(()=>{ btn.disabled=false; });
});
document.getElementById('clearBtn').addEventListener('click', function() {
    document.getElementById('urlInput').value = '';
    setConvertResult('', '');
    document.getElementById('convertPreview').textContent = '—';
    showMsg('convertAlert', '', '');
});
document.getElementById('lookupBtn').addEventListener('click', function() {
    const email = (document.getElementById('emailInput').value || '').trim();
    if (!email) { showMsg('convertAlert', 'Enter a user email first.', 'error'); return; }
    const btn = this;
    btn.disabled = true;
    showMsg('convertAlert', '', '');
    api('/happ-crypto/lookup?email=' + encodeURIComponent(email)).then(r=>r.json().then(j=>({r,j}))).then(({r,j})=>{
        if (!r.ok) throw new Error((j && j.message) || 'Lookup failed ('+r.status+')');
        const plain = (j && j.data && j.data.plain) || '';
        if (!plain) throw new Error('Empty subscription URL for that user.');
        document.getElementById('urlInput').value = plain;
        setConvertResult('', '');
        document.getElementById('convertPreview').textContent = '—';
        showMsg('convertAlert', 'Loaded — press Encrypt to convert it.', 'success');
    }).catch(e=>{
        showMsg('convertAlert', e.message || 'Lookup failed.', 'error');
    }).finally(()=>{ btn.disabled=false; });
});
document.getElementById('copyBtn').addEventListener('click', function() {
    if (!lastHapp) return;
    const hint = document.getElementById('copyHint');
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastHapp).then(()=>{ hint.textContent='Copied.'; setTimeout(()=>hint.textContent='', 2000); });
    } else {
        const ta = document.createElement('textarea');
        ta.value = lastHapp; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); hint.textContent='Copied.'; } catch(e){ hint.textContent='Copy failed — select the text above manually.'; }
        document.body.removeChild(ta);
        setTimeout(()=>hint.textContent='', 3000);
    }
});
document.getElementById('saveBtn').addEventListener('click', function() {
    const btn = this;
    btn.disabled = true;
    showMsg('saveMsg', 'Saving…', '');
    showMsg('settingsAlert', '', '');
    const useRemote = defaultModeCtl.get() === 'remote' ? 1 : 0;
    api('/happ-crypto/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            happ_crypto_use_remote: useRemote,
            happ_crypto_public_key: document.getElementById('pem').value || '',
            happ_crypto_cache_ttl: parseInt(document.getElementById('ttl').value, 10) || 3600
        })
    }).then(r=>r.json().then(j=>({r,j}))).then(({r,j})=>{
        if (!r.ok) throw new Error((j && j.message) || 'Save failed ('+r.status+')');
        defaultMode = (j && j.data && j.data.default_mode) || (useRemote ? 'remote' : 'local');
        showMsg('saveMsg', 'Saved — cache cleared.', 'success');
    }).catch(e=>{
        showMsg('settingsAlert', e.message || 'Save failed.', 'error');
        showMsg('saveMsg', '', '');
    }).finally(()=>{ btn.disabled=false; });
});
load();
</script>
</body>
</html>
