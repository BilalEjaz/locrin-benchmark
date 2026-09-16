<?php

declare(strict_types=1);

namespace Reporting\Models;

use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Attributes\UsePolicy;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Reporting\Consts\Reporting;
use Reporting\Database\Factories\ReportFactory;
use Reporting\Policies\ReportPolicy;
use Spatie\Permission\Models\Role;
use Support\Concerns\HasPluginPrefixedTableName;
use Support\Concerns\ModelFactoryHelpers;

/**
 * @property int $id
 * @property string $name
 * @property string|null $group
 * @property string|null $description
 * @property string $generator_class
 * @property bool $is_heavy
 * @property int|null $cooldown_minutes
 * @property bool $generate_csv
 * @property bool $generate_pdf
 * @property string $orientation
 * @property string|null $group_rows_by
 * @property string|null $group_columns_by
 * @property string|null $group_value_column
 * @property bool $is_active
 * @property array<string, mixed>|null $parameters
 * @property int|null $created_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
#[UseFactory(factoryClass: ReportFactory::class)]
#[UsePolicy(class: ReportPolicy::class)]
final class Report extends Model
{
    use HasFactory;
    use HasPluginPrefixedTableName;
    use ModelFactoryHelpers;
    use SoftDeletes;

    protected $guarded = ['id'];

    /**
     * @return HasMany<ReportHistory, $this>
     */
    public function histories(): HasMany
    {
        return $this->hasMany(ReportHistory::class);
    }

    /**
     * @return HasMany<ReportSchedule, $this>
     */
    public function reportSchedules(): HasMany
    {
        return $this->hasMany(ReportSchedule::class);
    }

    /**
     * @return BelongsToMany<Role, $this>
     */
    public function roles(): BelongsToMany
    {
        return $this
            ->belongsToMany(Role::class, 'reporting_report_role')
            ->withPivot('can_access_all_tenants');
    }

    /**
     * @return BelongsToMany<ReportingSchedule, $this>
     */
    public function schedules(): BelongsToMany
    {
        return $this
            ->belongsToMany(ReportingSchedule::class, 'reporting_report_schedules')
            ->withPivot('is_active')
            ->withTimestamps();
    }

    public function isGrouped(): bool
    {
        return filled($this->group_rows_by) && filled($this->group_columns_by);
    }

    public function latestHistory(): HasMany
    {
        return $this->histories()->latest()->limit(1);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'generate_csv' => 'boolean',
            'generate_pdf' => 'boolean',
            'is_active' => 'boolean',
            'parameters' => 'array',
            'is_heavy' => 'boolean',
        ];
    }

    protected function getPluginName(): string
    {
        return Reporting::NAME;
    }
}
