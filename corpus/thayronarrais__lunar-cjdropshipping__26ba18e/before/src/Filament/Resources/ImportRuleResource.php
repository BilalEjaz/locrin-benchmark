<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Filament\Resources;

use Closure;
use Filament\Forms;
use Filament\Forms\Components\Component;
use Filament\Forms\Get;
use Filament\Notifications\Notification;
use Filament\Resources\Pages\PageRegistration;
use Filament\Tables;
use Filament\Tables\Table;
use Illuminate\Contracts\Validation\ImplicitRule;
use Lunar\Admin\Support\Resources\BaseResource;
use Lunar\Models\Collection;
use Thayron\LunarCjDropshipping\Enums\PriceRounding;
use Thayron\LunarCjDropshipping\Filament\Resources\ImportRuleResource\Pages;
use Thayron\LunarCjDropshipping\Filament\Support\CjCatalogOptions;
use Thayron\LunarCjDropshipping\Filament\Support\PricePreview;
use Thayron\LunarCjDropshipping\Jobs\DiscoverCandidatesJob;
use Thayron\LunarCjDropshipping\Models\ImportRule;

class ImportRuleResource extends BaseResource
{
    protected static ?string $permission = 'catalog:manage-products';

    protected static ?string $model = ImportRule::class;

    protected static ?string $navigationIcon = 'heroicon-o-funnel';

    protected static ?int $navigationSort = 1;

    public static function getLabel(): string
    {
        return __('lunar-cjdropshipping::admin.rules.label');
    }

    public static function getPluralLabel(): string
    {
        return __('lunar-cjdropshipping::admin.rules.plural_label');
    }

    public static function getNavigationGroup(): ?string
    {
        return __('lunar-cjdropshipping::admin.navigation.group');
    }

    /**
     * @return array<string, string>
     */
    public static function roundingOptions(): array
    {
        return collect(PriceRounding::cases())
            ->mapWithKeys(fn (PriceRounding $rounding) => [$rounding->value => __('lunar-cjdropshipping::admin.rounding.'.$rounding->value)])
            ->all();
    }

    /**
     * @return array<int, Component>
     */
    protected static function getMainFormComponents(): array
    {
        $field = fn (string $key): string => __("lunar-cjdropshipping::admin.rules.fields.{$key}");

        return [
            Forms\Components\Section::make()->columns(2)->schema([
                Forms\Components\TextInput::make('name')->label($field('name'))->required()->maxLength(255),
                Forms\Components\Toggle::make('is_active')->label($field('is_active'))->default(true)->inline(false),
                Forms\Components\Select::make('category_ids')
                    ->label($field('category_ids'))
                    ->helperText($field('category_ids_help'))
                    ->multiple()
                    ->searchable()
                    ->options(fn (): array => CjCatalogOptions::categories())
                    ->columnSpanFull(),
                Forms\Components\TextInput::make('keyword')
                    ->label($field('keyword'))
                    ->maxLength(255)
                    ->rules([
                        // A plain Closure rule (Illuminate\Validation\ClosureValidationRule) is never
                        // "implicit", so Laravel skips it entirely once $value trims to an empty string
                        // (see Validator::presentOrRuleIsImplicit()). An ImplicitRule is required so this
                        // still runs when keyword is blank.
                        fn (Get $get): ImplicitRule => new class($get) implements ImplicitRule
                        {
                            public function __construct(private readonly Get $get) {}

                            public function passes($attribute, $value): bool
                            {
                                return filled($value) || filled(($this->get)('category_ids'));
                            }

                            public function message(): string
                            {
                                return __('lunar-cjdropshipping::admin.rules.validation.filter_required');
                            }
                        },
                    ]),
                Forms\Components\Select::make('country_code')
                    ->label($field('country_code'))
                    ->searchable()
                    ->options(fn (): array => CjCatalogOptions::countries()),
                Forms\Components\TextInput::make('min_stock')->label($field('min_stock'))->numeric()->minValue(0)->default(0)->required(),
                Forms\Components\TextInput::make('max_pages')->label($field('max_pages'))->numeric()->minValue(1)->maxValue(1000)->default(5)->required(),
                Forms\Components\TextInput::make('min_cost')->label($field('min_cost'))->numeric()->minValue(0)->prefix('US$'),
                Forms\Components\TextInput::make('max_cost')
                    ->label($field('max_cost'))
                    ->numeric()
                    ->minValue(0)
                    ->prefix('US$')
                    ->rules([
                        fn (Get $get): Closure => function (string $attribute, mixed $value, Closure $fail) use ($get): void {
                            if (filled($value) && filled($get('min_cost')) && (float) $value < (float) $get('min_cost')) {
                                $fail(__('lunar-cjdropshipping::admin.rules.validation.max_cost_gte_min'));
                            }
                        },
                    ]),
                Forms\Components\TextInput::make('markup_percent')->label($field('markup_percent'))->numeric()->minValue(0)->suffix('%')->default(100)->required()->live(debounce: 500),
                Forms\Components\Select::make('rounding')->label($field('rounding'))->options(static::roundingOptions())->default(PriceRounding::None->value)->required()->live(),
                Forms\Components\Placeholder::make('price_preview')
                    ->label($field('price_preview'))
                    ->helperText($field('price_preview_help'))
                    ->content(fn (Get $get): string => PricePreview::for($get('markup_percent'), $get('rounding')))
                    ->columnSpanFull(),
                Forms\Components\Select::make('product_type_id')->label($field('product_type_id'))->relationship('productType', 'name')->preload()->required(),
                Forms\Components\Select::make('brand_id')->label($field('brand_id'))->relationship('brand', 'name')->searchable()->preload(),
                Forms\Components\Select::make('collection_id')
                    ->label($field('collection_id'))
                    ->searchable()
                    ->options(function (): array {
                        /** @var \Illuminate\Database\Eloquent\Collection<int, Collection> $collections */
                        $collections = Collection::query()->get();

                        return $collections->mapWithKeys(fn (Collection $collection) => [$collection->id => (string) ($collection->translateAttribute('name') ?? "#{$collection->id}")])->all();
                    }),
            ]),
        ];
    }

