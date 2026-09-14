<?php
/**
 * VuloCloudConnection class file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\Services;

defined( 'ABSPATH' ) || exit;

/**
 * Generic "connect this plugin to a pre-known VuloCloud Organization +
 * Brand" connection — a plain sibling to AiCreditsConnection, not a
 * modification of it. That class's stored connection is unconditionally
 * AI-Credits-shaped (credit balance fields baked into its option schema
 * and `get_status()`); this one carries none of that, and everything it
 * reads comes from VULOPILOT_VULOCLOUD_CONFIG (config.php's own doc
 * comment) — nothing in this class is specific to VuloPilot itself, so
 * another plugin gets the same behavior by defining its own equivalent
 * config array and instantiating this same class.
 *
 * Same passwordless broker mechanism AiCreditsConnection's own
 * `get_broker_authorize_url()`/`exchange_broker_code()` already use
 * (ConnectBrokerClient) — this class is simply a second, parallel front
 * door onto that mechanism, using the generic `pluginId`/`organizationId`/
 * `brandId` query shape instead of the legacy `soloOrganizationId` one.
 * The two connections are entirely independent: connecting through this
 * class never touches AI Credits, and vice versa.
 *
 * Storage is its own dedicated `vulopilot_vulocloud_connection` option,
 * same "never round-trips the secret to the browser, encrypted at rest"
 * posture AiCreditsConnection/GoogleServicesConnection already establish.
 *
 * @class       VuloCloudConnection class
 * @version     1.0.0
 * @author      VuloLabs
 */
class VuloCloudConnection {

	private const OPTION_KEY = 'vulopilot_vulocloud_connection';

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
				'organization_id' => '',
				'brand_id'        => '',
				'domain'          => '',
				'connected_at'    => '',
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
	 * Never the secret — see this class's own docblock. `organization_id`/
	 * `brand_id` here are the values ACTUALLY authorized at connect time
	 * (echoed back by VuloCloud's own exchange response is not needed for
	 * this — they're simply the config values this connection was made
	 * with), which any later brand-scoped API/data fetching should read
	 * from here rather than straight off VULOPILOT_VULOCLOUD_CONFIG —
	 * that config could change after connecting, this reflects what's
	 * actually live.
	 *
	 * @return array<string, mixed>
	 */
	public function get_status(): array {
		$connection = $this->get_connection();

		return array(
			'connected'       => $this->is_connected(),
			'organization_id' => $connection['organization_id'],
			'brand_id'        => $connection['brand_id'],
			// This Organization's own public storefront domain — reference/
			// display only, never the URL any API call in this class
			// actually hits (that's always VULOPILOT_VULOCLOUD_URL, the
			// VuloCloud platform itself — see get_broker_authorize_url()'s
			// own doc comment for why the two must not be conflated).
			'domain'          => $connection['domain'],
			'connected_at'    => $connection['connected_at'],
		);
	}

	/**
	 * The decrypted site credential, ready to authenticate any brand-scoped
	 * API call this plugin makes on VuloCloud (offerings/pricing, etc.).
	 *
	 * @return array{site_id: string, secret: string, organization_id: string, brand_id: string}|null Null if not connected.
	 */
	public function get_site_credential(): ?array {
		$connection = $this->get_connection();

		if ( '' === $connection['site_id'] || '' === $connection['secret_enc'] ) {
			return null;
		}

		$secret = CredentialEncryption::decrypt( $connection['secret_enc'] );

		return null !== $secret ? array(
			'site_id'         => $connection['site_id'],
			'secret'          => $secret,
			'organization_id' => $connection['organization_id'],
			'brand_id'        => $connection['brand_id'],
		) : null;
	}

	/**
	 * The redirect_uri VuloCloud's own `/plugin/connect/exchange` redirect
	 * must land back on — a DIFFERENT admin-post.php action than
	 * AiCreditsConnection::get_broker_redirect_uri()'s own, since these are
	 * two entirely independent connections and each needs its own callback
	 * so ConnectBrokerCallbackHandler/VuloCloudConnectCallbackHandler can
	 * tell which one a given return redirect belongs to.
	 *
	 * @return string
	 */
	public function get_broker_redirect_uri(): string {
		return admin_url( 'admin-post.php?action=vulopilot_vulocloud_connect_callback' );
	}

