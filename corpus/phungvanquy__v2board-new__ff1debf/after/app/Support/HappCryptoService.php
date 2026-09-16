<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Cache;

class HappCryptoService
{
    public const MODE_LOCAL = 'local';     // happ://crypt4/ (RSA-4096, public key)

    public const MODE_REMOTE = 'remote';   // happ://crypt5/ (crypto.happ.su, key not public)

    public const PREFIX_CRYPT4 = 'happ://crypt4/';

    /**
     * Happ RSA-4096 public key used for happ://crypt4/ (@kastov/cryptohapp HAPP_CRYPTO_V4).
     * Override via v2board.happ_crypto_public_key if Happ rotates the key.
     */
    public const DEFAULT_PEM = <<<'PEM'
-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA3UZ0M3L4K+WjM3vkbQnz
ozHg/cRbEXvQ6i4A8RVN4OM3rK9kU01FdjyoIgywve8OEKsFnVwERZAQZ1Trv60B
hmaM76QQEE+EUlIOL9EpwKWGtTL5lYC1sT9XJMNP3/CI0gP5wwQI88cY/xedpOEB
W72EmOOShHUm/b/3m+HPmqwc4ugKj5zWV5SyiT829aFA5DxSjmIIFBAms7DafmSq
LFTYIQL5cShDY2u+/sqyAw9yZIOoqW2TFIgIHhLPWek/ocDU7zyOrlu1E0SmcQQb
LFqHq02fsnH6IcqTv3N5Adb/CkZDDQ6HvQVBmqbKZKf7ZdXkqsc/Zw27xhG7OfXC
tUmWsiL7zA+KoTd3avyOh93Q9ju4UQsHthL3Gs4vECYOCS9dsXXSHEY/1ngU/hjO
WFF8QEE/rYV6nA4PTyUvo5RsctSQL/9DJX7XNh3zngvif8LsCN2MPvx6X+zLouBX
zgBkQ9DFfZAGLWf9TR7KVjZC/3NsuUCDoAOcpmN8pENBbeB0puiKMMWSvll36+2M
YR1Xs0MgT8Y9TwhE2+TnnTJOhzmHi/BxiUlY/w2E0s4ax9GHAmX0wyF4zeV7kDkc
vHuEdc0d7vDmdw0oqCqWj0Xwq86HfORu6tm1A8uRATjb4SzjTKclKuoElVAVa5Jo
oh/uZMozC65SmDw+N5p6Su8CAwEAAQ==
-----END PUBLIC KEY-----
PEM;

    /**
     * Max plaintext length for RSA-4096 + PKCS#1 v1.5 (501 bytes).
     */
    public const MAX_LOCAL_PLAIN = 501;

    /**
     * Encrypt a plain subscription URL.
     *
     * @param string      $plainUrl
     * @param string|null $mode     MODE_LOCAL (crypt4) | MODE_REMOTE (crypt5) | null = resolve from settings
     *
     * @return array{link: string, mode: string}|null  null only on failure
     */
    public static function encrypt(string $plainUrl, ?string $mode = null): ?array
    {
        $plainUrl = trim($plainUrl);
        if ($plainUrl === '') {
            return null;
        }

        $mode = $mode ?? self::configuredMode();
        $cacheKey = self::cacheKey($plainUrl, $mode);

        $cached = Cache::get($cacheKey);
        if (is_array($cached) && isset($cached['link'], $cached['mode'])) {
            return $cached;
        }

        $result = $mode === self::MODE_REMOTE
            ? self::encryptRemote($plainUrl)
            : self::encryptLocal($plainUrl);

        if ($result === null) {
            return null;
        }

        $ttl = self::ttl();
        Cache::put($cacheKey, $result, $ttl);

        return $result;
    }

    /**
     * Convenience for callers that only need the link string.
     */
    public static function encryptLink(string $plainUrl, ?string $mode = null): ?string
    {
        $r = self::encrypt($plainUrl, $mode);

        return $r['link'] ?? null;
    }

