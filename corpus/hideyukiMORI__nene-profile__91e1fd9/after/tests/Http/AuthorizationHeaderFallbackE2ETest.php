<?php

declare(strict_types=1);

namespace NeneProfile\Tests\Http;

use Nene2\Auth\TokenIssuerInterface;
use NeneProfile\Http\RuntimeContainerFactory;
use Nyholm\Psr7\Factory\Psr17Factory;
use PHPUnit\Framework\TestCase;
use Psr\Http\Server\RequestHandlerInterface;

/**
 * End-to-end proof that the opt-in X-Authorization fallback receiver (NENE2 #1558 /
 * ADR 0019) is wired into this product's runtime pipeline.
 *
 * Front-end fleet clients (`@hideyukimori/nene2-client` v1.1.0) mirror every bearer
 * token into `X-Authorization: Bearer <token>` so that shared hosting (HETEML-type
 * Tier A) — where an upstream proxy strips the standard `Authorization` header before
 * PHP sees it — can still authenticate. `RuntimeServiceProvider` enables the receiver
 * via `enableAuthorizationHeaderFallback: true`, so the framework's
 * AuthorizationHeaderFallbackMiddleware restores `Authorization` from the mirror
 * (only when `Authorization` is absent/empty) at the head of the auth stage, before
 * `AdminApiAuthMiddleware` runs.
 *
 * `GET /admin/organizations` is bearer-protected but bypasses org resolution, so
 * these assertions isolate the credential-restoration behaviour with no seeded tenant.
 *
 * The tests fail if the opt-in flag is removed from RuntimeServiceProvider: a
 * mirror-only request would then never restore `Authorization` and would be
 * rejected as `missing_token`.
 */
final class AuthorizationHeaderFallbackE2ETest extends TestCase
{
    private const PROTECTED_PATH = '/admin/organizations';

    private RequestHandlerInterface $app;
    private TokenIssuerInterface $issuer;

    protected function setUp(): void
    {
        parent::setUp();

        $container = (new RuntimeContainerFactory(dirname(__DIR__, 2)))->create();

        $app = $container->get(RequestHandlerInterface::class);
        self::assertInstanceOf(RequestHandlerInterface::class, $app);
        $this->app = $app;

        $issuer = $container->get(TokenIssuerInterface::class);
        self::assertInstanceOf(TokenIssuerInterface::class, $issuer);
        $this->issuer = $issuer;
    }

    /**
     * The mirror end-to-end proof: a valid bearer token supplied ONLY in the
     * `X-Authorization` header (no standard `Authorization`) is restored by the
     * fallback receiver and accepted by the auth stage — the request passes
     * authentication.
     *
     * `AdminApiAuthMiddleware` is the only thing that issues a `WWW-Authenticate`
     * challenge; its absence proves authentication succeeded (any further 4xx here
     * is downstream authorization — the capability middleware — which is out of scope
     * for the transport-level mirror proof).
     */
    public function test_valid_token_in_mirror_only_passes_authentication(): void
    {
        $token = $this->issuer->issue(['sub' => 'admin-e2e', 'exp' => time() + 3600]);

        $request = (new Psr17Factory())
            ->createServerRequest('GET', self::PROTECTED_PATH)
            ->withHeader('X-Authorization', 'Bearer ' . $token);

        $response = $this->app->handle($request);

        self::assertSame(
            '',
            $response->getHeaderLine('WWW-Authenticate'),
            'A valid token mirrored only into X-Authorization must pass the auth stage (no challenge issued).',
        );
    }

    /**
     * The auth stage actually receives the mirrored credential: an INVALID token
     * in `X-Authorization` only is rejected as `invalid_token` (the auth middleware
     * saw a token), NOT `missing_token` — which is only possible if the fallback
     * receiver restored `Authorization` from the mirror before auth ran.
     */
    public function test_invalid_token_in_mirror_only_reaches_auth_stage_as_invalid_not_missing(): void
    {
        $request = (new Psr17Factory())
            ->createServerRequest('GET', self::PROTECTED_PATH)
            ->withHeader('X-Authorization', 'Bearer not-a-real-token');

        $response = $this->app->handle($request);

        self::assertSame(401, $response->getStatusCode());
        $wwwAuth = $response->getHeaderLine('WWW-Authenticate');
        self::assertStringContainsString('error="invalid_token"', $wwwAuth);
        self::assertStringNotContainsString('error="missing_token"', $wwwAuth);
    }

    /**
     * Baseline / control: with NO credential in either header, the auth stage
     * reports `missing_token`. This is the response a mirror-only request would get
     * if the opt-in fallback were disabled.
     */
    public function test_no_credential_yields_missing_token(): void
    {
        $request = (new Psr17Factory())->createServerRequest('GET', self::PROTECTED_PATH);

        $response = $this->app->handle($request);

        self::assertSame(401, $response->getStatusCode());
        self::assertStringContainsString(
            'error="missing_token"',
            $response->getHeaderLine('WWW-Authenticate'),
        );
    }

    /**
     * The standard header still wins when both are present (byte-for-byte behaviour
     * unchanged on hosting that delivers `Authorization`): a valid standard token
     * authenticates even when an invalid mirror is also sent. If the receiver wrongly
     * preferred the mirror, the auth stage would reject the invalid token with an
     * `invalid_token` challenge; its absence proves standard-header precedence.
     */
    public function test_standard_authorization_header_takes_precedence_over_mirror(): void
    {
        $token = $this->issuer->issue(['sub' => 'admin-e2e', 'exp' => time() + 3600]);

        $request = (new Psr17Factory())
            ->createServerRequest('GET', self::PROTECTED_PATH)
            ->withHeader('Authorization', 'Bearer ' . $token)
            ->withHeader('X-Authorization', 'Bearer not-a-real-token');

        $response = $this->app->handle($request);

        self::assertSame('', $response->getHeaderLine('WWW-Authenticate'));
    }
}
