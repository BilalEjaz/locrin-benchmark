<?php

declare(strict_types=1);

namespace NeneProfile\ImportJob;

use Nene2\Export\CsvWriter;

/**
 * Renders StandardTransaction rows to CSV via the framework writer
 * {@see \Nene2\Export\CsvWriter} (ADR 0015).
 *
 * Formula-injection defence (compliance §3.4) is now provided by the writer's
 * default, type-based neutralisation: any STRING cell beginning with `=`, `+`,
 * `-`, `@`, TAB or CR is prefixed with a single quote so spreadsheet software
 * treats it as text. Numeric fields (amount_cents, balance_cents, ids, row
 * numbers) are emitted as native integers and therefore pass through untouched —
 * a legitimate leading `-` on a negative amount is preserved. Only the writer's
 * trigger set widened (TAB/CR added); the `= + - @` behaviour for the bank free
 * text (description, counterparty) is unchanged.
 *
 * BOM is kept off to preserve profile's existing byte-for-byte output; the
 * framework default is on. Fleet-wide BOM unification is a separate follow-up
 * (ADR 0015 / upstream design 03 §5-2). The bank CSV import path (CsvParser)
 * is out of scope.
 */
final class CsvExporter
{
    /** Columns emitted as native integers so a legitimate leading `-` survives. */
    private const NUMERIC_COLUMNS = [
        'amount_cents', 'balance_cents', 'raw_row_number', 'import_job_id', 'preset_version_id',
    ];

    /**
     * @param list<NormalizedTransaction> $transactions
     */
    public static function export(array $transactions, int $importJobId, int $presetVersionId): string
    {
        $out = fopen('php://temp', 'r+');
        if ($out === false) {
            return '';
        }

        $writer = new CsvWriter($out, StandardTransactionSerializer::CSV_COLUMNS, bom: false);
        $writer->writeAll(self::rows($transactions, $importJobId, $presetVersionId));

        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        return $csv === false ? '' : $csv;
    }

    /**
     * @param list<NormalizedTransaction> $transactions
     *
     * @return iterable<list<string|int|null>>
     */
    private static function rows(array $transactions, int $importJobId, int $presetVersionId): iterable
    {
        foreach ($transactions as $t) {
            $row = StandardTransactionSerializer::toArray($t, $importJobId, $presetVersionId);
            $cells = [];
            foreach (StandardTransactionSerializer::CSV_COLUMNS as $col) {
                $value = $row[$col] ?? null;
                if ($value === null) {
                    $cells[] = null;
                } elseif (in_array($col, self::NUMERIC_COLUMNS, true)) {
                    $cells[] = (int) $value;
                } else {
                    $cells[] = (string) $value;
                }
            }

            yield $cells;
        }
    }
}
