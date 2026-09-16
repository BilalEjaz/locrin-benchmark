<?php

declare(strict_types=1);

namespace Reporting\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use function Laravel\Prompts\confirm;
use function Laravel\Prompts\text;
use Reporting\Consts\Reporting;

final class InstallCommand extends Command
{
    protected $signature = Reporting::NAME . ':install';

    protected $description = 'Publish the Reporting config and configure where its resources appear in navigation';

    public function handle(): int
    {
        $configPath = config_path('reporting.php');

        if (! is_file($configPath)) {
            $this->components->info('Publishing config/reporting.php...');

            Artisan::call('vendor:publish', ['--tag' => 'reporting-config']);
        } else {
            $this->components->info('config/reporting.php already exists — leaving its other settings untouched.');
        }

        if (! is_file($configPath)) {
            $this->components->error('config/reporting.php was not published. Publish it manually and re-run.');

            return self::FAILURE;
        }

        $this->configureNavigation($configPath);

        $this->components->info(
            'Done. Run `php artisan config:clear` if config caching is enabled in this environment.'
        );

        return self::SUCCESS;
    }

    private function configureNavigation(string $configPath): void
    {
        $nestUnderExistingCluster = confirm(
            label: 'Nest Reporting resources under one of your own Filament clusters?',
            default: false,
            hint: 'Say no to use this package\'s own built-in "Reporting" cluster.',
        );

        $cluster = $nestUnderExistingCluster
            ? text(
                label: 'Cluster class (FQCN)',
                placeholder: 'App\\Filament\\Clusters\\Operations',
                required: true,
            )
            : null;

        $group = text(
            label: 'Navigation group label for the Reporting resources (leave blank to skip)',
            hint: 'Only applies to resources that aren\'t nested in a cluster.',
        );

        $this->writeNavigationConfig($configPath, $cluster, blank($group) ? null : $group);

        $this->components->info('Navigation settings saved to config/reporting.php.');
    }

    private function writeNavigationConfig(string $configPath, ?string $cluster, ?string $group): void
    {
        $contents = (string) file_get_contents($configPath);

        if (! str_contains($contents, "'navigation' =>")) {
            $contents = $this->appendNavigationBlock($contents, $cluster, $group);

            file_put_contents($configPath, $contents);

            return;
        }

        $contents = preg_replace(
            "/'cluster' => [^,]+,/",
            "'cluster' => " . $this->exportValue($cluster) . ',',
            $contents,
            limit: 1,
        ) ?? $contents;

        $contents = preg_replace(
            "/'group' => [^,]+,/",
            "'group' => " . $this->exportValue($group) . ',',
            $contents,
            limit: 1,
        ) ?? $contents;

        file_put_contents($configPath, $contents);
    }

    private function appendNavigationBlock(string $contents, ?string $cluster, ?string $group): string
    {
        $block = sprintf(
            "\n    'navigation' => [\n        'cluster' => %s,\n        'group' => %s,\n    ],\n];\n",
            $this->exportValue($cluster),
            $this->exportValue($group),
        );

        $lastArrayClose = mb_strrpos($contents, '];');

        if ($lastArrayClose === false) {
            return $contents . $block;
        }

        return mb_substr($contents, 0, $lastArrayClose) . $block;
    }

    private function exportValue(?string $value): string
    {
        return $value === null ? 'null' : var_export($value, true);
    }
}
