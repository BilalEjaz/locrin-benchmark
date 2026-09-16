<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\ServiceProvider;

final class LunarCjDropshippingServiceProvider extends ServiceProvider
{
    private const CONFIG_PATH = __DIR__.'/../config/lunar-cjdropshipping.php';

    private const SCHEDULE_FREQUENCIES = ['everyMinute', 'everyTwoMinutes', 'everyFiveMinutes', 'everyTenMinutes', 'everyFifteenMinutes', 'everyThirtyMinutes', 'hourly', 'everyTwoHours', 'everyThreeHours', 'everyFourHours', 'everySixHours', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

    public function register(): void
    {
        $this->mergeConfigFrom(self::CONFIG_PATH, 'lunar-cjdropshipping');

        $this->app->singleton(Support\Throttle::class, fn () => new Support\Throttle((int) config('lunar-cjdropshipping.requests_per_second', 1)));

        $this->app->scoped(Pricing\VatResolver::class);

        $this->app->bind(Media\ImageDownloader::class, Media\HttpImageDownloader::class);
    }

    public function boot(): void
    {
        $this->loadMigrationsFrom(__DIR__.'/../database/migrations');
        $this->loadRoutesFrom(__DIR__.'/../routes/webhooks.php');
        $this->loadTranslationsFrom(__DIR__.'/../lang', 'lunar-cjdropshipping');
        $this->loadViewsFrom(__DIR__.'/../resources/views', 'lunar-cjdropshipping');

        if ($this->app->runningInConsole()) {
            $this->publishes([self::CONFIG_PATH => $this->app->configPath('lunar-cjdropshipping.php')], 'lunar-cjdropshipping-config');

            $this->commands([
                Console\AddToMyProductsCommand::class,
                Console\DiscoverCommand::class,
                Console\SyncCommand::class,
                Console\WebhooksSetupCommand::class,
            ]);
        }

        // Defer scheduling until Schedule is actually resolved
        $this->callAfterResolving(Schedule::class, function (Schedule $schedule): void {
            if (! config('lunar-cjdropshipping.schedule.enabled')) {
                return;
            }

            foreach (['cj:discover' => 'discover', 'cj:sync' => 'sync'] as $command => $key) {
                $event = $schedule->command($command)->withoutOverlapping();
                $frequency = (string) config("lunar-cjdropshipping.schedule.{$key}", 'daily');

                in_array($frequency, self::SCHEDULE_FREQUENCIES, true) ? $event->{$frequency}() : $event->daily();
            }
        });
    }
}
