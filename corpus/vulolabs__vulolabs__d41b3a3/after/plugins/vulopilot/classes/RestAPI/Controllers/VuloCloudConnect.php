<?php
/**
 * VuloCloudConnect controller file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\RestAPI\Controllers;

use VuloPilot\Services\VuloCloudConnection;

defined( 'ABSPATH' ) || exit;

/**
 * Backs the generic "Connect to VuloCloud" button (VULOPILOT_VULOCLOUD_CONFIG)
 * — completely independent from Controllers\AiCredits/AiProviders' own
 * VuloCloud connection: a real `GET .../status`, a real
 * `GET .../broker-authorize-url` (the URL the Connect button itself
 * navigates the browser to — same shape AiProviders::get_broker_authorize_url()
 * already establishes for its own, unrelated connection), and a real
 * `POST .../disconnect`.
 *
 * Same "never let a raw secret reach the client" boundary every other
 * connection controller in this plugin documents — every method here
 * only ever returns VuloCloudConnection::get_status()'s shape.
 *
 * @class       VuloCloudConnect controller
 * @version     1.0.0
 * @author      VuloLabs
 */
class VuloCloudConnect extends \WP_REST_Controller {

    /**
     * REST base for this controller's routes.
     *
     * @var string
     */
    protected $rest_base = 'vulocloud-connect';

    /**
     * Registers this controller's routes.
     *
     * @inheritDoc
     */
    public function register_routes() {
        register_rest_route(
            VuloPilot()->rest_namespace,
            '/' . $this->rest_base . '/status',
            array(
                array(
                    'methods'             => \WP_REST_Server::READABLE,
                    'callback'            => array( $this, 'get_status' ),
                    'permission_callback' => array( $this, 'permissions_check' ),
                ),
            )
        );

        register_rest_route(
            VuloPilot()->rest_namespace,
            '/' . $this->rest_base . '/broker-authorize-url',
            array(
                array(
                    'methods'             => \WP_REST_Server::READABLE,
                    'callback'            => array( $this, 'get_broker_authorize_url' ),
                    'permission_callback' => array( $this, 'permissions_check' ),
                ),
            )
        );

        register_rest_route(
            VuloPilot()->rest_namespace,
            '/' . $this->rest_base . '/disconnect',
            array(
                array(
                    'methods'             => \WP_REST_Server::CREATABLE,
                    'callback'            => array( $this, 'disconnect' ),
                    'permission_callback' => array( $this, 'permissions_check' ),
                ),
            )
        );
    }

    /**
     * Same manage_options gate every other VuloPilot REST route uses.
     *
     * @param \WP_REST_Request $request Full request object.
     * @return bool
     */
    public function permissions_check( $request ) {
        return current_user_can( 'manage_options' );
    }

    /**
     * `GET .../status`.
     *
     * @return \WP_REST_Response
     */
    public function get_status() {
        return rest_ensure_response( ( new VuloCloudConnection() )->get_status() );
    }

    /**
     * The URL the "Connect to VuloCloud" button itself 302s the browser
     * to — VuloCloudConnection::get_broker_authorize_url()'s own docblock
     * for the full passwordless sequence this kicks off.
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function get_broker_authorize_url() {
        $url = ( new VuloCloudConnection() )->get_broker_authorize_url();

        if ( ! $url ) {
            return new \WP_Error( 'vulopilot_vulocloud_connect_not_configured', __( 'VuloCloud isn’t configured for this build yet.', 'vulopilot' ), array( 'status' => 400 ) );
        }

        return rest_ensure_response( array( 'url' => $url ) );
    }

    /**
     * `POST .../disconnect`.
     *
     * @return \WP_REST_Response
     */
    public function disconnect() {
        $connection = new VuloCloudConnection();
        $connection->disconnect();

        return rest_ensure_response( $connection->get_status() );
    }
}
