<?php

/**
 * @author  MEMORA solutions <info@memora.ca> (https://memora.solutions)
 *
 * @project memora/laravel-saas-boilerplate
 */

declare(strict_types=1);

namespace Modules\Core\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class SecurityHeaders
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set('X-XSS-Protection', '1; mode=block');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), display-capture=(self)');
        // ACTION: screenpal.com + media.memora.solutions (CNAME ScreenPal en marque blanche) au frame-src GLOBAL
        // SELF: édition 1 ligne. RAISON: SecurityHeaders est la CSP globale active qui écrase AcademyCsp sur /academie ;
        // media.memora.solutions est un domaine Memora de premier niveau (pas un tiers), déjà validé comme hôte d'embed vidéo légitime.
        $response->headers->set('Content-Security-Policy', "frame-src 'self' https://screenpal.com https://*.screenpal.com https://media.memora.solutions https://lookerstudio.google.com https://www.youtube-nocookie.com https://www.youtube.com https://js.stripe.com https://hooks.stripe.com https://googleads.g.doubleclick.net https://ep2.adtrafficquality.google https://pagead2.googlesyndication.com https://tpc.googlesyndication.com https://www.google.com");

        if (app()->environment('production')) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        if ($request->is('api/*')) {
            $response->headers->set('Cache-Control', 'no-store, no-cache, must-revalidate');
        }

        return $response;
    }
}