	/**
	 * The passwordless "Connect to VuloCloud" URL for this generic
	 * connection — null (Connect button hidden/disabled) until a real
	 * deploy sets `organization_id` in VULOPILOT_VULOCLOUD_CONFIG, same
	 * "honestly report unavailable" reasoning
	 * AiCreditsConnection::get_broker_authorize_url() already follows for
	 * VULOPILOT_VULOCLOUD_URL.
	 *
	 * @return string|null
	 */
	public function get_broker_authorize_url(): ?string {
		$config = VULOPILOT_VULOCLOUD_CONFIG;

		// VULOPILOT_VULOCLOUD_URL is the VuloCloud PLATFORM's own API base
		// (same constant AiCreditsConnection already calls out to) — NOT
		// $config['domain'], which is this connection's own Organization's
		// public storefront domain (e.g. store.vulolabs.com), an entirely
		// different thing kept here only for reference/display (get_status()
		// exposes it). Conflating the two would send this site's browser to
		// a customer-facing storefront instead of the actual hosted
		// login/connect page.
		if ( '' === trim( VULOPILOT_VULOCLOUD_URL ) || '' === trim( (string) ( $config['organization_id'] ?? '' ) ) ) {
			return null;
		}

		$state = wp_create_nonce( 'vulopilot_vulocloud_connect' );

		// Browser-facing: must be reachable from the site owner's own
		// browser — same VULOPILOT_VULOCLOUD_PUBLIC_URL-over-
		// VULOPILOT_VULOCLOUD_URL precedence
		// AiCreditsConnection::get_broker_authorize_url() already applies,
		// for the identical local-Docker-dev reason (see that constant's
		// own docblock in config.php).
		$browser_url = '' !== trim( VULOPILOT_VULOCLOUD_PUBLIC_URL ) ? VULOPILOT_VULOCLOUD_PUBLIC_URL : VULOPILOT_VULOCLOUD_URL;

		return ( new ConnectBrokerClient( $browser_url ) )->get_authorize_url(
			home_url(),
			$this->get_broker_redirect_uri(),
			$state,
			'', // soloOrganizationId — the legacy shape, not used by this connection.
			(string) $config['plugin_id'],
			(string) $config['organization_id'],
			(string) ( $config['brand_id'] ?? '' )
		);
	}

	/**
	 * Verifies a broker return redirect's `state` nonce.
	 *
	 * @param string $state The `state` query param the broker's redirect carried back.
	 * @return bool
	 */
	public function verify_broker_state( string $state ): bool {
		return false !== wp_verify_nonce( $state, 'vulopilot_vulocloud_connect' );
	}

	/**
	 * Redeems the broker's own single-use exchange `code`
	 * (VuloCloudConnectCallbackHandler's own caller) and, on success,
	 * stores the real ConnectedSite credential — organization_id/brand_id
	 * stored are this build's own config values (the ones the just-
	 * completed authorize call actually used), not anything echoed back
	 * by VuloCloud's exchange response.
	 *
	 * @param string $code The single-use exchange code from the broker's own return redirect.
	 * @return array<string, mixed>|\WP_Error Same shape as get_status().
	 */
	public function exchange_broker_code( string $code ) {
		$config = VULOPILOT_VULOCLOUD_CONFIG;
		$result = ( new ConnectBrokerClient( VULOPILOT_VULOCLOUD_URL ) )->exchange( home_url(), $code );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		$this->save_connection(
			array(
				'site_id'         => $result['siteId'],
				'secret_enc'      => CredentialEncryption::encrypt( $result['siteSecret'] ),
				'organization_id' => (string) $config['organization_id'],
				'brand_id'        => (string) ( $config['brand_id'] ?? '' ),
				'domain'          => (string) ( $config['domain'] ?? '' ),
				'connected_at'    => current_time( 'mysql' ),
			)
		);

		// Immediate first report — see SiteTelemetryReporter's own doc
		// comment and AiCreditsConnection::exchange_broker_code()'s
		// identical call for why this can't just wait for the daily cron.
		( new SiteTelemetryReporter() )->report( $result['siteId'], $result['siteSecret'] );

		return $this->get_status();
	}

	/**
	 * Real self-service revoke on VuloCloud's own side
	 * (`POST /plugin/connected-sites/disconnect`... — actually there is
	 * no generic disconnect endpoint on the vulocloud side yet, only the
	 * AI-Credits-specific `/plugin/ai-credits/disconnect`
	 * (ConnectedSiteService::revokeBySite() itself IS generic, just not
	 * yet exposed under a non-AI-Credits route) — so this always clears
	 * the local option (a site owner explicitly disconnecting shouldn't
	 * stay stuck showing "Connected" either way), same
	 * "best-effort remote, unconditional local clear" posture
	 * AiCreditsConnection::disconnect() documents, minus the remote call
	 * this generic path can't make yet.
	 *
	 * @return void
	 */
	public function disconnect(): void {
		delete_option( self::OPTION_KEY );
	}
}
