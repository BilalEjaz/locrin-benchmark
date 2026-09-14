<?php
/**
 * AiCreditsConnection class file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\Services;

defined( 'ABSPATH' ) || exit;

/**
 * The real "AI Credits" site connection — a genuine `ConnectedSite`
 * credential (siteId + secret) minted by VuloCloud's own
 * `contexts/vulopilot/ai-credits` bounded context, layered on TOP of
 * VuloCloudAccountConnection's own person-level login rather than
 * replacing it: a site owner first proves who they are (VuloCloudAccountConnection,
 * a human JWT), then THIS class turns that into a durable, site-scoped
 * credential the plugin can use on every subsequent AI Gateway call
 * without asking for a password again (see connect_and_claim()'s own
 * docblock for the full "install → claim 100 free credits → connect
 * account" orchestration this collapses into one call).
 *
 * `get_broker_authorize_url()`/`exchange_broker_code()` are a second,
 * passwordless front door to this exact same stored connection — the
 * site owner authenticates on a VuloCloud-hosted page instead of typing a
 * VuloCloud password into this plugin at all (ConnectBrokerClient/
 * ConnectBrokerCallbackHandler), landing on the identical `save_connection()`
 * call `connect_and_claim()`'s legacy path already uses. Settings → AI
 * Providers' own Connect button uses this path exclusively;
 * `connect_and_claim()` remains for AiCreditsIndicator.tsx's existing
 * toolbar dropdown.
 *
 * Storage is one dedicated `vulopilot_ai_credits_connection` option, same
 * "never round-trips the secret to the browser, encrypted at rest"
 * posture GoogleServicesConnection.php/VuloCloudAccountConnection.php
 * already establish — `get_status()` below never returns the raw secret,
 * only the cached balance fields a site owner should actually see.
 *
 * The credit balance itself is a CACHE — VuloCloud's own wallet is always
 * the source of truth (VuloPilot brief §3: "WordPress may cache/display
 * the balance, but it must never be considered the source of truth").
 * `refresh_balance()` is the one method that re-syncs it from a real
 * `POST /plugin/ai-credits/balance` call; every other read in this class
 * (`get_status()`) is the last-synced cached value, exactly like
 * GoogleServicesConnection's own cached `ga4_property_name`/etc. fields
 * are a cache of Google's own account data, not re-fetched on every read.
 *
 * @class       AiCreditsConnection class
 * @version     1.0.0
 * @author      VuloLabs
 */
class AiCreditsConnection {

    private const OPTION_KEY = 'vulopilot_ai_credits_connection';

    /** Matches ConnectedSite.pluginSlug's own free-text convention on the vulocloud side (VuloProductSlug::VULOPILOT). */
    private const PLUGIN_SLUG = 'vulopilot';

    /**
     * The stored connection, merged with defaults for any field never yet saved.
     *
     * @return array<string, mixed>
     */
    private function get_connection(): array {
        return wp_parse_args(
            get_option( self::OPTION_KEY, array() ),
            array(
                'site_id'         => '',
                'secret_enc'      => '',
                'credits'         => 0,
                'lifetime_earned' => 0,
                'lifetime_used'   => 0,
                'connected_at'    => '',
                'last_synced_at'  => '',
            )
        );
    }

    /**
     * Merges `$data` into the stored connection.
     *
     * @param array<string, mixed> $data Partial fields to merge into the stored connection.
     * @return void
     */
    private function save_connection( array $data ): void {
        update_option( self::OPTION_KEY, array_merge( $this->get_connection(), $data ), false );
    }

    /**
     * Whether this site has a real ConnectedSite credential.
     *
     * @return bool
     */
    public function is_connected(): bool {
        return '' !== $this->get_connection()['site_id'] && '' !== $this->get_connection()['secret_enc'];
    }

