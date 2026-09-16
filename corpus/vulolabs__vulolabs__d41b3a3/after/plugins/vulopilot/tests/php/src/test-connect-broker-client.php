<?php
/**
 * ConnectBrokerClient test file.
 *
 * @package VuloPilot
 */

namespace VuloPilot\Tests;

use Brain\Monkey\Functions;
use VuloPilot\Services\ConnectBrokerClient;

require_once __DIR__ . '/TestCase.php';

/**
 * Real unit tests over ConnectBrokerClient::get_authorize_url()'s own
 * query-building logic — specifically that the legacy (soloOrganizationId)
 * and generic (pluginId/organizationId/brandId) shapes stay independent:
 * neither leaks the other's params into the query string when unused.
 *
 * @class       TestConnectBrokerClient class
 * @version     1.0.0
 * @author      VuloLabs
 */
class TestConnectBrokerClient extends TestCase {

    /**
     * @return void
     */
    protected function setUp(): void {
        parent::setUp();
        Functions\when( 'untrailingslashit' )->alias(
            static fn( string $value ) => rtrim( $value, '/' )
        );
    }

    /**
     * @return void
     */
    public function test_legacy_shape_omits_generic_params(): void {
        $client = new ConnectBrokerClient( 'https://cloud.example.com' );

        $url = $client->get_authorize_url( 'https://site.example.com', 'https://site.example.com/callback', 'state-123', '' );

        $this->assertStringNotContainsString( 'pluginId=', $url );
        $this->assertStringNotContainsString( 'organizationId=', $url );
        $this->assertStringNotContainsString( 'brandId=', $url );
        $this->assertStringNotContainsString( 'soloOrganizationId=', $url );
    }

    /**
     * @return void
     */
    public function test_legacy_shape_includes_solo_organization_id_when_set(): void {
        $client = new ConnectBrokerClient( 'https://cloud.example.com' );

        $url = $client->get_authorize_url( 'https://site.example.com', 'https://site.example.com/callback', 'state-123', 'org-legacy' );

        $this->assertStringContainsString( 'soloOrganizationId=org-legacy', $url );
        $this->assertStringNotContainsString( 'pluginId=', $url );
    }

    /**
     * @return void
     */
    public function test_generic_shape_includes_plugin_and_organization_id(): void {
        $client = new ConnectBrokerClient( 'https://cloud.example.com' );

        $url = $client->get_authorize_url(
            'https://site.example.com',
            'https://site.example.com/callback',
            'state-123',
            '',
            'vulopilot',
            'org-abc',
            'brand-xyz'
        );

        $this->assertStringContainsString( 'pluginId=vulopilot', $url );
        $this->assertStringContainsString( 'organizationId=org-abc', $url );
        $this->assertStringContainsString( 'brandId=brand-xyz', $url );
        $this->assertStringNotContainsString( 'soloOrganizationId=', $url );
    }

    /**
     * @return void
     */
    public function test_generic_shape_omits_brand_id_when_empty(): void {
        $client = new ConnectBrokerClient( 'https://cloud.example.com' );

        $url = $client->get_authorize_url(
            'https://site.example.com',
            'https://site.example.com/callback',
            'state-123',
            '',
            'multivendorx',
            'org-abc'
        );

        $this->assertStringContainsString( 'pluginId=multivendorx', $url );
        $this->assertStringContainsString( 'organizationId=org-abc', $url );
        $this->assertStringNotContainsString( 'brandId=', $url );
    }

    /**
     * @return void
     */
    public function test_broker_url_trailing_slash_is_stripped(): void {
        $client = new ConnectBrokerClient( 'https://cloud.example.com/' );

        $url = $client->get_authorize_url( 'https://site.example.com', 'https://site.example.com/callback', 'state-123', '' );

        $this->assertStringStartsWith( 'https://cloud.example.com/plugin/connect/authorize?', $url );
    }
}
