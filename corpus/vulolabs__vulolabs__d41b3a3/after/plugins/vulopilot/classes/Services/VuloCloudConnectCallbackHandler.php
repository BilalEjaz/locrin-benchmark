<?php
/**
 * VuloCloudConnectCallbackHandler class file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\Services;

defined( 'ABSPATH' ) || exit;

/**
 * Handles the generic VuloCloudConnection broker's real redirect back to
 * this site (`admin-post.php?action=vulopilot_vulocloud_connect_callback`
 * — VuloCloudConnection::get_broker_redirect_uri()'s own exact URL). A
 * separate action name (and class) from ConnectBrokerCallbackHandler's
 * own AI-Credits callback — same reasoning as VuloCloudConnection's own
 * docblock: two entirely independent connections, each needs its own
 * callback. Kept as its own tiny class for the same reason
 * ConnectBrokerCallbackHandler is: this hook must be registered
 * unconditionally at plugin boot (VuloPilot.php's init_classes()), not
 * lazily inside a REST controller that's only ever instantiated on
 * `rest_api_init` — a request to `admin-post.php` never fires that hook
 * at all.
 *
 * @class       VuloCloudConnectCallbackHandler class
 * @version     1.0.0
 * @author      VuloLabs
 */
class VuloCloudConnectCallbackHandler {

	/**
	 * Registers this callback's own admin-post.php action hook.
	 */
	public function __construct() {
		add_action( 'admin_post_vulopilot_vulocloud_connect_callback', array( $this, 'handle_callback' ) );
	}

	/**
	 * Verifies the real `state` nonce, exchanges the real `code` for a
	 * ConnectedSite credential (VuloCloudConnection::exchange_broker_code()),
	 * then redirects back to Settings with a real success/error query flag.
	 * Never renders its own page, same "redirect back into the SPA" shape
	 * ConnectBrokerCallbackHandler already uses.
	 *
	 * @return void
	 */
	public function handle_callback(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to do this.', 'vulopilot' ) );
		}

		$redirect_base = admin_url( 'admin.php?page=vulopilot#&tab=settings' );
		$connection    = new VuloCloudConnection();

		$state = isset( $_GET['state'] ) ? sanitize_text_field( wp_unslash( $_GET['state'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- this IS the real CSRF guard, verified explicitly below via verify_broker_state().
		$error = isset( $_GET['error'] ) ? sanitize_text_field( wp_unslash( $_GET['error'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- this is the broker's own redirect back to us, not a form submission; `state` (verified below) is this flow's real CSRF guard.

		if ( '' !== $error ) {
			wp_safe_redirect( $redirect_base . '&vulocloud_connect_status=error' );
			exit;
		}

		$code = isset( $_GET['code'] ) ? sanitize_text_field( wp_unslash( $_GET['code'] ) ) : ''; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- this whole request only carries a `code` because it came from a `state`-nonced authorize URL we generated ourselves; verified below via verify_broker_state().

		if ( '' === $code || ! $connection->verify_broker_state( $state ) ) {
			wp_safe_redirect( $redirect_base . '&vulocloud_connect_status=error' );
			exit;
		}

		$result = $connection->exchange_broker_code( $code );

		wp_safe_redirect( $redirect_base . '&vulocloud_connect_status=' . ( is_wp_error( $result ) ? 'error' : 'connected' ) );
		exit;
	}
}
