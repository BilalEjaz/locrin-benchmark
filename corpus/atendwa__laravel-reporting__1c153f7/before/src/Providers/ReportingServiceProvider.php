<?php

declare(strict_types=1);

namespace Reporting\Providers;

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Log;
use Reporting\Commands\CleanupReportsCommand;
use Reporting\Commands\ClearGeneratorCacheCommand;
use Reporting\Commands\MakeGeneratorCommand;
use Reporting\Commands\MakeReportFromGeneratorCommand;
use Reporting\Commands\ResetTablesCommand;
use Reporting\Commands\RunReportCommand;
use Reporting\Commands\RunTestsCommand;
use Reporting\Commands\SetupCommand;
use Reporting\Consts\CacheKeys;
use Reporting\Consts\CacheTtl;
use Reporting\Consts\Reporting;
use Reporting\Contracts\PdfGeneratorContract;
use Reporting\Events\ReportFailed;
use Reporting\Events\ReportGenerated;
use Reporting\Events\ReportScheduleUpdated;
use Reporting\Listeners\SendReportCompletedNotification;
use Reporting\Listeners\SendReportFailedNotification;
use Reporting\Models\Report;
use Reporting\Models\ReportHistory;
use Reporting\Models\ReportingSchedule;
use Reporting\Models\ReportSchedule;
use Reporting\Observers\ReportHistoryObserver;
use Reporting\Policies\ReportHistoryPolicy;
use Reporting\Policies\ReportingSchedulePolicy;
use Reporting\Policies\ReportPolicy;
use Reporting\Services\DompdfPdfGenerator;
use Reporting\Services\GeneratorDiscovery;
use Reporting\Services\MpdfPdfGenerator;
use Reporting\Utilities\CooldownChecker;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;
use Throwable;

final class ReportingServiceProvider extends PackageServiceProvider
{
    public function configurePackage(Package $package): void
    {
        $package
            ->name(Reporting::NAME)
            ->hasConfigFile()
            ->hasViews()
            ->discoversMigrations()
            ->runsMigrations()
            ->hasRoutes(['console', 'web'])
            ->hasCommands([
                MakeReportFromGeneratorCommand::class,
                ClearGeneratorCacheCommand::class,
                CleanupReportsCommand::class,
                MakeGeneratorCommand::class,
                ResetTablesCommand::class,
                RunReportCommand::class,
                RunTestsCommand::class,
                SetupCommand::class,
            ]);
    }

    public function packageRegistered(): void
    {
        $this->app->singleton(GeneratorDiscovery::class);
        $this->app->singleton(CooldownChecker::class);

        $this->app->bind(PdfGeneratorContract::class, function ($app): PdfGeneratorContract {
            $engine = config('reporting.pdf_engine', 'dompdf');

            return match ($engine) {
                default => $app->make(DompdfPdfGenerator::class),
                'mpdf' => $app->make(MpdfPdfGenerator::class),
            };
        });
    }

    public function packageBooted(): void
    {
        $this->registerEventListeners();
        $this->registerModelObservers();
        $this->registerScheduledTasks();

        Gate::policy(ReportingSchedule::class, ReportingSchedulePolicy::class);
        Gate::policy(ReportHistory::class, ReportHistoryPolicy::class);
        Gate::policy(Report::class, ReportPolicy::class);
    }

    private function registerEventListeners(): void
    {
        Event::listen(ReportGenerated::class, SendReportCompletedNotification::class);
        Event::listen(ReportFailed::class, SendReportFailedNotification::class);
    }

    private function registerModelObservers(): void
    {
        $clearCache = function (): void {
            Cache::forget(CacheKeys::SCHEDULED_REPORTS);
            event(new ReportScheduleUpdated);
        };

        Report::saved($clearCache);
        Report::deleted($clearCache);

        ReportSchedule::saved($clearCache);
        ReportSchedule::deleted($clearCache);

        ReportHistory::observe(ReportHistoryObserver::class);
    }

    private function registerScheduledTasks(): void
    {
        $this->callAfterResolving(
            Schedule::class,
            fn (Schedule $schedule) => $this->scheduleReports($schedule)
        );
    }

    private function scheduleReports(Schedule $schedule): void
    {
        try {
            /** @var array<int, array{report_id: int, cron: string, timezone: string}> $scheduled */
            $scheduled = Cache::remember(
                CacheKeys::SCHEDULED_REPORTS,
                CacheTtl::FIVE_MINUTES,
                fn (): array => $this->loadScheduledReports()
            );
        } catch (Throwable $throwable) {
            Log::error('Failed to load scheduled reports for scheduling', ['exception' => $throwable]);

            return;
        }

        collect($scheduled)->each(function (array $item) use ($schedule): void {
            $schedule
                ->command('reports:run', [(string) $item['report_id']])
                ->timezone($item['timezone'])
                ->name($item['name'])
                ->withoutOverlapping()
                ->cron($item['cron'])
                ->onOneServer();
        });
    }

    /**
     * @return array<int, array{report_id: int, cron: string, timezone: string}>
     */
    private function loadScheduledReports(): array
    {
        return ReportSchedule::query()
            ->whereHas('schedule', fn ($q) => $q->where('is_active', operator: true))
            ->whereHas('report', fn ($q) => $q->where('is_active', operator: true))
            ->where('is_active', operator: true)
            ->with('schedule')->get()
            ->map(fn (ReportSchedule $reportSchedule): array => [
                'cron' => $reportSchedule->schedule->cron_expression,
                'timezone' => $reportSchedule->schedule->timezone,
                'report_id' => $reportSchedule->report_id,
                'name' => $reportSchedule->schedule->name,
            ])->toArray();
    }
}
