<?php

declare(strict_types=1);

namespace Reporting\Filament\Resources;

use BackedEnum;
use BetaFilament\Concerns\ResourceAccessGate;
use BetaFilament\Concerns\SupportResourceNavigationGroup;
use Filament\Actions\DeleteAction;
use Filament\Actions\EditAction;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\IconColumn;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Reporting\Filament\Resources\ReportingScheduleResource\Pages\CreateReportingSchedule;
use Reporting\Filament\Resources\ReportingScheduleResource\Pages\EditReportingSchedule;
use Reporting\Filament\Resources\ReportingScheduleResource\Pages\ListReportingSchedules;
use Reporting\Filament\Resources\ReportingScheduleResource\Pages\ViewReportingSchedule;
use Reporting\Models\ReportingSchedule;
use Reporting\Support\Navigation;

final class ReportingScheduleResource extends Resource
{
    use ResourceAccessGate;
    use SupportResourceNavigationGroup;

    protected static ?string $model = ReportingSchedule::class;

    protected static string|BackedEnum|null $navigationIcon = 'heroicon-o-calendar';

    protected static ?int $navigationSort = 3;

    protected static bool $shouldRegisterNavigation = false;

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

    public static function form(Schema $schema): Schema
    {
        // minor: review form and create page as well as create test
        return $schema->components([
            TextInput::make('name')
                ->required()
                ->maxLength(255),

            Textarea::make('description'),

            TextInput::make('cron_expression')
                ->required()
                ->helperText('e.g. 0 8 * * * for daily at 8am'),

            TextInput::make('timezone')
                ->default('UTC')
                ->required(),

            Toggle::make('is_active')
                ->label('Active')
                ->default(state: true),

            TextEntry::make('created_at')
                ->label('Created')
                ->state(
                    fn (?ReportingSchedule $reportingSchedule): string => $reportingSchedule?->created_at
                        ?->diffForHumans() ?? '-'
                )
                ->visibleOn(['edit', 'view']),
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name')

                    ->sortable(),

                TextColumn::make('cron_expression')
                    ->label('Cron'),

                TextColumn::make('timezone'),

                IconColumn::make('is_active')
                    ->label('Active')
                    ->boolean(),

                TextColumn::make('reports_count')
                    ->label('Reports')
                    ->counts('reports')
                    ->sortable(),

                TextColumn::make('updated_at')
                    ->dateTime()
                    ->sortable(),
            ])
            ->recordActions([
                ViewAction::make(),
                EditAction::make(),
                DeleteAction::make(),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ListReportingSchedules::route('/'),
            'create' => CreateReportingSchedule::route('/create'),
            'edit' => EditReportingSchedule::route('/{record}/edit'),
            'view' => ViewReportingSchedule::route('/{record}'),
        ];
    }

    public static function getEloquentQuery(): Builder
    {
        return parent::getEloquentQuery()
            ->withoutGlobalScopes([
                //                SoftDeletingScope::class,
            ]);
    }

    public static function canAccess(): bool
    {
        return isSystemStaff() || auth()->user()?->hasRole('super_admin');
    }
}