    /**
     * Never the secret — see this class's own docblock.
     *
     * @return array<string, mixed>
     */
    public function get_status(): array {
        $connection = $this->get_connection();

        return array(
            'connected'                   => $this->is_connected(),
            'credits'                     => (int) $connection['credits'],
            'lifetime_earned'             => (int) $connection['lifetime_earned'],
            'lifetime_used'               => (int) $connection['lifetime_used'],
            'connected_at'                => $connection['connected_at'],
            'last_synced_at'              => $connection['last_synced_at'],
            // Composed in so a single GET /ai-credits/status gives the
            // React side everything the credit indicator/claim CTA needs
            // (VuloPilot brief §21) without a second round trip — this
            // class's own connect flow needs a VuloCloud account
            // connected first, so its own state is directly relevant here.
            'vulocloud_account_connected' => ( new VuloCloudAccountConnection() )->is_connected(),
            'vulocloud_account_email'     => ( new VuloCloudAccountConnection() )->get_status()['email'],
        );
    }

    /**
     * The decrypted site credential, ready to authenticate an AI Gateway call.
     *
     * @return array{site_id: string, secret: string}|null Null if not connected.
     */
    public function get_site_credential(): ?array {
        $connection = $this->get_connection();

        if ( '' === $connection['site_id'] || '' === $connection['secret_enc'] ) {
            return null;
        }

        $secret = CredentialEncryption::decrypt( $connection['secret_enc'] );

        return null !== $secret ? array(
            'site_id' => $connection['site_id'],
            'secret'  => $secret,
        ) : null;
    }

    /**
     * The whole "Install → Claim 100 Free AI Credits → Connect/Create
     * VuloCloud Account → ... → AI features become available" flow
     * (VuloPilot brief §4), collapsed into one call:
     *
     * 1. Establish a human VuloCloud session — register+login (a brand-new
     *    account) or just login (an existing one), whichever `$create_account`
     *    says. Skipped entirely if a VuloCloud account is already connected
     *    (e.g. from an earlier, unrelated useContentGate.tsx popup use) —
     *    reuses that session's own stored token rather than asking the site
     *    owner to sign in twice.
     * 2. Resolve which Organization this site's wallet lives under —
     *    the account's first Organization if it already has one, or a
     *    brand-new one (self-service `POST /organizations`, named after
     *    this site) if not. Deliberately does NOT let a site owner pick
     *    among several existing Organizations in this first pass — out of
     *    scope, see the architecture plan's own "Explicitly out of scope."
     * 3. `POST /plugin/ai-credits/connect-site` — real ConnectedSite
     *    credential + the one-time free grant, both minted server-side.
     *
     * Every step is safe to call again (a repeat call reuses the existing
     * VuloCloud session, reuses the existing Organization instead of
     * creating a second one, and connect-site's own grant is idempotent
     * per-Organization — see AiCreditWalletService.grantInitial's own
     * docblock on the vulocloud side).
     *
     * @param string $email           VuloCloud account email.
     * @param string $password        VuloCloud account password.
     * @param string $two_factor_code Only used when the account has 2FA enabled — ignored otherwise.
     * @param bool   $create_account Whether to register a brand-new VuloCloud account rather than log into an existing one.
     * @param bool   $as_customer    "I'm a solo site owner" (architecture plan §F) — registers/logs in against the
     *                               Customer Portal under VULOPILOT_VULOCLOUD_HOST_ORGANIZATION_ID instead of creating
     *                               a personal Organization. See connect_and_claim_as_customer()'s own docblock.
     * @param string $first_name     Customer Portal registration only — ignored otherwise.
     * @param string $last_name      Customer Portal registration only — ignored otherwise.
     * @return array<string, mixed>|\WP_Error Same shape as get_status().
     */
    public function connect_and_claim( string $email, string $password, string $two_factor_code, bool $create_account, bool $as_customer = false, string $first_name = '', string $last_name = '' ) {
        if ( '' === trim( VULOPILOT_VULOCLOUD_URL ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_not_configured',
                __( 'VuloCloud isn’t configured for this build yet.', 'vulopilot' ),
                array( 'status' => 400 )
            );
        }

        if ( $as_customer ) {
            return $this->connect_and_claim_as_customer( $email, $password, $create_account, $first_name, $last_name );
        }

        $account = new VuloCloudAccountConnection();

        if ( ! $account->is_connected() ) {
            $result = $create_account
                ? $account->register( $email, $password )
                : $account->connect( $email, $password, $two_factor_code );

            if ( is_wp_error( $result ) ) {
                return $result;
            }
        }

        $access_token = $account->get_valid_access_token();

        if ( ! $access_token ) {
            return new \WP_Error(
                'vulopilot_ai_credits_not_authenticated',
                __( 'Your VuloCloud session could not be verified. Please try connecting again.', 'vulopilot' ),
                array( 'status' => 401 )
            );
        }

        $client          = new AiCreditsApiClient( VULOPILOT_VULOCLOUD_URL );
        $organization_id = $this->resolve_organization_id( $client, $access_token );

        if ( is_wp_error( $organization_id ) ) {
            return $organization_id;
        }

        $result = $client->connect_site( $access_token, $organization_id, home_url(), self::PLUGIN_SLUG );

        if ( is_wp_error( $result ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_unreachable',
                sprintf(
                    /* translators: %s: underlying error message. */
                    __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                    $result->get_error_message()
                ),
                array( 'status' => 503 )
            );
        }

        $status = $result['http_status'];
        $body   = $result['body'];

        if ( $status < 200 || $status >= 300 ) {
            return new \WP_Error(
                'vulopilot_ai_credits_connect_failed',
                isset( $body['message'] ) ? $body['message'] : __( 'Could not connect this site to VuloCloud AI Credits.', 'vulopilot' ),
                array( 'status' => $status )
            );
        }

        $this->save_connection(
            array(
                'site_id'         => (string) ( $body['siteId'] ?? '' ),
                'secret_enc'      => CredentialEncryption::encrypt( (string) ( $body['siteSecret'] ?? '' ) ),
                'credits'         => (int) ( $body['credits'] ?? 0 ),
                'lifetime_earned' => (int) ( $body['credits'] ?? 0 ),
                'connected_at'    => current_time( 'mysql' ),
                'last_synced_at'  => current_time( 'mysql' ),
            )
        );

        return $this->get_status();
    }

