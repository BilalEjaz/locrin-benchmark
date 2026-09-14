<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ __('Advanced Settings') }} — {{ config('v2board.app_name', 'V2Board') }}</title>
    <style>
        *, *::before, *::after { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f5f5f5; color: #333; }
        .wrap { max-width: 760px; margin: 32px auto; padding: 0 16px; }
        .card { background: #fff; border-radius: 8px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
        h1 { margin: 0 0 8px; font-size: 22px; }
        .muted { color: #888; font-size: 13px; }
        a { color: #1677ff; text-decoration: none; }
        .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; margin-top: 16px; }
        .tile { display: block; border: 1px solid #eee; border-radius: 8px; padding: 18px; transition: box-shadow .15s, border-color .15s; color: #333; }
        .tile:hover { border-color: #1677ff; box-shadow: 0 2px 10px rgba(22,119,255,.12); }
        .tile-title { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 600; margin-bottom: 6px; }
        .tile-title svg { flex: 0 0 auto; }
        .tile-desc { color: #888; font-size: 13px; line-height: 1.5; }
    </style>
</head>
<body>
<div class="wrap">
    <div class="card">
        <h1>{{ __('Advanced Settings') }}</h1>
        <p class="muted">{{ __('Out-of-panel admin tools. Pages added here appear automatically as links below.') }}</p>
        <p class="muted"><a href="{{ url('/' . $secure_path) }}">&larr; {{ __('Back to admin') }}</a></p>
    </div>

    <div class="card">
        <div class="tiles">
            <a class="tile" href="{{ url('/' . $secure_path . '/subscribe-rules') }}">
                <div class="tile-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1677ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    {{ __('Subscribe Rules') }}
                </div>
                <div class="tile-desc">{{ __('Manage VPN-bypass (DIRECT) rules pushed with subscriptions — Russia sites, extra domains.') }}</div>
            </a>
            <a class="tile" href="{{ url('/' . $secure_path . '/happ-crypto') }}">
                <div class="tile-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1677ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    {{ __('Happ Encrypted Link') }}
                </div>
                <div class="tile-desc">{{ __('Convert a user’s subscription URL into an encrypted happ:// deep link (local RSA-4096 crypt4, or remote crypt5).') }}</div>
            </a>
            <a class="tile" href="{{ url('/' . $secure_path . '/database') }}">
                <div class="tile-title">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1677ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
                    {{ __('Database Transfer') }}
                </div>
                <div class="tile-desc">{{ __('Export a full backup or restore the database from a previously exported file.') }}</div>
            </a>
        </div>
    </div>
</div>
</body>
</html>
