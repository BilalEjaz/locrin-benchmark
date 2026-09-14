<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Actions;

use Thayron\CjDropshipping\CjClient;
use Thayron\CjDropshipping\Data\FreightOption;
use Thayron\CjDropshipping\Data\Variant as CjVariant;
use Thayron\CjDropshipping\Exceptions\NotFoundException;
use Thayron\CjDropshipping\Exceptions\QuotaExceededException;
use Thayron\LunarCjDropshipping\Enums\CandidateStatus;
use Thayron\LunarCjDropshipping\Logistics\FreightQuoter;
use Thayron\LunarCjDropshipping\Models\Candidate;
use Thayron\LunarCjDropshipping\Models\ImportRule;
use Thayron\LunarCjDropshipping\Support\CjLog;
use Thayron\LunarCjDropshipping\Support\Throttle;
use Throwable;

/**
 * Quotes shipping for a rule's new candidates and marks the ones whose shipping is too expensive.
 * Each candidate costs one product call and one freight quote (10 CJ quota points).
 */
final class CheckCandidateShipping
{
    private const SCALE = 12;

    public function __construct(
        private readonly CjClient $cj,
        private readonly Throttle $throttle,
        private readonly FreightQuoter $quoter,
    ) {}

    /**
     * @return array{checked: int, too_high: int, skipped: int}
     *
     * @throws QuotaExceededException
     */
    public function handle(ImportRule $rule): array
    {
        $stats = ['checked' => 0, 'too_high' => 0, 'skipped' => 0];

        if (! $rule->hasFreightFilter()) {
            return $stats;
        }

        $candidates = $rule->candidates()
            ->where('status', CandidateStatus::Pending->value)
            ->whereNull('shipping_checked_at')
            ->orderBy('id')
            ->limit(max(1, $rule->max_quotes_per_run))
            ->get();

        foreach ($candidates as $candidate) {
            try {
                $shipping = $this->cheapestShipping($rule, $candidate);
            } catch (QuotaExceededException $exception) {
                throw $exception;
            } catch (NotFoundException) {
                $this->recordCheck($candidate, ['shipping_checked_at' => now()], CandidateStatus::Unavailable);
                $stats['skipped']++;

                continue;
            } catch (Throwable $exception) {
                CjLog::channel()->warning('CJ shipping check failed', ['cj_product_id' => $candidate->cj_product_id, 'message' => $exception->getMessage()]);
                $candidate->forceFill(['shipping_usd' => null, 'shipping_checked_at' => now()])->save();
                $stats['skipped']++;

                continue;
            }

            $tooHigh = $shipping === null || $this->exceedsLimit($rule, $candidate, $shipping);

            $updated = $this->recordCheck(
                $candidate,
                ['shipping_usd' => $shipping, 'shipping_checked_at' => now()],
                $tooHigh ? CandidateStatus::ShippingTooHigh : CandidateStatus::Pending,
            );

            $stats['checked']++;
            $stats['too_high'] += ($tooHigh && $updated) ? 1 : 0;
        }

        return $stats;
    }

    /**
     * Persists the outcome of a shipping check for one candidate without overwriting a status the
     * admin may have changed while the check (which can take minutes, throttled by CJ quota) was
     * running. `$alwaysAttributes` (shipping_usd and/or shipping_checked_at) are written
     * unconditionally; the status only moves to `$statusIfPending` while the row is still Pending,
     * so an Approved/Importing/Imported/Ignored candidate keeps whatever the admin set.
     *
     * @param  array<string, mixed>  $alwaysAttributes
     */
    private function recordCheck(Candidate $candidate, array $alwaysAttributes, CandidateStatus $statusIfPending): bool
    {
        if ($alwaysAttributes !== []) {
            Candidate::query()->whereKey($candidate->id)->update($alwaysAttributes);
        }

        return Candidate::query()
            ->whereKey($candidate->id)
            ->where('status', CandidateStatus::Pending->value)
            ->update(['status' => $statusIfPending->value]) > 0;
    }

    private function cheapestShipping(ImportRule $rule, Candidate $candidate): ?string
    {
        $this->throttle->wait();
        $product = $this->cj->products()->find($candidate->cj_product_id);

        /** @var CjVariant|null $lightest */
        $lightest = collect($product->variants)
            ->sortBy(fn (CjVariant $variant): float => is_numeric($variant->weight) ? (float) $variant->weight : PHP_FLOAT_MAX)
            ->first();

        if ($lightest === null) {
            return null;
        }

        $from = filled($rule->country_code) ? strtoupper((string) $rule->country_code) : $this->originFor($candidate);
        $quote = $this->quoter->quote($product->id, $from, strtoupper((string) $rule->ship_to_country), [$lightest->id => $lightest->weight]);

        $prices = array_values(array_filter(
            array_map(fn (FreightOption $option): ?string => $option->priceUsd, $quote[$lightest->id] ?? []),
            fn (?string $price): bool => is_numeric($price),
        ));

        if ($prices === []) {
            return null;
        }

        usort($prices, fn (string $a, string $b): int => bccomp($a, $b, 4));

        return bcadd($prices[0], '0', 2);
    }

    private function originFor(Candidate $candidate): string
    {
        $this->throttle->wait();
        $inventory = $this->cj->products()->inventoryByProduct($candidate->cj_product_id);

        foreach ($inventory->warehouses as $stock) {
            if ($stock->countryCode !== null && $stock->total > 0) {
                return strtoupper($stock->countryCode);
            }
        }

        return 'CN';
    }

    private function exceedsLimit(ImportRule $rule, Candidate $candidate, string $shipping): bool
    {
        if ($candidate->cost_usd === null) {
            return false;
        }

        $limit = bcdiv(bcmul((string) $candidate->cost_usd, (string) $rule->max_shipping_percent, self::SCALE), '100', self::SCALE);

        return bccomp($shipping, $limit, 2) > 0;
    }
}
