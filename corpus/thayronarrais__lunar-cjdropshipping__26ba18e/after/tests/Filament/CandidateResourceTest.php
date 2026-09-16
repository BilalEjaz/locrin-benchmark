<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Tests\Filament;

use Illuminate\Support\Facades\Queue;
use Livewire\Livewire;
use Thayron\LunarCjDropshipping\Enums\CandidateSource;
use Thayron\LunarCjDropshipping\Enums\CandidateStatus;
use Thayron\LunarCjDropshipping\Enums\PriceRounding;
use Thayron\LunarCjDropshipping\Filament\Resources\CandidateResource;
use Thayron\LunarCjDropshipping\Filament\Resources\CandidateResource\Pages\ListCandidates;
use Thayron\LunarCjDropshipping\Models\Candidate;
use Thayron\LunarCjDropshipping\Models\ImportRule;
use Thayron\LunarCjDropshipping\Tests\FilamentTestCase;
use Thayron\LunarCjDropshipping\Tests\Support\CreatesLunarBaseline;

final class CandidateResourceTest extends FilamentTestCase
{
    use CreatesLunarBaseline;

    private ImportRule $rule;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();
        $this->createLunarBaseline();
        $this->actingAsStaff();
        $this->rule = ImportRule::create(['name' => 'Rule', 'keyword' => 'case', 'markup_percent' => '100', 'rounding' => PriceRounding::Ends90, 'product_type_id' => $this->productType->id]);
    }

    public function test_lists_pending_items_from_rules_and_from_the_catalog(): void
    {
        $fromRule = $this->candidate('p-1', CandidateStatus::Pending);
        $fromCatalog = Candidate::create([
            'cj_product_id' => 'p-2', 'source' => CandidateSource::Catalog, 'name' => 'Catalog product',
            'status' => CandidateStatus::Pending, 'payload' => [], 'discovered_at' => now(),
        ]);
        $ignored = $this->candidate('p-3', CandidateStatus::Ignored);

        Livewire::test(ListCandidates::class)
            ->assertCanSeeTableRecords([$fromRule, $fromCatalog])
            ->assertCanNotSeeTableRecords([$ignored])
            ->assertSee(__('lunar-cjdropshipping::admin.candidates.source.catalog'))
            ->filterTable('source', 'catalog')
            ->assertCanSeeTableRecords([$fromCatalog])
            ->assertCanNotSeeTableRecords([$fromRule]);
    }

    public function test_confirm_action_opens_the_confirmation_page(): void
    {
        $pending = $this->candidate('p-1', CandidateStatus::Pending);

        Livewire::test(ListCandidates::class)
            ->assertTableActionVisible('confirm', $pending)
            ->assertTableActionHasUrl('confirm', CandidateResource::getUrl('confirm', ['record' => $pending]), $pending);
    }

    public function test_has_no_direct_import_actions(): void
    {
        Livewire::test(ListCandidates::class)
            ->assertTableActionDoesNotExist('import')
            ->assertTableActionDoesNotExist('retry')
            ->assertTableBulkActionDoesNotExist('import');
    }

    public function test_bulk_ignore_and_reset(): void
    {
        $candidate = $this->candidate('p-1', CandidateStatus::Pending);

        Livewire::test(ListCandidates::class)->callTableBulkAction('ignore', [$candidate]);
        $this->assertSame(CandidateStatus::Ignored, $candidate->fresh()->status);

        Livewire::test(ListCandidates::class)->filterTable('status', 'ignored')->callTableBulkAction('reset', [$candidate]);
        $this->assertSame(CandidateStatus::Pending, $candidate->fresh()->status);
    }

    public function test_bulk_reset_recovers_stuck_approved_and_importing_candidates(): void
    {
        $importing = $this->candidate('p-1', CandidateStatus::Importing);
        $approved = $this->candidate('p-2', CandidateStatus::Approved);
        $imported = $this->candidate('p-3', CandidateStatus::Imported);
        $importing->forceFill(['error' => 'stale'])->save();

        Livewire::test(ListCandidates::class)
            ->filterTable('status', null)
            ->callTableBulkAction('reset', [$importing, $approved, $imported]);

        $this->assertSame(CandidateStatus::Pending, $importing->fresh()->status);
        $this->assertNull($importing->fresh()->error);
        $this->assertSame(CandidateStatus::Pending, $approved->fresh()->status);
        $this->assertSame(CandidateStatus::Imported, $imported->fresh()->status);
    }

    public function test_bulk_reset_recovers_unavailable_candidates(): void
    {
        $unavailable = $this->candidate('p-1', CandidateStatus::Unavailable);

        Livewire::test(ListCandidates::class)
            ->filterTable('status', null)
            ->callTableBulkAction('reset', [$unavailable]);

        $this->assertSame(CandidateStatus::Pending, $unavailable->fresh()->status);
    }

    public function test_bulk_reset_recovers_candidates_marked_shipping_too_high(): void
    {
        $candidate = $this->candidate('p-1', CandidateStatus::ShippingTooHigh);

        Livewire::test(ListCandidates::class)
            ->filterTable('status', 'shipping_too_high')
            ->callTableBulkAction('reset', [$candidate]);

        $this->assertSame(CandidateStatus::Pending, $candidate->fresh()->status);
    }

    public function test_bulk_ignore_skips_imported_candidates(): void
    {
        $pending = $this->candidate('p-1', CandidateStatus::Pending);
        $imported = $this->candidate('p-2', CandidateStatus::Imported);

        Livewire::test(ListCandidates::class)
            ->filterTable('status', null)
            ->callTableBulkAction('ignore', [$pending, $imported]);

        $this->assertSame(CandidateStatus::Ignored, $pending->fresh()->status);
        $this->assertSame(CandidateStatus::Imported, $imported->fresh()->status);
    }

    private function candidate(string $cjProductId, CandidateStatus $status): Candidate
    {
        return Candidate::create([
            'import_rule_id' => $this->rule->id,
            'cj_product_id' => $cjProductId,
            'cj_sku' => 'SKU-'.$cjProductId,
            'name' => 'Product '.$cjProductId,
            'cost_usd' => '10.00',
            'warehouse_stock' => 10,
            'status' => $status,
            'payload' => [],
            'discovered_at' => now(),
        ]);
    }
}
