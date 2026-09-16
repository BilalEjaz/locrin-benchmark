<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Lunar\Models\Product;
use Thayron\CjDropshipping\Data\ProductSummary;
use Thayron\LunarCjDropshipping\Enums\CandidateSource;
use Thayron\LunarCjDropshipping\Enums\CandidateStatus;
use Thayron\LunarCjDropshipping\Pricing\CostParser;

/**
 * @property int $id
 * @property int|null $import_rule_id
 * @property CandidateSource $source
 * @property string $cj_product_id
 * @property string|null $cj_sku
 * @property string $name
 * @property string|null $image_url
 * @property string|null $cost_usd
 * @property int|null $warehouse_stock
 * @property string|null $cj_category_id
 * @property CandidateStatus $status
 * @property string|null $error
 * @property int|null $lunar_product_id
 * @property array<string, mixed> $payload
 * @property array<string, mixed>|null $listing
 * @property Carbon|null $listed_at
 * @property Carbon $discovered_at
 * @property-read ImportRule|null $importRule
 */
class Candidate extends Model
{
    protected $table = 'cj_candidates';

    protected $guarded = [];

    protected $attributes = [
        'source' => 'rule',
    ];

    protected function casts(): array
    {
        return [
            'source' => CandidateSource::class,
            'status' => CandidateStatus::class,
            'cost_usd' => 'decimal:2',
            'warehouse_stock' => 'integer',
            'payload' => 'array',
            'listing' => 'array',
            'listed_at' => 'datetime',
            'discovered_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<ImportRule, $this>
     */
    public function importRule(): BelongsTo
    {
        return $this->belongsTo(ImportRule::class);
    }

    /**
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class, 'lunar_product_id');
    }

    public function fillFromSummary(ProductSummary $summary): static
    {
        return $this->fill([
            'cj_product_id' => $summary->id,
            'cj_sku' => $summary->sku,
            'name' => Str::limit($summary->name ?? $summary->sku ?? $summary->id, 255, ''),
            'image_url' => $summary->image,
            'cost_usd' => CostParser::lowest($summary->sellPrice),
            'warehouse_stock' => $summary->warehouseInventory,
            'cj_category_id' => $summary->categoryId,
            'payload' => $summary->raw(),
        ]);
    }
}
