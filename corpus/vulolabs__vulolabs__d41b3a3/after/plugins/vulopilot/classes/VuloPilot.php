<?php
/**
 * VuloPilot class file.
 *
 * @package VuloPilot
 */

namespace VuloPilot;

defined( 'ABSPATH' ) || exit;

/**
 * VuloPilot Class.
 *
 * Plugin bootstrap singleton — same plain-array-container + magic
 * __get/__set shape as VuloLabs\VuloLabs. VuloPilot is not
 * WooCommerce-bound (unlike the vulolabs family), so unlike
 * VuloLabs::init_plugin() this does not gate on 'woocommerce_loaded'
 * or declare HPOS compatibility — it boots on 'plugins_loaded' directly.
 *
 * @class       VuloPilot class
 * @version     1.0.0
 * @author      VuloLabs
 */
final class VuloPilot {

    /**
     * Holds the single instance of the class (singleton pattern).
     *
     * @var self|null
     */
    private static $instance = null;

    /**
     * The main plugin file path.
     *
     * @var string
     */
    private $file = '';

    /**
     * Container for shared class instances and config values.
     *
     * @var array
     */
    private $container = array();

    /**
     * Class constructor.
     *
     * @param string $file Main plugin file path.
     */
    public function __construct( $file ) {
        require_once trailingslashit( dirname( $file ) ) . '/config.php';

        $this->file                        = $file;
        $this->container['plugin_url']     = trailingslashit( plugins_url( '', $file ) );
        $this->container['plugin_path']    = trailingslashit( dirname( $file ) );
        $this->container['plugin_base']    = plugin_basename( $file );
        $this->container['version']        = VULOPILOT_PLUGIN_VERSION;
        $this->container['rest_namespace'] = 'vulopilot/v1';
        $this->container['plugin_slug']    = VULOPILOT_PLUGIN_SLUG;

        register_activation_hook( $file, array( $this, 'activate' ) );
        register_deactivation_hook( $file, array( $this, 'deactivate' ) );

        add_action( 'plugins_loaded', array( $this, 'init_plugin' ) );
        add_action( 'init', array( $this, 'load_plugin_textdomain' ) );
    }

    /**
     * Runs on plugin activation. Sets a flag rather than creating tables
     * directly — register_activation_hook() fires before 'plugins_loaded',
     * earlier than dbDelta()'s upgrade.php include and Utill's autoloaded
     * class are guaranteed available, so table creation is deferred to
     * init_plugin() where that's no longer a concern.
     *
     * @return void
     */
    public function activate() {
        add_option( Utill::VULOPILOT_OTHER_SETTINGS['run_installer'], true );
        // A no-op if this site already has an active-module list (e.g. a
        // deactivate/reactivate cycle) — only seeds 'geo'/'seo'/
        // 'content-intelligence'/'brand-intelligence'/'entity-extraction'/
        // 'ai-copilot' as active for a genuinely fresh install, matching
        // Install.php's own migration for sites upgrading in place instead.
        add_option( Utill::ACTIVE_MODULES_DB_KEY, array( 'geo', 'seo', 'content-intelligence', 'brand-intelligence', 'entity-extraction', 'ai-copilot' ) );
        flush_rewrite_rules();
    }

    /**
     * Runs on plugin deactivation.
     *
     * @return void
     */
    public function deactivate() {
        flush_rewrite_rules();
    }

    /**
     * Boots the plugin once every other active plugin has loaded.
     *
     * Previously only ran Install() on the one-time `run_installer` flag
     * set at activation — meaning a table added in a later plugin version
     * (Install.php's own `create_database_tables()` gains one every so
     * often, most recently `vulopilot_brand_mentions`) would never
     * actually get created on a site that activated an older version and
     * simply auto-updated since, since that flag is deleted the moment it
     * fires once and nothing ever sets it again. Also re-running whenever
     * the stored `plugin_db_version` doesn't match this code's own
     * VULOPILOT_PLUGIN_VERSION closes that gap — the standard "version-gate
     * an idempotent migration" idiom, safe for the same reason Install's
     * own class docblock already gives for calling create_database_tables()
     * unconditionally (every table it creates is a plain `CREATE TABLE IF
     * NOT EXISTS`).
     *
     * @return void
     */
    public function init_plugin() {
        add_action( 'init', array( $this, 'init_classes' ), 0 );

        $needs_install = get_option( Utill::VULOPILOT_OTHER_SETTINGS['run_installer'] )
            || get_option( Utill::VULOPILOT_OTHER_SETTINGS['plugin_db_version'] ) !== VULOPILOT_PLUGIN_VERSION;

        if ( $needs_install ) {
            new Install();
            delete_option( Utill::VULOPILOT_OTHER_SETTINGS['run_installer'] );
        }
    }