    /**
     * The account's first existing Organization, or a brand-new one if it
     * has none yet — see connect_and_claim()'s own docblock, step 2.
     *
     * @param AiCreditsApiClient $client       Used to create the new Organization if one doesn't exist yet.
     * @param string             $access_token The site owner's own VuloCloud access token.
     * @return string|\WP_Error
     */
    private function resolve_organization_id( AiCreditsApiClient $client, string $access_token ) {
        $account_client = new VuloCloudAccountApiClient( VULOPILOT_VULOCLOUD_URL );
        $result         = $account_client->list_organizations( $access_token );

        if ( is_wp_error( $result ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_unreachable',
                sprintf(
                    /* translators: %s: underlying error message. */
                    __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                    $result->get_error_message()
                ),
                array( 'status' => 503 )
            );
        }

        if ( $result['http_status'] >= 200 && $result['http_status'] < 300 && ! empty( $result['body'] ) && is_array( $result['body'] ) ) {
            $first = reset( $result['body'] );

            if ( is_array( $first ) && ! empty( $first['organizationId'] ) ) {
                return (string) $first['organizationId'];
            }
        }

        $name    = get_bloginfo( 'name' );
        $created = $account_client->create_organization( $access_token, '' !== $name ? $name : home_url() );

        if ( is_wp_error( $created ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_unreachable',
                sprintf(
                    /* translators: %s: underlying error message. */
                    __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                    $created->get_error_message()
                ),
                array( 'status' => 503 )
            );
        }

        if ( $created['http_status'] < 200 || $created['http_status'] >= 300 || empty( $created['body']['id'] ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_organization_failed',
                __( 'Could not set up a VuloCloud account for this site.', 'vulopilot' ),
                array( 'status' => 502 )
            );
        }

        return (string) $created['body']['id'];
    }

