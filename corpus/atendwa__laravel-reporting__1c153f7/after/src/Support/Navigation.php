<?php

declare(strict_types=1);

namespace Reporting\Support;

use Reporting\Filament\Clusters\Reporting as ReportingCluster;

final class Navigation
{
    /**
     * @return class-string
     */
    public static function cluster(): string
    {
        $cluster = config('reporting.navigation.cluster');

        return is_string($cluster) && $cluster !== '' ? $cluster : ReportingCluster::class;
    }

    public static function group(): ?string
    {
        $group = config('reporting.navigation.group');

        return is_string($group) && $group !== '' ? $group : null;
    }
}
