<?php

declare(strict_types=1);

namespace Reporting\Models;

use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Reporting\Concerns\HasPluginPrefixedTableName;
use Reporting\Concerns\ModelFactoryHelpers;
use Reporting\Consts\Reporting;
use Reporting\Database\Factories\ReportScheduleFactory;

/**
 * @property int $id
 * @property int $report_id
 * @property int $schedule_id
 * @property bool $is_active
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[UseFactory(factoryClass: ReportScheduleFactory::class)]
final class ReportSchedule extends Model
{
    use HasFactory;
    use HasPluginPrefixedTableName;
    use ModelFactoryHelpers;

    protected $guarded = ['id'];

    /**
     * @return BelongsTo<Report, $this>
     */
    public function report(): BelongsTo
    {
        return $this->belongsTo(Report::class);
    }

    /**
     * @return BelongsTo<ReportingSchedule, $this>
     */
    public function schedule(): BelongsTo
    {
        return $this->belongsTo(ReportingSchedule::class, 'reporting_schedule_id');
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
