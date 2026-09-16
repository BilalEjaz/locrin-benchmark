<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Lunar\Models\Brand;
use Lunar\Models\Collection;
use Lunar\Models\ProductType;
use Thayron\LunarCjDropshipping\Enums\PriceRounding;

/**
 * @property int $id
 * @property string $name
 * @property bool $is_active
 * @property list<string>|null $category_ids
 * @property string|null $keyword
 * @property string|null $country_code
 * @property int $min_stock
 * @property string|null $min_cost
 * @property string|null $max_cost
 * @property string $markup_percent
 * @property PriceRounding $rounding
 * @property int $product_type_id
 * @property int|null $brand_id
 * @property int|null $collection_id
 * @property int $max_pages
 * @property Carbon|null $last_run_at
 * @property array<string, mixed>|null $last_run_stats
 */
class ImportRule extends Model
{
    protected $table = 'cj_import_rules';

    protected $guarded = [];

    protected $attributes = [
        'is_active' => true,
        'min_stock' => 0,
        'max_pages' => 5,
        'rounding' => 'none',
        'markup_percent' => 0,
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'category_ids' => 'array',
            'min_stock' => 'integer',
            'max_pages' => 'integer',
            'min_cost' => 'decimal:2',
            'max_cost' => 'decimal:2',
            'markup_percent' => 'decimal:2',
            'rounding' => PriceRounding::class,
            'last_run_at' => 'datetime',
            'last_run_stats' => 'array',
        ];
    }

    /**
     * @return BelongsTo<ProductType, $this>
     */
    public function productType(): BelongsTo
    {
        return $this->belongsTo(ProductType::class);
    }

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /**
     * @return BelongsTo<Collection, $this>
     */
    public function collection(): BelongsTo
    {
        return $this->belongsTo(Collection::class);
    }

    /**
     * @return HasMany<Candidate, $this>
     */
    public function candidates(): HasMany
    {
        return $this->hasMany(Candidate::class);
    }

    /**
     * @return HasMany<ProductLink, $this>
     */
    public function productLinks(): HasMany
    {
        return $this->hasMany(ProductLink::class);
    }
}