    /**
     * Initializes VuloPilot classes and fires 'vulopilot_loaded', the hook
     * VuloPilot Pro (and any third-party extension) gates its own boot on —
     * the same boot-order-gate pattern a shared-platform architecture would
     * use, just scoped to this product line.
     *
     * @return void
     */
    public function init_classes() {
        $this->container['util']            = new Utill();
        $this->container['admin']           = new Admin();
        $this->container['frontendScripts'] = new FrontendScripts();

        // Module loader (module-architecture.md) — loaded before every
        // registry below so a module's own constructor (e.g. registering
        // itself via `vulopilot_scanner_sources`) runs before those
        // registries' own `init` priority 20 hooks read those filters.
        $this->container['modules'] = new Modules();
        $this->container['modules']->load_active_modules();

        $this->container['scanner_registry'] = new Scanners\ScannerRegistry();
        $this->container['scan_runner']      = new Scanners\ScanRunner( $this->container['scanner_registry'] );

        $this->container['rule_registry'] = new RuleEngine\RuleRegistry();
        $this->container['rule_engine']   = new RuleEngine\RuleEngine( $this->container['rule_registry'] );

        $this->container['scan_persistence'] = new Services\ScanPersistenceListener();

        // "Manual Actions Only" (readme.txt) — Free's own small, engine-free
        // counterpart to vulopilot-pro's Automations module; see
        // Automations\ManualActionRunner's own docblock for why this doesn't
        // reuse rule_engine at all.
        $this->container['manual_action_registry'] = new Automations\ActionRegistry();
        $this->container['manual_action_runner']   = new Automations\ManualActionRunner( $this->container['manual_action_registry'] );

        // The full, Recommendation-driven AutomationEngine (conditional
        // trigger→condition→action workflows) is still Pro business logic —
        // "AI Automation Workflows" per the plugin's own readme. It lives in
        // vulopilot-pro's Automations module, constructed with this same
        // rule_engine/scan_runner instance via VuloPilot()->rule_engine /
        // VuloPilot()->scan_runner. Free's own two fixed, schedule-only
        // automations ("Run Full Site Scan"/"Send Visibility Report" — see
        // Automations\BuiltinAutomationSeeder's own docblock) are seeded and
        // run below, independent of that Pro engine.

        $this->container['report_type_registry']     = new Reports\ReportTypeRegistry();
        $this->container['report_exporter_registry'] = new Reports\ReportExporterRegistry();
        $this->container['report_generator']         = new Reports\ReportGenerator(
            $this->container['report_type_registry'],
            $this->container['report_exporter_registry']
        );
        // Reports\ScheduledReportRunner (recurring/emailed reports) is Pro
        // business logic now — it lives in vulopilot-pro's AdvancedReports
        // module, constructed with this same report_generator instance via
        // VuloPilot()->report_generator.

        $this->container['builtin_automation_seeder'] = new Automations\BuiltinAutomationSeeder();
        $this->container['automation_scheduler']       = new Services\AutomationScheduler(
            $this->container['scan_runner'],
            $this->container['report_generator']
        );

        $this->container['rest'] = new RestAPI\Rest();

        $this->container['ai_provider_registry'] = new AIProviders\ProviderRegistry();
        $this->container['ai_safety_validator']  = new AIProviders\Safety\AISafetyValidator();
        $this->container['ai_request_sender']    = new AIProviders\Support\SafeRequestSender(
            $this->container['ai_provider_registry'],
            $this->container['ai_safety_validator']
        );

        $this->container['ai_action_registry'] = new AIActions\ActionRegistry();
        $this->container['ai_action_runner']   = new AIActions\ActionRunner(
            $this->container['ai_action_registry'],
            $this->container['ai_request_sender']
        );

        // GEO module (GEO-MODULE.md) — reuses the same ai_request_sender
        // every AIAction goes through, not a second AI-calling path.
        $this->container['geo_analyzer'] = new GeoAnalysis\GeoAnalyzer( $this->container['ai_request_sender'] );

        // Content Intelligence's "Topic Authority" (CONTENT-INTELLIGENCE-MODULE.md)
        // — same shape as geo_analyzer above: reuses the same
        // ai_request_sender, constructed unconditionally in Free even
        // though the REST route that actually calls analyze() (a real AI
        // cost) lives in vulopilot-pro's own ContentIntelligence module.
        $this->container['content_analyzer'] = new ContentIntelligence\ContentAnalyzer( $this->container['ai_request_sender'] );

        // llms.txt Generation & Management (readme.txt) — self-registers
        // its own rewrite-rule/template_redirect hooks; unconditional
        // construction, the enable_llms_txt setting only gates serving.
        $this->container['llms_txt_generator'] = new GeoAnalysis\LlmsTxtGenerator();

        // AI Crawler Traffic Monitoring (readme.txt) — self-registers its
        // own template_redirect/cron hooks; unconditional construction,
        // same shape as llms_txt_generator above.
        $this->container['crawler_traffic_logger'] = new Services\CrawlerTrafficLogger();

        // Scanning → Sitemap/Robots.txt cards — both wrap WordPress core's
        // own native sitemap/robots.txt rather than building either from
        // scratch; self-register their own hooks, same unconditional-
        // construction shape as the two services above. HtmlSitemapRenderer
        // is the one genuinely new (non-core-wrapping) piece — a real
        // `[vulopilot_html_sitemap]` shortcode.
        $this->container['sitemap_manager']       = new Services\SitemapManager();
        $this->container['robots_txt_manager']    = new Services\RobotsTxtManager();
        $this->container['html_sitemap_renderer'] = new Services\HtmlSitemapRenderer();

        // Scanning → SEO & Content → Tag Manager — real Google Tag Manager
        // `<script>`/`<noscript>` output (wp_head/wp_body_open), same
        // unconditional-construction/settings-gate-output shape as
        // WebmasterToolsManager immediately below.
        $this->container['tag_manager_service'] = new Services\TagManagerService();

        // Scanning → Webmaster Tools — real `wp_head` verification `<meta>`
        // tag output, same unconditional-construction/settings-gate-output
        // shape as CanonicalUrlManager/SocialMetaTagsManager below.
        $this->container['webmaster_tools_manager'] = new Services\WebmasterToolsManager();

        // Connections → Google Services (Search Console/Analytics/AdSense) —
        // real Google OAuth 2.0 redirect handler (self-registers its own
        // `admin_post_*` hook; must be unconditional, not REST-lazy — see
        // that class's own docblock) and real `gtag.js` output once a GA4
        // property is connected. GoogleServicesConnection/GoogleAnalyticsClient/
        // GoogleAdSenseClient are all stateless and instantiated fresh
        // wherever needed (Controllers\GoogleServices), same as every
        // other Services\* class that doesn't need its own hooks.
        $this->container['gsc_oauth_callback_handler'] = new Services\GoogleSearchConsoleOAuthCallbackHandler();
        $this->container['google_analytics_tracker']   = new Services\GoogleAnalyticsTracker();

        // Connections → AI Providers' own passwordless "Connect to
        // VuloCloud" broker redirect handler — same unconditional-
        // construction/self-registers-its-own-admin_post-hook reasoning as
        // gsc_oauth_callback_handler immediately above (a request to
        // admin-post.php never fires rest_api_init, so this can't be
        // lazily instantiated inside a REST controller).
        $this->container['connect_broker_callback_handler'] = new Services\ConnectBrokerCallbackHandler();

        // Connections → the generic "connect to a pre-known Organization +
        // Brand" broker redirect handler (VULOPILOT_VULOCLOUD_CONFIG) — a
        // separate, independent connection from the AI Credits one
        // immediately above, hence its own callback handler/admin-post
        // action rather than reusing that one. Same unconditional-
        // construction reasoning.
        $this->container['vulocloud_connect_callback_handler'] = new Services\VuloCloudConnectCallbackHandler();

        // SEO & Visibility → Keywords' real rank-tracking sync (daily cron
        // + Controllers\KeywordRankings::sync()'s own "Sync now") — same
        // unconditional-construction/self-registers-its-own-cron-hook
        // shape as performance_score_snapshot_recorder below, just against
        // a real Search Console property instead of local findings.
        $this->container['keyword_rankings_sync_service'] = new Services\KeywordRankingsSyncService();

        // Scanning → Instant Indexing (IndexNow) — real key-file serving
        // (self-registers its own rewrite-rule/template_redirect hooks,
        // same shape as llms_txt_generator above) and automatic submission
        // on publish/update/trash, gated by their own settings.
        $this->container['indexnow_key_file_server'] = new Services\IndexNowKeyFileServer();
        $this->container['indexnow_auto_submitter']  = new Services\IndexNowAutoSubmitter();

        // Connections → AI Providers' "Site tone" field — learned
        // automatically from the site's own recent content on
        // publish/update (deferred via WP-Cron, never inline with the
        // save), reusing the same ai_request_sender every AIAction/
        // geo_analyzer/content_analyzer already goes through. Self-
        // registers its own save_post/cron hooks, same unconditional-
        // construction shape as indexnow_auto_submitter above.
        $this->container['site_tone_learner'] = new Services\SiteToneLearner( $this->container['ai_request_sender'] );

        // One-Click Fix coverage pass for the SEO category (vulopilot-pro's
        // OneClickFix\ScannerFixMap) — the mechanical (non-AI) fixes for
        // CanonicalUrlScanner/OpenGraphScanner/TwitterCardScanner just flip
        // one of these two managers' own settings on; SchemaJsonLdRenderer
        // is what makes AIActions\Actions\GenerateSchemaAction's saved
        // JSON-LD actually reach the frontend. Same unconditional-
        // construction, settings-gate-the-output shape as the two services
        // above.
        $this->container['canonical_url_manager']    = new Services\CanonicalUrlManager();
        $this->container['social_meta_tags_manager'] = new Services\SocialMetaTagsManager();
        $this->container['schema_json_ld_renderer']  = new Services\SchemaJsonLdRenderer();
        // Sitewide counterpart to schema_json_ld_renderer, for
        // SchemaScanner's homepage-level check — populated by
        // vulopilot-pro's OneClickFix `generate-homepage-schema` fix.
        $this->container['homepage_schema_renderer'] = new Services\HomepageSchemaRenderer();

        // Post-editor SEO metabox ("Meta Box Appearing in Single Posts &
        // Pages" — readme's research into rankmath.com/kb/on-page-seo/):
        // Advanced tab's noindex/nofollow output (PostRobotsMetaManager)
        // and the Block Editor sidebar's asset loader (PostEditorAssets).
        // Both unconditional construction, same shape as every Services\*
        // above — nothing to gate behind a setting, only per-post data.
        $this->container['post_seo_meta_fields']     = new Services\PostSeoMetaFields();
        $this->container['post_robots_meta_manager'] = new Services\PostRobotsMetaManager();
        $this->container['post_editor_assets']       = new Services\PostEditorAssets();

        // Gutenberg blocks — `vulopilot/table-of-contents` and
        // `vulopilot/faq` (src/blocks/), discovered and registered the
        // same glob-the-built-output way the sibling free plugin
        // vulocart's own VuloCart\Block class already does.
        // HeadingAnchorInjector is its own class (not folded into
        // BlockRegistrar) since it's a real, separate cross-cutting
        // concern — rewriting core/heading output — not block
        // registration itself. Both unconditional construction, same
        // shape as every Services\* above: a core authoring primitive
        // every install should have in the inserter, not a Modules-system
        // toggle.
        $this->container['block_registrar']         = new Services\BlockRegistrar();
        $this->container['heading_anchor_injector'] = new Services\Blocks\HeadingAnchorInjector();

        // Redirects & 404s (readme.txt) — real functionality behind the
        // enable_redirect_manager/auto_redirect_on_slug_change/log_404s
        // settings, which previously only round-tripped through Settings
        // with nothing reading them. Same unconditional-construction,
        // settings-gate-the-hook-callback shape as every Services\* class
        // above.
        $this->container['redirect_manager'] = new Services\RedirectManager();
        $this->container['not_found_logger'] = new Services\NotFoundLogger();

        // "Performance" Overview — Speed History's daily score snapshots
        // (scan-completed + daily-cron triggered), Real-time Monitoring's
        // per-request timing sample (front-end `shutdown` hook), and the
        // two Quick Actions toggles (force-enable lazy loading, preload
        // critical resources). SecurityScoreSnapshotRecorder is the same
        // shape, one category over, for "Security"'s own SecurityTrendCard.tsx.
        // Same unconditional-construction, self-registers-its-own-hooks
        // shape as every Services\* class above.
        $this->container['performance_score_snapshot_recorder'] = new Services\PerformanceScoreSnapshotRecorder();
        $this->container['security_score_snapshot_recorder']    = new Services\SecurityScoreSnapshotRecorder();
        $this->container['performance_request_logger']          = new Services\PerformanceRequestLogger();
        $this->container['performance_optimizations']           = new Services\PerformanceOptimizations();

        // "Performance" Overview's PerformanceScoreCard.tsx redesign —
        // real Mobile/Desktop PageSpeed Insights scores (only when a
        // psi_api_key is configured) and real Core Web Vitals RUM (no key
        // needed, first-party). Same unconditional-construction,
        // self-registers-its-own-hooks shape as every Services\* class
        // above.
        $this->container['psi_fetcher']            = new Services\PageSpeedInsightsFetcher();
        $this->container['core_web_vitals_beacon'] = new Services\CoreWebVitalsBeacon();

        // "Performance" › Slow Pages — real per-page load-time checks
        // (plus real per-page PSI mobile/desktop scores when a psi_api_key
        // is configured), processed in the background via WP-Cron. Same
        // unconditional-construction, self-registers-its-own-hooks shape
        // as every Services\* class above.
        $this->container['page_speed_scanner'] = new Services\PageSpeedScanner();

        // Protect My Site's Malware/Firewall/Login Protection/Backups/
        // Recovery tiles — real, always-on core features (not a Modules-page
        // module: no `modules/` folder, no `Module.php` file, nothing added
        // to `vulopilot_module_sources`). Same unconditional-construction,
        // self-registers-its-own-hooks shape as every Services\* class
        // above. Each has its own companion Scanner (registered in
        // ScannerRegistry::get_default_scanner_classes()) so its real data
        // shows up in the exact same findings/scans/SecurityMetricsGrid
        // machinery every other Security tile already uses.
        $this->container['login_protection_guard'] = new Services\LoginProtectionGuard();
        $this->container['firewall_guard']         = new Services\FirewallGuard();
        $this->container['backup_manager']         = new Services\BackupManager();
        $this->container['backup_scheduler']       = new Services\BackupScheduler();

        // Backups' own real cloud-storage destination (Amazon S3/Google
        // Drive) — BackupStorageManager self-registers on
        // 'vulopilot_backup_completed' (fired by BackupManager above) and
        // must be unconditional, same reasoning every other
        // self-registers-its-own-hooks Services\* class here already has.
        // BackupGoogleDriveOAuthCallbackHandler is its own real OAuth
        // redirect handler, same "admin-post.php needs unconditional
        // construction, not REST-lazy" reasoning
        // gsc_oauth_callback_handler above already documents.
        $this->container['backup_storage_manager']               = new Services\BackupStorageManager();
        $this->container['backup_gdrive_oauth_callback_handler'] = new Services\BackupGoogleDriveOAuthCallbackHandler();

        // Extension SDK (ARCHITECTURE.md's Prompt 15) — vulopilot-pro and
        // any third-party plugin register here (`vulopilot_extension_sources`),
        // one tick before ScannerRegistry/RuleRegistry/etc. (all `init`
        // priority 20) read the per-concern filters an extension's own
        // register() call adds classes to.
        $this->container['extension_manager'] = new Sdk\ExtensionManager();

        if ( defined( 'WP_CLI' ) && WP_CLI ) {
            add_action( 'cli_init', array( Cli\VuloPilotCommand::class, 'register' ) );
        }

        do_action( 'vulopilot_loaded' );
    }

