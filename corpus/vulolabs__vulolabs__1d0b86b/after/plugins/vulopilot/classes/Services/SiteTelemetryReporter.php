<?php
/**
 * SiteTelemetryReporter class file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\Services;

defined( 'ABSPATH' ) || exit;

/**
 * Reports this site's own real WordPress/PHP/theme/plugin details to
 * VuloCloud's generic `POST /connected-sites/ingest` endpoint — the one
 * HTTP surface that fills in the Connected Sites detail page's
 * "Site & Server"/"Plugin & Theme"/"Platform" cards (otherwise left
 * showing "—" forever, since connecting itself never sends this data —
 * see ConnectedSiteIngestController's own doc comment on the VuloCloud
 * side). Deliberately generic/independent of which of this plugin's own
 * connections (AiCreditsConnection's soloOrganizationId shape,
 * VuloCloudConnection's generic org+brand shape) called it — each is its
 * own separate ConnectedSite row with its own site_id/secret, so each
 * gets its own report() call against the exact same payload shape.
 *
 * The "Plugin"/"Version" fields report THIS plugin's own real identity
 * (VULOPILOT_PLUGIN_NAME/VULOPILOT_PLUGIN_VERSION from config.php) —
 * never a hardcoded literal naming a different plugin (e.g.
 * "MultiVendorX"), so this reads correctly for a rebrand/fork that only
 * changes those two constants, and for any future plugin reusing this
 * same generic connect flow with its own values there.
 *
 * @class       SiteTelemetryReporter class
 * @version     1.0.0
 * @author      VuloLabs
 */
class SiteTelemetryReporter {

	private const CRON_HOOK = 'vulopilot_site_telemetry_daily';

	/**
	 * Registers the daily cron report alongside the immediate,
	 * connect-time report — Services\SecurityScoreSnapshotRecorder's own
	 * "wp_next_scheduled()-guarded wp_schedule_event() on init" pattern.
	 * The immediate report itself isn't triggered from here — it's called
	 * directly by AiCreditsConnection::exchange_broker_code()/
	 * VuloCloudConnection::exchange_broker_code() right after each of
	 * their own successful connects, since only they know which
	 * connection just became real.
	 */
	public function __construct() {
		add_action( 'init', array( $this, 'ensure_daily_report_scheduled' ) );
		add_action( self::CRON_HOOK, array( $this, 'report_all_connections' ) );
	}

	/**
	 * @return void
	 */
	public function ensure_daily_report_scheduled(): void {
		if ( ! wp_next_scheduled( self::CRON_HOOK ) ) {
			wp_schedule_event( time(), 'daily', self::CRON_HOOK );
		}
	}

	/**
	 * The daily cron callback — reports every currently-connected
	 * connection this plugin holds. Each is independent and best-effort:
	 * one failing (e.g. AI Credits connected but VuloCloud generic
	 * connection isn't) never blocks the other.
	 *
	 * @return void
	 */
	public function report_all_connections(): void {
		$ai_credits = ( new AiCreditsConnection() )->get_site_credential();
		if ( null !== $ai_credits ) {
			$this->report( $ai_credits['site_id'], $ai_credits['secret'] );
		}

		$vulocloud = ( new VuloCloudConnection() )->get_site_credential();
		if ( null !== $vulocloud ) {
			$this->report( $vulocloud['site_id'], $vulocloud['secret'] );
		}
	}

	/**
	 * Real `POST {VULOPILOT_VULOCLOUD_URL}/connected-sites/ingest` —
	 * always the server-to-server URL, never
	 * VULOPILOT_VULOCLOUD_PUBLIC_URL (that's browser-facing only, see
	 * AiCreditsConnection::get_broker_authorize_url()'s own doc comment).
	 * Best-effort/fire-and-forget by design: a failed ingest just means
	 * the detail page keeps showing stale/blank telemetry until the next
	 * successful attempt (daily cron, or the site owner's next
	 * reconnect) — never surfaced to the site owner as an error, same
	 * posture a "usage tracker" ping already takes elsewhere in this
	 * plugin (Services\CoreWebVitalsBeacon, Services\PageSpeedScanner).
	 *
	 * @param string $site_id This connection's own ConnectedSite id.
	 * @param string $secret  This connection's own decrypted secret.
	 * @return bool True if VuloCloud accepted the ping (2xx).
	 */
	public function report( string $site_id, string $secret ): bool {
		if ( '' === trim( VULOPILOT_VULOCLOUD_URL ) ) {
			return false;
		}

		$response = wp_remote_post(
			untrailingslashit( VULOPILOT_VULOCLOUD_URL ) . '/connected-sites/ingest',
			array(
				'timeout' => 15,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'siteId'  => $site_id,
						'secret'  => $secret,
						'payload' => $this->build_payload(),
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			return false;
		}

		return (int) wp_remote_retrieve_response_code( $response ) < 300;
	}

	/**
	 * The tracker payload itself — field names match
	 * connected-site-field-mapper.ts's own recognized keys exactly
	 * (verbatim strings, not valid JS/PHP identifiers, by design on that
	 * side — see that file's own doc comment).
	 *
	 * @return array<string, mixed>
	 */
	private function build_payload(): array {
		$theme = wp_get_theme();

		return array(
			'Site Name'      => get_bloginfo( 'name' ),
			'Site Version'   => get_bloginfo( 'version' ),
			'Site Language'  => get_bloginfo( 'language' ),
			'Charset'        => get_bloginfo( 'charset' ),
			'Php Version'    => phpversion(),
			'Multisite'      => is_multisite(),
			'File Location'  => ABSPATH,
			'Email'          => get_bloginfo( 'admin_email' ),
			'Server'         => isset( $_SERVER['SERVER_SOFTWARE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SERVER_SOFTWARE'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- server-reported environment info, not user input; sanitized regardless.
			'Text Direction' => is_rtl() ? 'rtl' : 'ltr',
			'Plugin'         => VULOPILOT_PLUGIN_NAME,
			'Version'        => VULOPILOT_PLUGIN_VERSION,
			'Status'         => 'active',
			'Theme'          => $theme->get( 'Name' ),
			'Theme Version'  => $theme->get( 'Version' ),
			'Platform'       => 'WordPress',
		);
	}
}
