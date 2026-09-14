<?php

declare(strict_types=1);

namespace Reporting\Models;

use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Reporting\Consts\Reporting;
use Reporting\Consts\ReportStatus;
use Reporting\Database\Factories\ReportHistoryFactory;
use Support\Concerns\HasPluginPrefixedTableName;
use Support\Concerns\ModelFactoryHelpers;

/**
 * @property int $id
 * @property int $report_id
 * @property string $status
 * @property string|null $csv_file_path
 * @property string|null $pdf_file_path
 * @property int|null $file_size
 * @property int|null $row_count
 * @property int|null $execution_time_ms
 * @property string $source
 * @property int|null $triggered_by_user_id
 * @property array<string, mixed>|null $modifiers
 * @property Carbon|null $started_at
 * @property Carbon|null $completed_at
 * @property string|null $error_message
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[UseFactory(factoryClass: ReportHistoryFactory::class)]
final class ReportHistory extends Model
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

    public function isCompleted(): bool
    {
        return $this->status === ReportStatus::STATUS_COMPLETED;
    }

    public function isFailed(): bool
    {
        return $this->status === ReportStatus::STATUS_FAILED;
    }

    public function isPending(): bool
    {
        return $this->status === ReportStatus::STATUS_PENDING;
    }

    public function isProcessing(): bool
    {
        return $this->status === ReportStatus::STATUS_PROCESSING;
    }

    public function formattedExecutionTime(): string
    {
        if ($this->execution_time_ms === null) {
            return '-';
        }

        if ($this->execution_time_ms < 1000) {
            return $this->execution_time_ms . 'ms';
        }

        return round($this->execution_time_ms / 1000, 2) . 's';
    }

    public function formattedFileSize(): string
    {
        if ($this->file_size === null) {
            return '-';
        }

        $units = ['B', 'KB', 'MB', 'GB'];
        $size = (float) $this->file_size;
        $unitIndex = 0;

        while ($size >= 1024 && $unitIndex < 3) {
            $size /= 1024;
            ++$unitIndex;
        }

        return round($size, 2) . ' ' . $units[$unitIndex];
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
            'execution_time_ms' => 'integer',
            'completed_at' => 'datetime',
            'started_at' => 'datetime',
            'file_size' => 'integer',
            'row_count' => 'integer',
            'modifiers' => 'array',
        ];
    }
}
