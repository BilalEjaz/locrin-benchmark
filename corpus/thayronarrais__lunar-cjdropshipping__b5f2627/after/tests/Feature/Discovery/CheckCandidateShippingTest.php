<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Tests\Feature\Discovery;

use Illuminate\Support\Facades\Queue;
use Thayron\CjDropshipping\Exceptions\QuotaExceededException;
use Thayron\LunarCjDropshipping\Actions\CheckCandidateShipping;
use Thayron\LunarCjDropshipping\Actions\DiscoverCandidates;
use Thayron\LunarCjDropshipping\Enums\CandidateStatus;
use Thayron\LunarCjDropshipping\Enums\PriceRounding;
use Thayron\LunarCjDropshipping\Jobs\CheckCandidateShippingJob;
use Thayron\LunarCjDropshipping\Jobs\DiscoverCandidatesJob;
use Thayron\LunarCjDropshipping\Models\Candidate;
use Thayron\LunarCjDropshipping\Models\ImportRule;
use Thayron\LunarCjDropshipping\Tests\Support\CreatesLunarBaseline;
use Thayron\LunarCjDropshipping\Tests\Support\FakeCj;
use Thayron\LunarCjDropshipping\Tests\TestCase;

final class CheckCandidateShippingTest extends TestCase
{
    use CreatesLunarBaseline;

    private FakeCj $cj;

    protected function setUp(): void
    {
        parent::setUp();

        config(['cjdropshipping.max_retries' => 0]);
        $this->createLunarBaseline();
        $this->cj = FakeCj::install($this->app);
    }

    public function test_marks_a_candidate_whose_cheapest_shipping_exceeds_the_limit(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->fixture('product-detail')->success([
            ['logisticName' => 'Yun Express', 'logisticPrice' => '15.00', 'logisticAging' => '8-12'],
            ['logisticName' => 'CJPacket Ordinary', 'logisticPrice' => '12.00', 'logisticAging' => '7-12'],
        ]);

        $stats = app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame(['checked' => 1, 'too_high' => 1, 'skipped' => 0], $stats);
        $this->assertSame(['product/query', 'logistic/freightCalculate'], $this->cj->paths());
        $this->assertSame(['startCountryCode' => 'CN', 'endCountryCode' => 'GB', 'products' => [['vid' => 'v-2', 'quantity' => 1]]], $this->cj->jsonAt(1));
        $candidate->refresh();
        $this->assertSame(CandidateStatus::ShippingTooHigh, $candidate->status);
        $this->assertSame('12.00', $candidate->shipping_usd);
        $this->assertNotNull($candidate->shipping_checked_at);
    }

    public function test_keeps_a_candidate_pending_when_shipping_is_within_the_limit(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->fixture('product-detail')->success([['logisticName' => 'CJPacket Ordinary', 'logisticPrice' => '4.00', 'logisticAging' => '7-12']]);

        app(CheckCandidateShipping::class)->handle($rule);

        $candidate->refresh();
        $this->assertSame(CandidateStatus::Pending, $candidate->status);
        $this->assertSame('4.00', $candidate->shipping_usd);
        $this->assertNotNull($candidate->shipping_checked_at);
    }

    public function test_marks_shipping_too_high_when_no_method_is_quoted(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->fixture('product-detail')->success([]);

        app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame(CandidateStatus::ShippingTooHigh, $candidate->fresh()->status);
        $this->assertNull($candidate->fresh()->shipping_usd);
    }

    public function test_uses_the_first_warehouse_with_stock_when_the_rule_has_no_origin(): void
    {
        $rule = $this->rule(['country_code' => null]);
        $this->candidate($rule, 'p-100', '10.00');
        $this->cj->fixture('product-detail')->fixture('stock-by-pid')->success([['logisticName' => 'CJPacket Ordinary', 'logisticPrice' => '4.00', 'logisticAging' => '7-12']]);

        app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame('US', $this->cj->jsonAt(2)['startCountryCode']);
    }

    public function test_checks_at_most_the_configured_number_of_candidates_per_run(): void
    {
        $rule = $this->rule(['country_code' => 'CN', 'max_quotes_per_run' => 1]);
        $first = $this->candidate($rule, 'p-100', '10.00');
        $second = $this->candidate($rule, 'p-200', '10.00');
        $this->cj->fixture('product-detail')->success([['logisticName' => 'CJPacket Ordinary', 'logisticPrice' => '4.00', 'logisticAging' => '7-12']]);

        app(CheckCandidateShipping::class)->handle($rule);

        $this->assertNotNull($first->fresh()->shipping_checked_at);
        $this->assertNull($second->fresh()->shipping_checked_at);
    }

