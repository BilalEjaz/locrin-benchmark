<?php

declare(strict_types=1);

namespace Reporting\Models;

use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;
use Reporting\Concerns\HasPluginPrefixedTableName;
use Reporting\Concerns\ModelFactoryHelpers;
use Reporting\Consts\Reporting;
use Reporting\Database\Factories\ReportingScheduleFactory;

/**
 * @property int $id
 * @property string $name
 * @property string|null $description
 * @property string $cron_expression
 * @property string $timezone
 * @property bool $is_active
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
#[UseFactory(factoryClass: ReportingScheduleFactory::class)]
final class ReportingSchedule extends Model
{
    use HasFactory;
    use HasPluginPrefixedTableName;
    use ModelFactoryHelpers;
    use SoftDeletes;

    protected $guarded = ['id'];

    /**
     * @return HasMany<ReportSchedule, $this>
     */
    public function reportSchedules(): HasMany
    {
        return $this->hasMany(ReportSchedule::class);
    }

    /**
     * @return BelongsToMany<Report, $this>
     */
    public function reports(): BelongsToMany
    {
        return $this
            ->belongsToMany(Report::class, 'reporting_report_schedules')
            ->withPivot('is_active')
            ->withTimestamps();
    }

    protected function getPluginName(): string
    {
        return Reporting::NAME;
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
        ];
    }
}
