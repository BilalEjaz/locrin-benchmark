<?php

declare(strict_types=1);

namespace Reporting\Filament\Resources;

use BackedEnum;
use BetaFilament\Concerns\ResourceAccessGate;
use Filament\Actions\ViewAction;
use Filament\Forms\Components\Select;
use Filament\Forms\Components\Textarea;
use Filament\Forms\Components\TextInput;
use Filament\Forms\Components\Toggle;
use Filament\Infolists\Components\TextEntry;
use Filament\Resources\Pages\PageRegistration;
use Filament\Resources\Resource;
use Filament\Schemas\Schema;
use Filament\Tables\Columns\TextColumn;
use Filament\Tables\Table;
use Illuminate\Database\Eloquent\Builder;
use Reporting\Filament\Resources\ReportResource\Actions\GenerateReportAction;
use Reporting\Filament\Resources\ReportResource\Pages\EditReport;
use Reporting\Filament\Resources\ReportResource\Pages\ListReports;
use Reporting\Filament\Resources\ReportResource\Pages\ViewReport;
use Reporting\Filament\Resources\ReportResource\RelationManagers\HistoriesRelationManager;
use Reporting\Filament\Resources\ReportResource\RelationManagers\RolesRelationManager;
use Reporting\Filament\Resources\ReportResource\RelationManagers\SchedulesRelationManager;
use Reporting\Models\Report;
use Reporting\Services\GeneratorDiscovery;
use Reporting\Support\Navigation;

final class ReportResource extends Resource
{
    use ResourceAccessGate;

    protected static string|BackedEnum|null $navigationIcon = 'heroicon-o-document-text';

    protected static ?int $navigationSort = 1;

    public static function getModel(): string
    {
        return Report::class;
    }

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

            TextInput::make('group')
                ->label('Group')
                ->nullable()
                ->maxLength(100)
                ->placeholder('e.g. Finance, Operations')
                ->helperText('Optional category to group related reports together.'),

            Textarea::make('description'),

            Select::make('generator_class')
                ->label('Generator')
                ->options(fn (): array => (new GeneratorDiscovery)->getGeneratorOptions())
                ->required()
                ->unique(ignoreRecord: true)
                ->reactive()
                ->afterStateUpdated(function ($state, callable $set): void {
                    if ($state === null) {
                        return;
                    }

                    $generatorDiscovery = new GeneratorDiscovery;

                    if (! $generatorDiscovery->isValidGenerator($state)) {
                        return;
                    }

                    $generator = $generatorDiscovery->resolve($state);
                    $set('is_heavy', $generator->isHeavy());
                    $set('parameters', $generator->getDefaultParameters());
                }),

            Toggle::make('is_heavy')
                ->label('Heavy Report')
                ->helperText('Enables cooldown between generations'),

            TextInput::make('cooldown_minutes')
                ->label('Cooldown (minutes)')
                ->numeric()
                ->minValue(1)
                ->nullable()
                ->helperText(
                    'Minutes to wait between generations for heavy reports. Defaults to '
                    . config('reporting.default_cooldown_minutes', 30) . ' minutes.'
                ),

            Toggle::make('generate_csv')
                ->label('Generate CSV')
                ->default(state: true),

            Toggle::make('generate_pdf')
                ->label('Generate PDF')
                ->default(state: true),

            Select::make('orientation')
                ->options([
                    'landscape' => 'Landscape',
                    'portrait' => 'Portrait',
                ])
                ->default('landscape')
                ->required(),

            Toggle::make('is_active')
                ->label('Active')
                ->default(state: true),

            TextEntry::make('created_at')
                ->label('Created')
                ->state(fn (?Report $report): string => $report?->created_at?->diffForHumans() ?? '-')
            //                ->visibleOn(['edit', 'view'])
            ,

            TextEntry::make('updated_at')
                ->label('Last Modified')
                ->state(fn (?Report $report): string => $report?->updated_at?->diffForHumans() ?? '-')
            //                ->visibleOn(['edit', 'view'])
            ,
        ]);
    }

    public static function table(Table $table): Table
    {
        return $table
            ->columns([
                TextColumn::make('name'),
                TextColumn::make('group')->badge(),
                TextColumn::make('description')->wrap(),
            ])
            ->recordActions([
                GenerateReportAction::make()->slideOver(),
                ViewAction::make(),
            ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getPages(): array
    {
        return [
            'index' => ListReports::route('/'),
            'edit' => EditReport::route('/{record}/edit'),
            'view' => ViewReport::route('/{record}/view'),
        ];
    }

    /**
     * @return array<string, class-string>
     */
    public static function getRelations(): array
    {
        return [
            'histories' => HistoriesRelationManager::class,
            'schedules' => SchedulesRelationManager::class,
            'roles' => RolesRelationManager::class,
        ];
    }

    public static function getEloquentQuery(): Builder
    {
        $user = auth()->user();
        $roles = $user?->roles->pluck('id')->toArray();

        return parent::getEloquentQuery()
            ->when(
                ! $user->hasRole('super_admin'),
                fn (Builder $builder) => $builder->whereHas('roles', function (Builder $builder) use ($roles): void {
                    $builder->whereIn('roles.id', $roles);
                })
            )
            ->with('roles')
            ->withoutGlobalScopes();
    }

    public static function canAccess(): bool
    {
        return isSystemStaff() || auth()->user()?->hasRole('super_admin');
    }
}
