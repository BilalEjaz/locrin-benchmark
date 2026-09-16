<?php

return [

    /*
    | Queue used by all importer jobs. The queue connection must not be "sync"
    | (jobs wait for the CJ daily quota by releasing themselves). Run a single
    | worker on it with a timeout that covers the longest job:
    | php artisan queue:work --queue=cjdropshipping --timeout=3600
    | and set the connection's "retry_after" (config/queue.php) above 3600.
    */
    'queue' => env('CJ_IMPORT_QUEUE', 'cjdropshipping'),

    /*
    | Maximum CJdropshipping API requests per second made by this package
    | (Free 1, Plus 2, Prime 4, Advanced 6). 0 disables throttling.
    */
    'requests_per_second' => (int) env('CJ_REQUESTS_PER_SECOND', 1),

    'schedule' => [
        'enabled' => (bool) env('CJ_SCHEDULE_ENABLED', true),
        'discover' => 'daily',
        'sync' => 'everySixHours',
    ],

    'sync' => [
        'stale_after_hours' => 6,
        'not_found_threshold' => 2,
        // 'out_of_stock' keeps the product published with zero stock; 'draft' also unpublishes it.
        'unavailable_action' => 'out_of_stock',
    ],

    'webhooks' => [
        'path' => 'cjdropshipping/webhook',
        'dedupe_ttl_hours' => 48,
    ],

    'media' => [
        // null uses config('lunar.media.collection').
        'collection' => null,
    ],

    'pricing' => [
        // Value of 1 USD in the store default currency; used only when no USD currency exists in Lunar.
        'usd_to_default_rate' => env('CJ_USD_TO_DEFAULT_RATE'),
        // Locked listing prices whose margin falls below this percentage are flagged "margin at risk" on sync.
        'min_margin_percent' => 20,
        // Card payment fee deducted when showing listing profit: percent of the price plus a fixed
        // amount, in the major units of each listing's currency (e.g. 0.20 = 20 cents for USD/GBP/EUR).
        // Adjust it for currencies whose major unit is worth very different amounts (e.g. JPY, VND).
        'card_fee_percent' => 1.5,
        'card_fee_fixed' => 0.20,
    ],

    'freight' => [
        // Seconds CJ shipping quotes are cached per product, origin and destination.
        'cache_ttl' => 21600,
    ],

    // null uses the application default log channel.
    'log_channel' => env('CJ_LOG_CHANNEL'),

];