    /**
     * The "I'm a solo site owner" half of connect_and_claim() (architecture
     * plan §F) — a genuinely different identity from the agency path's
     * personal Organization: registers/logs into VuloCloud's Customer
     * Portal (`contexts/customer`) under the one fixed
     * VULOPILOT_VULOCLOUD_HOST_ORGANIZATION_ID, then calls the same
     * dual-mode `connect-site` endpoint with that Customer's own access
     * token instead of a staff token. No `resolve_organization_id()` step
     * is needed here — the host Organization is already fixed, unlike the
     * agency path where each account gets its own.
     *
     * No 2FA branch — VuloCloud's Customer auth doesn't have one (unlike
     * the staff/Organization login this class's agency path uses).
     *
     * @param string $email          VuloCloud Customer account email.
     * @param string $password       VuloCloud Customer account password.
     * @param bool   $create_account Whether to register a brand-new Customer rather than log into an existing one.
     * @param string $first_name     Registration only — required by the Customer Portal's own register DTO.
     * @param string $last_name      Registration only — required by the Customer Portal's own register DTO.
     * @return array<string, mixed>|\WP_Error Same shape as get_status().
     */
    private function connect_and_claim_as_customer( string $email, string $password, bool $create_account, string $first_name, string $last_name ) {
        $host_organization_id = trim( VULOPILOT_VULOCLOUD_HOST_ORGANIZATION_ID );

        if ( '' === $host_organization_id ) {
            return new \WP_Error(
                'vulopilot_ai_credits_solo_not_configured',
                __( 'The solo site owner option isn’t configured for this build yet.', 'vulopilot' ),
                array( 'status' => 400 )
            );
        }

        $client = new AiCreditsApiClient( VULOPILOT_VULOCLOUD_URL );

        if ( $create_account ) {
            if ( '' === $first_name || '' === $last_name ) {
                return new \WP_Error(
                    'vulopilot_ai_credits_missing_name',
                    __( 'Enter your first and last name.', 'vulopilot' ),
                    array( 'status' => 400 )
                );
            }

            $registered = $client->portal_register( $host_organization_id, $email, $password, $first_name, $last_name );

            if ( is_wp_error( $registered ) ) {
                return new \WP_Error(
                    'vulopilot_ai_credits_unreachable',
                    sprintf(
                        /* translators: %s: underlying error message. */
                        __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                        $registered->get_error_message()
                    ),
                    array( 'status' => 503 )
                );
            }

            if ( $registered['http_status'] < 200 || $registered['http_status'] >= 300 ) {
                return new \WP_Error(
                    'vulopilot_ai_credits_registration_failed',
                    isset( $registered['body']['message'] ) ? $registered['body']['message'] : __( 'Could not create your VuloCloud account.', 'vulopilot' ),
                    array( 'status' => $registered['http_status'] )
                );
            }
        }

        $login = $client->portal_login( $host_organization_id, $email, $password );

        if ( is_wp_error( $login ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_unreachable',
                sprintf(
                    /* translators: %s: underlying error message. */
                    __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                    $login->get_error_message()
                ),
                array( 'status' => 503 )
            );
        }

        if ( $login['http_status'] < 200 || $login['http_status'] >= 300 ) {
            return new \WP_Error(
                'vulopilot_ai_credits_not_authenticated',
                isset( $login['body']['message'] ) ? $login['body']['message'] : __( 'Could not sign in to your VuloCloud account.', 'vulopilot' ),
                array( 'status' => $login['http_status'] )
            );
        }

        $access_token = (string) ( $login['body']['accessToken'] ?? '' );

        if ( '' === $access_token ) {
            return new \WP_Error(
                'vulopilot_ai_credits_not_authenticated',
                __( 'Your VuloCloud session could not be verified. Please try connecting again.', 'vulopilot' ),
                array( 'status' => 401 )
            );
        }

        $result = $client->connect_site( $access_token, null, home_url(), self::PLUGIN_SLUG );

        if ( is_wp_error( $result ) ) {
            return new \WP_Error(
                'vulopilot_ai_credits_unreachable',
                sprintf(
                    /* translators: %s: underlying error message. */
                    __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                    $result->get_error_message()
                ),
                array( 'status' => 503 )
            );
        }

        $status = $result['http_status'];
        $body   = $result['body'];

        if ( $status < 200 || $status >= 300 ) {
            return new \WP_Error(
                'vulopilot_ai_credits_connect_failed',
                isset( $body['message'] ) ? $body['message'] : __( 'Could not connect this site to VuloCloud AI Credits.', 'vulopilot' ),
                array( 'status' => $status )
            );
        }

        $this->save_connection(
            array(
                'site_id'         => (string) ( $body['siteId'] ?? '' ),
                'secret_enc'      => CredentialEncryption::encrypt( (string) ( $body['siteSecret'] ?? '' ) ),
                'credits'         => (int) ( $body['credits'] ?? 0 ),
                'lifetime_earned' => (int) ( $body['credits'] ?? 0 ),
                'connected_at'    => current_time( 'mysql' ),
                'last_synced_at'  => current_time( 'mysql' ),
            )
        );

        return $this->get_status();
    }

