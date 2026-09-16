<?php

declare(strict_types=1);

namespace Reporting\Filament\Resources;

use BackedEnum;
use BetaFilament\Concerns\ResourceAccessGate;
use Filament\Actions\Action;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Filters\SelectFilter;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Storage;
use Reporting\Consts\ReportSource;
use Reporting\Consts\ReportStatus;
use Reporting\Filament\Resources\ReportHistoryResource\Pages\ListReportHistories;
use Reporting\Filament\Resources\ReportHistoryResource\Pages\ViewReportHistory;
use Reporting\Jobs\GenerateReportJob;
use Reporting\Models\ReportHistory;
use Reporting\Support\Navigation;

final class ReportHistoryResource extends Resource
{
    use ResourceAccessGate;

    protected static ?string $model = ReportHistory::class;

    protected static string|BackedEnum|null $navigationIcon = 'heroicon-o-clock';

    protected static ?int $navigationSort = 2;

    protected static ?string $label = 'History';

    protected static ?string $pluralLabel = 'Histories';

    public static function isScopedToTenant(): bool
    {
        return false;
    }

    public static function getCluster(): string
    {
        return Navigation::cluster();
    }

    public static function getNavigationGroup(): ?string
    {
        return Navigation::group();
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('report.name')
                    ->label('Report')
                    ->searchable()
                    ->sortable(),

                TextColumn::make('status')
                    ->badge()
                    ->color(fn (string $state): string => match ($state) {
                        ReportStatus::STATUS_COMPLETED => 'success',
                        ReportStatus::STATUS_FAILED => 'danger',
                        ReportStatus::STATUS_PROCESSING => 'warning',
                        default => 'gray',
                    }),

                //                TextColumn::make('source')
                //                    ->badge()
                //                    ->color(fn (string $state): string => match ($state) {
                //                        ReportSource::SOURCE_SCHEDULED => 'info',
                //                        default => 'gray',
                //                    }),

                TextColumn::make('started_at')
                    ->dateTime()
                    ->sortable(),

                //                TextColumn::make('execution_time_ms')
                //                    ->label('Duration')
                //                    ->formatStateUsing(
                //                        fn (?int $state): string => $state !== null
                //                        ? ($state < 1000 ? $state . 'ms' : round($state / 1000, 2) . 's')
                //                        : '-'
                //                    )
                //                    ->sortable(),

                TextColumn::make('row_count')
                    ->label('Rows')
                    ->numeric()
                    ->sortable(),

                TextColumn::make('file_size')
                    ->label('Size')
                    ->formatStateUsing(
                        fn (?int $state): string => $state !== null
                        ? number_format($state / 1024, 1) . ' KB'
                        : '-'
                    )
                    ->sortable(),
            ])
            ->defaultSort('created_at', 'desc')
            ->filters([
                SelectFilter::make('status')
                    ->options(ReportStatus::options()),

                SelectFilter::make('source')
                    ->options(ReportSource::options()),
            ])

            ->recordActions([
                self::previewPdfAction(),
                self::downloadCsvAction(),
                self::downloadPdfAction(),

                Action::make('retry')
                    ->label('Retry')
                    ->icon('heroicon-o-arrow-path')
                    ->requiresConfirmation()
                    ->visible(fn (ReportHistory $reportHistory): bool => $reportHistory->isFailed()
                        && $reportHistory->report !== null)
                    ->action(function (ReportHistory $reportHistory): void {
                        if ($reportHistory->report === null) {
                            return;
                        }

                        GenerateReportJob::dispatch(
                            $reportHistory->report,
                            $reportHistory->modifiers ?? [],
                            $reportHistory->triggered_by_user_id,
                            $reportHistory->source,
                        );
                    }),

                //                ViewAction::make(),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ListReportHistories::route('/'),
            'view' => ViewReportHistory::route('/{record}'),
        ];
    }

    public static function getEloquentQuery(): Builder
    {
        $reports = ReportResource::getEloquentQuery()->pluck('id');

        return ReportHistory::query()->whereHas(
            'report',
            function (Builder $builder) use ($reports): void {
                $builder->whereIntegerInRaw('id', $reports);
            }
        );
    }

    public static function canAccess(): bool
    {
        return isSystemStaff() || auth()->user()?->hasRole('super_admin');
    }

    private static function previewPdfAction(): Action
    {
        return Action::make('preview_pdf')
            ->label('Preview')
            ->icon('heroicon-o-eye')
            ->color('info')
            ->visible(fn (ReportHistory $reportHistory): bool => self::isCompletedWith($reportHistory, 'pdf_file_path'))
            ->url(
                fn (ReportHistory $reportHistory): string => route('reporting.preview', $reportHistory),
                shouldOpenInNewTab: true
            );
    }

    private static function downloadCsvAction(): Action
    {
        return Action::make('download_csv')
            ->label('CSV')
            ->icon('heroicon-o-arrow-down-tray')
            ->color('success')
            ->visible(fn (ReportHistory $reportHistory): bool => self::isCompletedWith($reportHistory, 'csv_file_path'))
            ->action(fn (ReportHistory $reportHistory) => response()->streamDownload(
                function () use ($reportHistory): void {
                    $disk = (string) config('reporting.disk', 'local');

                    echo Storage::disk($disk)->get($reportHistory->csv_file_path);
                },
                basename((string) $reportHistory->csv_file_path),
                ['Content-Type' => 'text/csv'],
            ));
    }

    private static function downloadPdfAction(): Action
    {
        return Action::make('download_pdf')
            ->label('PDF')
            ->icon('heroicon-o-document')
            ->color('danger')
            ->visible(fn (ReportHistory $reportHistory): bool => self::isCompletedWith($reportHistory, 'pdf_file_path'))
            ->action(fn (ReportHistory $reportHistory) => response()->streamDownload(
                function () use ($reportHistory): void {
                    $disk = (string) config('reporting.disk', 'local');

                    echo Storage::disk($disk)->get($reportHistory->pdf_file_path);
                },
                basename((string) $reportHistory->pdf_file_path),
                ['Content-Type' => 'application/pdf'],
            ));
    }

    private static function isCompletedWith(ReportHistory $reportHistory, string $pathAttribute): bool
    {
        return $reportHistory->isCompleted() && filled($reportHistory->{$pathAttribute});
    }
}
