<?php
/**
 * ConnectBrokerClient class file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\Services;

defined( 'ABSPATH' ) || exit;

/**
 * HTTP client for VuloCloud's `/plugin/connect/*` broker endpoints — the
 * passwordless "Connect to VuloCloud" flow: this site's browser is
 * redirected to a real VuloCloud-hosted login/signup page instead of ever
 * typing a VuloCloud password into a form this plugin itself renders.
 * Mirrors GoogleOAuthBrokerClient exactly (same "authorize is a plain URL
 * build, only exchange is a real server-to-server call" shape) — see that
 * class's own docblock.
 *
 * @class       ConnectBrokerClient class
 * @version     1.0.0
 * @author      VuloLabs
 */
class ConnectBrokerClient {

	/** @var string e.g. https://cloud.vulolabs.com (no trailing slash) */
	private $broker_url;

	public function __construct( string $broker_url ) {
		$this->broker_url = untrailingslashit( $broker_url );
	}

	/**
	 * Browser-facing URL only — VuloCloud itself records `$return_uri`
	 * (this site's own admin-post.php callback) against a broker-generated
	 * correlation id and 302s straight to its own hosted login/signup page,
	 * so it knows where to send the browser back once a human actually
	 * authenticates there. `$state` is this site's own opaque CSRF nonce
	 * (AiCreditsConnection::encode_state()) — VuloCloud never inspects it,
	 * only echoes it back verbatim on the return redirect.
	 *
	 * `$solo_organization_id` is omitted from the query entirely when
	 * empty — VULOPILOT_VULOCLOUD_HOST_ORGANIZATION_ID's own docblock: the
	 * "solo site owner" choice is simply unavailable on a build that hasn't
	 * set it, and the hosted page only offers that choice when this param
	 * is actually present. `AiCreditsConnection` is the one caller of
	 * this legacy shape and never passes the three new params below.
	 *
	 * `$plugin_id`/`$organization_id`/`$brand_id` are the generic "connect
	 * to a pre-known Organization + Brand" shape (VuloCloudConnection's
	 * own caller) — all three optional here purely so this one method can
	 * serve both shapes; `$plugin_id`+`$organization_id` are required
	 * together server-side (see ConnectBrokerAuthorizeQueryDto's own
	 * doc comment on the vulocloud side), `$brand_id` independently
	 * optional. Omitted from the query entirely when empty, same
	 * "unavailable, not silently blank" treatment `$solo_organization_id`
	 * already gets.
	 *
	 * @param string $domain               This site's own home_url().
	 * @param string $return_uri            This site's own admin-post.php callback.
	 * @param string $state                 This site's own opaque CSRF nonce.
	 * @param string $solo_organization_id  Legacy shape — VULOPILOT_VULOCLOUD_HOST_ORGANIZATION_ID, or ''.
	 * @param string $plugin_id             Generic shape — this plugin's own identity, or ''.
	 * @param string $organization_id       Generic shape — the pre-known Organization to connect to, or ''.
	 * @param string $brand_id              Generic shape — the pre-known Brand to connect to, or ''.
	 * @return string
	 */
	public function get_authorize_url( string $domain, string $return_uri, string $state, string $solo_organization_id, string $plugin_id = '', string $organization_id = '', string $brand_id = '' ): string {
		$params = array(
			'domain'    => $domain,
			'returnUri' => $return_uri,
			'state'     => $state,
		);

		if ( '' !== $solo_organization_id ) {
			$params['soloOrganizationId'] = $solo_organization_id;
		}

		if ( '' !== $plugin_id ) {
			$params['pluginId'] = $plugin_id;
		}

		if ( '' !== $organization_id ) {
			$params['organizationId'] = $organization_id;
		}

		if ( '' !== $brand_id ) {
			$params['brandId'] = $brand_id;
		}

		return $this->broker_url . '/plugin/connect/authorize?' . http_build_query( $params );
	}

	/**
	 * Real `POST {broker}/plugin/connect/exchange` — redeems the
	 * single-use, short-lived `code` VuloCloud's own redirect handed back
	 * to this site's admin-post.php callback for the real ConnectedSite
	 * credential VuloCloud minted on this site's behalf (via whichever
	 * human actually logged in/registered on its own hosted page).
	 *
	 * @return array{siteId: string, siteSecret: string, credits: int}|\WP_Error
	 */
	public function exchange( string $domain, string $code ) {
		$response = wp_remote_post(
			$this->broker_url . '/plugin/connect/exchange',
			array(
				'timeout' => 15,
				'headers' => array( 'Content-Type' => 'application/json' ),
				'body'    => wp_json_encode(
					array(
						'domain' => $domain,
						'code'   => $code,
					)
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			// DNS failure, connection refused, timeout, ... — the request never got a response at all.
			return $response;
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$body   = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		if ( ! is_array( $body ) ) {
			return new \WP_Error(
				'vulopilot_connect_broker_unparseable_response',
				sprintf(
					/* translators: %d: HTTP status code. */
					__( 'Connect broker returned a non-JSON response (HTTP %d).', 'vulopilot' ),
					$status
				)
			);
		}

		if ( $status < 200 || $status >= 300 || empty( $body['siteId'] ) || empty( $body['siteSecret'] ) ) {
			return new \WP_Error(
				'vulopilot_connect_broker_exchange_failed',
				$body['message'] ?? $body['error'] ?? __( 'Connect broker could not complete the connection.', 'vulopilot' )
			);
		}

		return array(
			'siteId'     => (string) $body['siteId'],
			'siteSecret' => (string) $body['siteSecret'],
			'credits'    => (int) ( $body['credits'] ?? 0 ),
		);
	}
}