    /**
     * Real `POST /plugin/ai-credits/balance` — the one method that
     * re-syncs the cached balance from VuloCloud's own authoritative
     * wallet (VuloPilot brief §3). Called on demand (Settings/credit
     * indicator "refresh" action), not on every page load.
     *
     * @return array<string, mixed>|\WP_Error Same shape as get_status().
     */
    public function refresh_balance() {
        $credential = $this->get_site_credential();

        if ( ! $credential ) {
            return new \WP_Error( 'vulopilot_ai_credits_not_connected', __( 'This site is not connected to VuloCloud AI Credits.', 'vulopilot' ), array( 'status' => 400 ) );
        }

        $result = ( new AiCreditsApiClient( VULOPILOT_VULOCLOUD_URL ) )->get_balance( $credential['site_id'], $credential['secret'] );

        if ( is_wp_error( $result ) ) {
            // Offline/unreachable — VuloPilot brief §27: never destroy the
            // cached balance on a failed sync, just report the real error.
            return new \WP_Error(
                'vulopilot_ai_credits_unreachable',
                sprintf(
                    /* translators: %s: underlying error message. */
                    __( 'Could not reach VuloCloud: %s', 'vulopilot' ),
                    $result->get_error_message()
                ),
                array( 'status' => 503 )
            );
        }

        if ( $result['http_status'] < 200 || $result['http_status'] >= 300 ) {
            return new \WP_Error(
                'vulopilot_ai_credits_sync_failed',
                __( 'Could not refresh your AI credit balance.', 'vulopilot' ),
                array( 'status' => $result['http_status'] )
            );
        }

        $body = $result['body'];

        $this->save_connection(
            array(
                'credits'         => (int) ( $body['credits'] ?? 0 ),
                'lifetime_earned' => (int) ( $body['lifetimeEarned'] ?? 0 ),
                'lifetime_used'   => (int) ( $body['lifetimeUsed'] ?? 0 ),
                'last_synced_at'  => current_time( 'mysql' ),
            )
        );

        return $this->get_status();
    }

    /**
     * The redirect_uri VuloCloud's own `/plugin/connect/exchange` redirect
     * must land back on — `admin-post.php` (not a REST route), same
     * reasoning GoogleServicesConnection::get_redirect_uri() documents:
     * this browser redirect carries no `X-WP-Nonce` header for a REST
     * nonce check, and `admin-post.php` already authenticates via the same
     * login cookie every other wp-admin page load does.
     *
     * @return string
     */
    public function get_broker_redirect_uri(): string {
        return admin_url( 'admin-post.php?action=vulopilot_connect_broker_callback' );
    }

    /**
     * The passwordless "Connect to VuloCloud" URL — Settings → AI
     * Providers' own Connect button 302s the browser here instead of
     * rendering a login/signup form itself (see this repo's
     * ConnectBrokerClient/ConnectBrokerCallbackHandler for the rest of the
     * sequence). `state` is a real WP nonce (verified in
     * `verify_broker_state()` on the way back, guarding the callback
     * against CSRF the same way every other WordPress admin-post handler's
     * own `check_admin_referer()` would) — VuloCloud itself never inspects
     * it, only echoes it back verbatim.
     *
     * @return string|null Null if this build isn't configured to reach VuloCloud at all yet.
     */
    public function get_broker_authorize_url(): ?string {
        if ( '' === trim( VULOPILOT_VULOCLOUD_URL ) ) {
            return null;
        }

        $state = wp_create_nonce( 'vulopilot_connect_broker' );

        // Browser-facing: must be reachable from the site owner's own
        // browser, which is not always true of VULOPILOT_VULOCLOUD_URL
        // itself (e.g. `host.docker.internal` in local Docker dev) — see
        // VULOPILOT_VULOCLOUD_PUBLIC_URL's own docblock in config.php.
        $browser_url = '' !== trim( VULOPILOT_VULOCLOUD_PUBLIC_URL ) ? VULOPILOT_VULOCLOUD_PUBLIC_URL : VULOPILOT_VULOCLOUD_URL;

        return ( new ConnectBrokerClient( $browser_url ) )->get_authorize_url(
            home_url(),
            $this->get_broker_redirect_uri(),
            $state,
            trim( VULOPILOT_VULOCLOUD_HOST_ORGANIZATION_ID )
        );
    }

