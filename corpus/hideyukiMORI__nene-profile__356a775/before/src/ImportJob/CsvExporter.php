<?php

declare(strict_types=1);

namespace NeneProfile\ImportJob;

/**
 * Renders StandardTransaction rows to CSV.
 *
 * Formula injection defense (compliance §3.4): for user-derived TEXT fields
 * (description, counterparty), any value beginning with `=`, `+`, `-`, or `@` is
 * prefixed with a single quote so spreadsheet software treats it as text.
 *
 * Numeric and system-generated fields (amount_cents, dates, ids, hashes) are NOT
 * sanitized — a leading `-` on a negative amount is legitimate data, and those
 * fields cannot carry attacker-controlled formulas.
 */
final class CsvExporter
{
    /** Fields whose values originate from the bank CSV free text. */
    private const TEXT_FIELDS = ['description', 'counterparty'];

    /**
     * @param list<NormalizedTransaction> $transactions
     */
    public static function export(array $transactions, int $importJobId, int $presetVersionId): string
    {
        $out = fopen('php://temp', 'r+');
        if ($out === false) {
            return '';
        }

        fputcsv($out, StandardTransactionSerializer::CSV_COLUMNS, ',', '"', '\\');

        foreach ($transactions as $t) {
            $row = StandardTransactionSerializer::toArray($t, $importJobId, $presetVersionId);
            $cells = [];
            foreach (StandardTransactionSerializer::CSV_COLUMNS as $col) {
                $value = (string) ($row[$col] ?? '');
                $cells[] = in_array($col, self::TEXT_FIELDS, true) ? self::sanitize($value) : $value;
            }
            fputcsv($out, $cells, ',', '"', '\\');
        }

        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        return $csv === false ? '' : $csv;
    }

    private static function sanitize(string $value): string
    {
        if ($value !== '' && in_array($value[0], ['=', '+', '-', '@'], true)) {
            return "'" . $value;
        }

        return $value;
    }
}