    public static function configuredMode(): string
    {
        return (int) config('v2board.happ_crypto_use_remote', 0) === 1
            ? self::MODE_REMOTE
            : self::MODE_LOCAL;
    }

    public static function forgetForUrl(string $plainUrl): void
    {
        foreach ([self::MODE_LOCAL, self::MODE_REMOTE] as $m) {
            Cache::forget(self::cacheKey(trim($plainUrl), $m));
        }
    }

    private static function cacheKey(string $plainUrl, string $mode): string
    {
        // Version component changes on every settings save (see bumpCacheVersion()),
        // so stored links from a previous key/mode setup are never served stale.
        $version = (int) config('v2board.happ_crypto_cache_version', 0);

        return 'happ_crypt_' . $version . '_' . $mode . '_' . md5($plainUrl);
    }

    /**
     * Invalidate all stored encrypted links (call after key/mode settings change).
     */
    public static function bumpCacheVersion(): void
    {
        $config = config('v2board');
        $config['happ_crypto_cache_version'] = time();
        $exported = var_export($config, true);
        $path = base_path('config/v2board.php');
        if (\Illuminate\Support\Facades\File::put($path, "<?php\n return {$exported} ;") !== false) {
            if (function_exists('opcache_reset')) {
                @opcache_reset();
            }
            \Illuminate\Support\Facades\Artisan::call('config:cache');
        }
    }

    private static function ttl(): int
    {
        $ttl = (int) config('v2board.happ_crypto_cache_ttl', 3600);
        if ($ttl < 60) {
            $ttl = 60;
        }
        if ($ttl > 86400) {
            $ttl = 86400;
        }

        return $ttl;
    }

    private static function pem(): string
    {
        $configured = trim((string) config('v2board.happ_crypto_public_key', ''));
        if ($configured !== '' && str_contains($configured, 'BEGIN PUBLIC KEY')) {
            return $configured;
        }

        return self::DEFAULT_PEM;
    }

    private static function encryptLocal(string $plainUrl): ?array
    {
        if (strlen($plainUrl) > self::MAX_LOCAL_PLAIN) {
            return null;
        }
        if (!function_exists('openssl_public_encrypt') || !function_exists('openssl_get_publickey')) {
            return null;
        }
        $key = openssl_get_publickey(self::pem());
        if ($key === false) {
            return null;
        }
        $ok = openssl_public_encrypt($plainUrl, $cipher, $key, OPENSSL_PKCS1_PADDING);
        if (function_exists('openssl_free_key')) {
            @openssl_free_key($key);
        }
        if (!$ok || $cipher === '') {
            return null;
        }

        return [
            'link' => self::PREFIX_CRYPT4 . base64_encode($cipher),
            'mode' => self::MODE_LOCAL,
        ];
    }

    /**
     * POST to crypto.happ.su/api-v2.php → happ://crypt5/…
     * Sends the token-bearing URL to a third party; only used when explicitly selected.
     */
    private static function encryptRemote(string $plainUrl): ?array
    {
        $payload = json_encode(['url' => $plainUrl], JSON_UNESCAPED_SLASHES);
        if ($payload === false) {
            return null;
        }
        $ctx = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nAccept: application/json\r\n",
                'content' => $payload,
                'timeout' => 6,
                'ignore_errors' => true,
            ],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $raw = @file_get_contents('https://crypto.happ.su/api-v2.php', false, $ctx);
        if ($raw === false || $raw === '') {
            return null;
        }
        $link = null;
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            foreach (['encrypted_link', 'result', 'link', 'url', 'data'] as $k) {
                if (isset($decoded[$k]) && is_string($decoded[$k]) && str_starts_with($decoded[$k], 'happ://')) {
                    $link = $decoded[$k];
                    break;
                }
            }
        }
        if ($link === null) {
            $trimmed = trim($raw);
            if (str_starts_with($trimmed, 'happ://')) {
                $link = $trimmed;
            }
        }
        if ($link === null) {
            return null;
        }

        return [
            'link' => $link,
            'mode' => self::MODE_REMOTE,
        ];
    }
}
