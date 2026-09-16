<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Lunar\Models\Currency;

/**
 * Currency each site (Lunar channel) sells in. Reads the optional `storefront_channels` table when present;
 * other channels use the Lunar default currency. Rebind in the container to customise.
 */
final class SiteCurrencies
{
    /**
     * @param  array<int, int>  $channelIds
     * @return array<int, string> channel id => currency code
     */
    public function for(array $channelIds): array
    {
        $default = Currency::getDefault()?->code;
        $codes = [];

        foreach ($channelIds as $channelId) {
            if ($default !== null) {
                $codes[(int) $channelId] = $default;
            }
        }

        if ($channelIds === [] || ! Schema::hasTable('storefront_channels')) {
            return $codes;
        }

        $currencies = (new Currency)->getTable();

        $rows = DB::table('storefront_channels')
            ->join($currencies, "{$currencies}.id", '=', 'storefront_channels.currency_id')
            ->whereIn('storefront_channels.channel_id', $channelIds)
            ->pluck("{$currencies}.code", 'storefront_channels.channel_id');

        foreach ($rows as $channelId => $code) {
            $codes[(int) $channelId] = (string) $code;
        }

        return $codes;
    }
}