    /**
     * @param string $state The `state` query param the broker's redirect carried back.
     * @return bool
     */
    public function verify_broker_state( string $state ): bool {
        return false !== wp_verify_nonce( $state, 'vulopilot_connect_broker' );
    }

    /**
     * Redeems the broker's own single-use exchange `code`
     * (ConnectBrokerCallbackHandler's own caller) and, on success, stores
     * the real ConnectedSite credential exactly like connect_and_claim()'s
     * own legacy password-based flow does — this is simply a different
     * front door to the same stored connection, not a parallel one.
     *
     * @param string $code The single-use exchange code from the broker's own return redirect.
     * @return array<string, mixed>|\WP_Error Same shape as get_status().
     */
    public function exchange_broker_code( string $code ) {
        $result = ( new ConnectBrokerClient( VULOPILOT_VULOCLOUD_URL ) )->exchange( home_url(), $code );

        if ( is_wp_error( $result ) ) {
            return $result;
        }

        $this->save_connection(
            array(
                'site_id'         => $result['siteId'],
                'secret_enc'      => CredentialEncryption::encrypt( $result['siteSecret'] ),
                'credits'         => $result['credits'],
                'lifetime_earned' => $result['credits'],
                'connected_at'    => current_time( 'mysql' ),
                'last_synced_at'  => current_time( 'mysql' ),
            )
        );

        // Immediate first report — without this, the Connected Sites
        // detail page shows "Syncing…"/blank telemetry until the daily
        // cron eventually fires (Services\SiteTelemetryReporter's own
        // doc comment). Best-effort: a failure here doesn't affect the
        // connection itself, which already fully succeeded above.
        ( new SiteTelemetryReporter() )->report( $result['siteId'], $result['siteSecret'] );

        return $this->get_status();
    }

    /**
     * Records a real, successful AI Gateway spend against the LOCAL cache
     * immediately (rather than waiting for the next refresh_balance() call)
     * — called by AiCreditGatewayClient right after a real
     * `/plugin/ai/execute` success, whose own response already carries the
     * authoritative post-spend balance. This is still a cache write, not
     * an independent deduction (VuloPilot brief §3: "do not allow the
     * WordPress plugin to simply set its own credit balance") — the number
     * stored here is exactly what VuloCloud's own response just said the
     * balance now is, never locally computed.
     *
     * @param int $credits_remaining The authoritative post-spend balance, straight from VuloCloud's own response.
     * @return void
     */
    public function record_known_balance( int $credits_remaining ): void {
        $this->save_connection(
            array(
                'credits'        => $credits_remaining,
                'last_synced_at' => current_time( 'mysql' ),
            )
        );
    }

    /**
     * Real self-service revoke on VuloCloud's own side
     * (`POST /plugin/ai-credits/disconnect`, ConnectedSiteService::revokeBySite())
     * — an earlier version of this method only ever cleared the local
     * option, since no revoke-site endpoint existed yet; that gap is
     * closed now. The remote call is best-effort: this always clears the
     * local option regardless of its outcome (an already-revoked/unknown
     * site, or VuloCloud being briefly unreachable, shouldn't leave this
     * site stuck showing "Connected" when the site owner explicitly
     * asked to disconnect) — see the loud `error_log()` below for the one
     * case worth a site owner's admin knowing about: the remote secret
     * living on past a local disconnect, still usable by nothing since
     * this site no longer holds it, but not actually revoked either.
     *
     * @return void
     */
    public function disconnect(): void {
        $credential = $this->get_site_credential();

        if ( $credential ) {
            $result = ( new AiCreditsApiClient( VULOPILOT_VULOCLOUD_URL ) )->disconnect_site( $credential['site_id'], $credential['secret'] );

            if ( is_wp_error( $result ) ) {
                error_log( sprintf( '[VuloPilot] Could not revoke ConnectedSite %s on disconnect: %s', $credential['site_id'], $result->get_error_message() ) );
            }
        }

        delete_option( self::OPTION_KEY );
    }
}
