<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Tests\Filament;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Livewire\Livewire;
use Lunar\Models\Country;
use Thayron\LunarCjDropshipping\Enums\PriceRounding;
use Thayron\LunarCjDropshipping\Filament\Resources\ImportRuleResource\Pages\CreateImportRule;
use Thayron\LunarCjDropshipping\Filament\Resources\ImportRuleResource\Pages\ListImportRules;
use Thayron\LunarCjDropshipping\Filament\Support\PricePreview;
use Thayron\LunarCjDropshipping\Jobs\DiscoverCandidatesJob;
use Thayron\LunarCjDropshipping\Models\ImportRule;
use Thayron\LunarCjDropshipping\Tests\FilamentTestCase;
use Thayron\LunarCjDropshipping\Tests\Support\CreatesLunarBaseline;

final class ImportRuleResourceTest extends FilamentTestCase
{
    use CreatesLunarBaseline;

    protected function setUp(): void
    {
        parent::setUp();

        $this->createLunarBaseline();
        Cache::put('lunar-cjdropshipping.categories', ['cat-1' => 'Phones › Accessories › Cases'], 3600);
        Cache::put('lunar-cjdropshipping.countries', ['US' => 'United States (US)'], 3600);
        $this->actingAsStaff();
    }

    public function test_lists_rules(): void
    {
        $rule = $this->rule();

        Livewire::test(ListImportRules::class)->assertCanSeeTableRecords([$rule]);
    }

    public function test_creates_a_rule(): void
    {
        Livewire::test(CreateImportRule::class)
            ->fillForm([
                'name' => 'Phone cases',
                'is_active' => true,
                'category_ids' => ['cat-1'],
                'country_code' => 'US',
                'min_stock' => 10,
                'markup_percent' => 120,
                'rounding' => 'ends_90',
                'product_type_id' => $this->productType->id,
                'max_pages' => 3,
            ])
            ->call('create')
            ->assertHasNoFormErrors();

        $rule = ImportRule::query()->sole();
        $this->assertSame(['cat-1'], $rule->category_ids);
        $this->assertSame(PriceRounding::Ends90, $rule->rounding);
        $this->assertSame('120.00', $rule->markup_percent);
    }

    public function test_requires_a_category_or_keyword_and_valid_limits(): void
    {
        Livewire::test(CreateImportRule::class)
            ->fillForm([
                'name' => 'Invalid',
                'category_ids' => [],
                'keyword' => '',
                'markup_percent' => 50,
                'rounding' => 'none',
                'product_type_id' => $this->productType->id,
                'min_cost' => 10,
                'max_cost' => 5,
                'max_pages' => 1001,
            ])
            ->call('create')
            ->assertHasFormErrors(['keyword', 'max_cost', 'max_pages']);

        $this->assertSame(0, ImportRule::query()->count());
    }

    public function test_saves_the_freight_filter(): void
    {
        Country::factory()->create(['iso2' => 'GB', 'iso3' => 'GBR', 'name' => 'United Kingdom']);

        Livewire::test(CreateImportRule::class)
            ->fillForm([
                'name' => 'Pets UK',
                'keyword' => 'dog',
                'markup_percent' => 100,
                'rounding' => 'none',
                'product_type_id' => $this->productType->id,
                'ship_to_country' => 'GB',
                'max_shipping_percent' => 100,
                'max_quotes_per_run' => 25,
            ])
            ->call('create')
            ->assertHasNoFormErrors();

        $rule = ImportRule::query()->where('name', 'Pets UK')->sole();
        $this->assertSame('GB', $rule->ship_to_country);
        $this->assertSame('100.00', $rule->max_shipping_percent);
        $this->assertSame(25, $rule->max_quotes_per_run);
        $this->assertTrue($rule->hasFreightFilter());
    }

    public function test_discover_action_queues_the_job(): void
    {
        Queue::fake();
        $rule = $this->rule();

        Livewire::test(ListImportRules::class)->callTableAction('discover', $rule);

        Queue::assertPushed(DiscoverCandidatesJob::class, fn (DiscoverCandidatesJob $job) => $job->rule->is($rule));
    }

    public function test_price_preview_shows_every_enabled_currency(): void
    {
        $this->assertSame('US$ 10.00 → 18.90 EUR · 15.90 GBP · 20.90 USD', PricePreview::for('100', 'ends_90'));
        $this->assertSame('US$ 10.00 → 9.26 EUR · 7.87 GBP · 10.00 USD', PricePreview::for(null, null));
    }

    private function rule(): ImportRule
    {
        return ImportRule::create(['name' => 'Rule', 'keyword' => 'case', 'markup_percent' => '100', 'rounding' => PriceRounding::None, 'product_type_id' => $this->productType->id]);
    }
}
