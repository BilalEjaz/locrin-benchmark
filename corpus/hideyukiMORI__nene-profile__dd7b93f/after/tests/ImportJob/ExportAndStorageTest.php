<?php

declare(strict_types=1);

namespace NeneProfile\Tests\ImportJob;

use NeneProfile\ImportJob\CsvExporter;
use NeneProfile\ImportJob\LocalFileStorage;
use NeneProfile\ImportJob\NormalizedTransaction;
use NeneProfile\ImportJob\StandardTransactionSerializer;
use NeneProfile\Tests\Support\FixedClock;
use PHPUnit\Framework\TestCase;

final class ExportAndStorageTest extends TestCase
{
    private function txn(string $description, int $amount = 100000, ?string $counterparty = null): NormalizedTransaction
    {
        return new NormalizedTransaction(
            rawRowNumber: 2,
            transactionDate: '2026-05-15',
            valueDate: '2026-05-15',
            amountCents: $amount,
            description: $description,
            counterparty: $counterparty,
            balanceCents: 5025000,
            lineHash: 'sha256:abc',
        );
    }

    public function test_serializer_includes_all_provenance_fields(): void
    {
        $arr = StandardTransactionSerializer::toArray($this->txn('振込'), 42, 7);

        $this->assertSame('1.0', $arr['schema_version']);
        $this->assertSame('42', $arr['import_job_id']);
        $this->assertSame('7', $arr['preset_version_id']);
        $this->assertSame('sha256:abc', $arr['line_hash']);
        $this->assertSame(2, $arr['raw_row_number']);
    }

    public function test_csv_export_has_header_and_rows(): void
    {
        $csv = CsvExporter::export([$this->txn('振込')], 42, 7);

        $lines = explode("\n", trim($csv));
        $this->assertStringContainsString('schema_version', $lines[0]);
        $this->assertStringContainsString('振込', $csv);
    }

    public function test_csv_export_negative_amount_not_mangled(): void
    {
        $csv = CsvExporter::export([$this->txn('引落', -30000)], 1, 1);

        // Amount column must remain "-30000", not "'-30000".
        $this->assertStringContainsString('-30000', $csv);
        $this->assertStringNotContainsString("'-30000", $csv);
    }

    public function test_csv_export_sanitizes_formula_in_description(): void
    {
        $csv = CsvExporter::export([$this->txn('=SUM(A1:A9)')], 1, 1);

        // Leading = in a text field is neutralized with a leading apostrophe.
        $this->assertStringContainsString("'=SUM(A1:A9)", $csv);
    }

    public function test_local_storage_round_trip_and_no_overwrite(): void
    {
        $base = sys_get_temp_dir() . '/nene-profile-test-' . bin2hex(random_bytes(4));
        $storage = new LocalFileStorage($base, new FixedClock());

        $key1 = $storage->store(7, 'hello');
        $key2 = $storage->store(7, 'hello'); // same content → different key (no overwrite)

        $this->assertNotSame($key1, $key2);
        $this->assertSame('hello', $storage->read($key1));
        $this->assertTrue($storage->exists($key1));

        // cleanup
        @unlink($base . '/' . $key1);
        @unlink($base . '/' . $key2);
        @rmdir($base . '/7');
        @rmdir($base);
    }
}