    public function test_skips_candidates_already_checked(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $candidate->forceFill(['shipping_checked_at' => now()])->save();

        $stats = app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame(['checked' => 0, 'too_high' => 0, 'skipped' => 0], $stats);
        $this->assertSame([], $this->cj->requests());
    }

    public function test_marks_products_removed_from_cj_as_unavailable(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->error(1602001, 'Product not found');

        $stats = app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame(1, $stats['skipped']);
        $this->assertSame(CandidateStatus::Unavailable, $candidate->fresh()->status);
    }

    public function test_keeps_a_status_the_admin_set_while_a_too_high_quote_was_in_flight(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->fixture('product-detail')->success([
            ['logisticName' => 'Yun Express', 'logisticPrice' => '15.00', 'logisticAging' => '8-12'],
        ]);

        Candidate::retrieved(function (Candidate $retrieved) use ($candidate): void {
            if ($retrieved->is($candidate) && $retrieved->status === CandidateStatus::Pending) {
                Candidate::query()->whereKey($candidate->id)->update(['status' => CandidateStatus::Approved->value]);
            }
        });

        $stats = app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame(['checked' => 1, 'too_high' => 0, 'skipped' => 0], $stats);
        $candidate->refresh();
        $this->assertSame(CandidateStatus::Approved, $candidate->status);
        $this->assertSame('15.00', $candidate->shipping_usd);
        $this->assertNotNull($candidate->shipping_checked_at);
    }

    public function test_keeps_a_status_the_admin_set_while_a_not_found_check_was_in_flight(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->error(1602001, 'Product not found');

        Candidate::retrieved(function (Candidate $retrieved) use ($candidate): void {
            if ($retrieved->is($candidate) && $retrieved->status === CandidateStatus::Pending) {
                Candidate::query()->whereKey($candidate->id)->update(['status' => CandidateStatus::Ignored->value]);
            }
        });

        $stats = app(CheckCandidateShipping::class)->handle($rule);

        $this->assertSame(1, $stats['skipped']);
        $candidate->refresh();
        $this->assertSame(CandidateStatus::Ignored, $candidate->status);
        $this->assertNotNull($candidate->shipping_checked_at);
    }

    public function test_stops_when_the_cj_quota_is_used_up(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $candidate = $this->candidate($rule, 'p-100', '10.00');
        $this->cj->error(1600201, 'Quota exceeded');

        try {
            app(CheckCandidateShipping::class)->handle($rule);
            $this->fail('Expected QuotaExceededException.');
        } catch (QuotaExceededException) {
            $this->assertNull($candidate->fresh()->shipping_checked_at);
        }
    }

    public function test_the_job_releases_itself_until_quota_resets(): void
    {
        $rule = $this->rule(['country_code' => 'CN']);
        $this->candidate($rule, 'p-100', '10.00');
        $this->cj->error(1600201, 'Quota exceeded');
        $job = (new CheckCandidateShippingJob($rule))->withFakeQueueInteractions();

        $job->handle(app(CheckCandidateShipping::class));

        $job->assertReleased();
    }

    public function test_discovery_queues_the_check_only_for_rules_with_a_freight_filter(): void
    {
        Queue::fake([CheckCandidateShippingJob::class]);
        $withFilter = $this->rule(['keyword' => 'case']);
        $withoutFilter = $this->rule(['keyword' => 'case', 'ship_to_country' => null, 'max_shipping_percent' => null]);
        $this->cj->fixture('list-v2-page')->fixture('list-v2-page');

        (new DiscoverCandidatesJob($withFilter))->handle(app(DiscoverCandidates::class));
        (new DiscoverCandidatesJob($withoutFilter))->handle(app(DiscoverCandidates::class));

        Queue::assertPushed(CheckCandidateShippingJob::class, fn (CheckCandidateShippingJob $job): bool => $job->rule->is($withFilter));
        Queue::assertPushed(CheckCandidateShippingJob::class, 1);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function rule(array $attributes = []): ImportRule
    {
        return ImportRule::create([
            'name' => 'Rule '.uniqid(),
            'keyword' => 'case',
            'markup_percent' => '100',
            'rounding' => PriceRounding::None,
            'product_type_id' => $this->productType->id,
            'ship_to_country' => 'GB',
            'max_shipping_percent' => '100',
            'max_quotes_per_run' => 50,
            ...$attributes,
        ]);
    }

    private function candidate(ImportRule $rule, string $cjProductId, ?string $costUsd): Candidate
    {
        return Candidate::create([
            'import_rule_id' => $rule->id,
            'cj_product_id' => $cjProductId,
            'name' => 'Product '.$cjProductId,
            'cost_usd' => $costUsd,
            'status' => CandidateStatus::Pending,
            'payload' => [],
            'discovered_at' => now(),
        ]);
    }
}