    /**
     * Loads translation files.
     *
     * @return void
     */
    public function load_plugin_textdomain() {
        if ( version_compare( $GLOBALS['wp_version'], '6.7', '<' ) ) {
            load_plugin_textdomain( 'vulopilot', false, plugin_basename( dirname( $this->file ) ) . '/languages' );
        } else {
            load_textdomain( 'vulopilot', WP_LANG_DIR . '/plugins/vulopilot-' . determine_locale() . '.mo' );
        }
    }

    /**
     * Magic getter for the container.
     *
     * @param string $class_name Container key to retrieve.
     * @return mixed
     * @throws \Exception If the requested key does not exist in the container.
     */
    public function __get( $class_name ) { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.classFound
        if ( array_key_exists( $class_name, $this->container ) ) {
            return $this->container[ $class_name ];
        }

        throw new \Exception( sprintf( 'Call to unknown class %s.', esc_html( $class_name ) ) );
    }

    /**
     * Magic setter for the container.
     *
     * @param string $class_name Container key to store under.
     * @param mixed  $value      Value to store.
     * @return void
     */
    public function __set( $class_name, $value ) { // phpcs:ignore Universal.NamingConventions.NoReservedKeywordParameterNames.classFound
        $this->container[ $class_name ] = $value;
    }

    /**
     * Returns the single instance of this class, creating it if necessary.
     *
     * @param string $file Main plugin file path.
     * @return self
     */
    public static function init( $file ) {
        if ( null === self::$instance ) {
            self::$instance = new self( $file );
        }

        return self::$instance;
    }
}