    protected static function getDefaultTable(Table $table): Table
    {
        return $table
            ->columns([
                Tables\Columns\TextColumn::make('name')->label(__('lunar-cjdropshipping::admin.rules.fields.name'))->searchable()->sortable(),
                Tables\Columns\IconColumn::make('is_active')->label(__('lunar-cjdropshipping::admin.rules.fields.is_active'))->boolean(),
                Tables\Columns\TextColumn::make('markup_percent')->label(__('lunar-cjdropshipping::admin.rules.fields.markup_percent'))->suffix('%'),
                Tables\Columns\TextColumn::make('last_run_at')->label(__('lunar-cjdropshipping::admin.rules.fields.last_run_at'))->dateTime()->sortable()->placeholder('—'),
                Tables\Columns\TextColumn::make('last_run_summary')
                    ->label(__('lunar-cjdropshipping::admin.rules.fields.last_run_stats'))
                    ->state(fn (ImportRule $record): ?string => static::statsSummary($record))
                    ->placeholder('—'),
            ])
            ->actions([
                Tables\Actions\Action::make('discover')
                    ->label(__('lunar-cjdropshipping::admin.rules.actions.discover'))
                    ->icon('heroicon-o-magnifying-glass')
                    ->action(function (ImportRule $record): void {
                        DiscoverCandidatesJob::dispatch($record);
                        Notification::make()->title(__('lunar-cjdropshipping::admin.rules.actions.discover_queued'))->success()->send();
                    }),
                Tables\Actions\EditAction::make(),
            ])
            ->bulkActions([
                Tables\Actions\DeleteBulkAction::make(),
            ]);
    }

    public static function statsSummary(ImportRule $rule): ?string
    {
        $stats = $rule->last_run_stats;

        if (! is_array($stats)) {
            return null;
        }

        if (isset($stats['error'])) {
            return (string) $stats['error'];
        }

        return __('lunar-cjdropshipping::admin.rules.stats', [
            'found' => $stats['found'] ?? 0,
            'created' => $stats['created'] ?? 0,
            'already_imported' => $stats['already_imported'] ?? 0,
        ]);
    }

    /**
     * @return array<string, PageRegistration>
     */
    public static function getDefaultPages(): array
    {
        return [
            'index' => Pages\ListImportRules::route('/'),
            'create' => Pages\CreateImportRule::route('/create'),
            'edit' => Pages\EditImportRule::route('/{record}/edit'),
        ];
    }
}
