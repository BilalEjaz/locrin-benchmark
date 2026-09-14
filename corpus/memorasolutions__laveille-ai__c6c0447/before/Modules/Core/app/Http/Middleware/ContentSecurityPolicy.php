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

class ContentSecurityPolicy
{
    public function handle(Request $request, Closure $next): Response
    {
        $nonce = base64_encode(random_bytes(16));
        $request->attributes->set('csp-nonce', $nonce);

        $response = $next($request);

        $policy = implode('; ', [
            "default-src 'self'",
            "script-src 'self' 'nonce-{$nonce}' https://js.stripe.com",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: https:",
            "font-src 'self'",
            "connect-src 'self' https://api.stripe.com",
            // screenpal.com + media.memora.solutions (CNAME ScreenPal marque blanche, domaine Memora premier niveau) :
            // vidéos du module Academy (AcademyCsp le couvre aussi, mais la CSP globale peut écraser celle du
            // middleware de route si elle est appliquée après — on l'ajoute ici par sécurité).
            "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://screenpal.com https://*.screenpal.com https://media.memora.solutions",
            "frame-ancestors 'self'",
            "base-uri 'self'",
            "form-action 'self' https://api.stripe.com",
        ]);

        $response->headers->set('Content-Security-Policy', $policy);

        return $response;
    }
}
