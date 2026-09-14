<?php

declare(strict_types=1);

namespace NeneProfile\Tests\ImportJob;

use NeneProfile\ImportJob\ImportJob;
use NeneProfile\ImportJob\ImportJobError;
use NeneProfile\ImportJob\NormalizedTransaction;
use NeneProfile\ImportJob\PdoImportJobRepository;
use NeneProfile\Tests\Support\FixedClock;
use NeneProfile\Tests\Support\SqlitePdoTestTrait;
use PDO;
use PHPUnit\Framework\TestCase;

final class PdoImportJobRepositorySqliteTest extends TestCase
{
    use SqlitePdoTestTrait;

    private PdoImportJobRepository $repo;

    protected function setUp(): void
    {
        $pdo = $this->sqlitePdo();
        $this->createSchema($pdo);
        $this->repo = new PdoImportJobRepository($this->executor($pdo), new FixedClock());
    }

    private function createSchema(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE import_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                actor_user_id INTEGER,
                preset_version_id INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                original_file_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT "pending",
                row_count INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )',
        );
        $pdo->exec(
            'CREATE TABLE import_job_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_job_id INTEGER NOT NULL,
                raw_row_number INTEGER NOT NULL,
                message TEXT NOT NULL,
                raw_snippet TEXT,
                created_at TEXT NOT NULL
            )',
        );
        $pdo->exec(
            'CREATE TABLE normalized_transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                import_job_id INTEGER NOT NULL,
                raw_row_number INTEGER NOT NULL,
                transaction_date TEXT NOT NULL,
                value_date TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                description TEXT NOT NULL,
                counterparty TEXT,
                balance_cents INTEGER,
                currency TEXT NOT NULL DEFAULT "JPY",
                line_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            )',
        );
    }

    private function seedJob(int $organizationId = 7): int
    {
        return $this->repo->save(new ImportJob(
            id: 0,
            organizationId: $organizationId,
            actorUserId: 1,
            presetVersionId: 9,
            originalFilename: 'bank.csv',
            originalFileHash: 'hash',
            status: ImportJob::STATUS_PENDING,
            rowCount: 0,
            errorCount: 0,
        ));
    }

    public function test_save_and_org_scoped_lookup(): void
    {
        $id = $this->seedJob(7);

        $this->assertNotNull($this->repo->findByIdInOrganization($id, 7));
        $this->assertNull($this->repo->findByIdInOrganization($id, 99));

        $job = $this->repo->findByIdInOrganization($id, 7);
        $this->assertNotNull($job);
        $this->assertSame('bank.csv', $job->originalFilename);
        $this->assertSame(ImportJob::STATUS_PENDING, $job->status);
    }

    public function test_complete_updates_status_and_counts(): void
    {
        $id = $this->seedJob();

        $this->repo->complete($id, ImportJob::STATUS_COMPLETED_WITH_ERRORS, 10, 2);

        $job = $this->repo->findByIdInOrganization($id, 7);
        $this->assertNotNull($job);
        $this->assertSame(ImportJob::STATUS_COMPLETED_WITH_ERRORS, $job->status);
        $this->assertSame(10, $job->rowCount);
        $this->assertSame(2, $job->errorCount);
        $this->assertNotNull($job->completedAt);
    }

    public function test_errors_append_find_and_count(): void
    {
        $id = $this->seedJob();
        $this->repo->appendErrors($id, [
            new ImportJobError(rawRowNumber: 3, message: 'bad date', rawSnippet: '...'),
            new ImportJobError(rawRowNumber: 5, message: 'bad amount'),
        ]);

        $this->assertSame(2, $this->repo->countErrors($id));
        $errors = $this->repo->findErrors($id, 20, 0);
        $this->assertCount(2, $errors);
        // Ordered by raw_row_number ASC.
        $this->assertSame(3, $errors[0]->rawRowNumber);
        $this->assertSame('bad amount', $errors[1]->message);
        $this->assertNull($errors[1]->rawSnippet);
    }

    public function test_list_and_count_by_organization(): void
    {
        $this->seedJob(7);
        $this->seedJob(7);
        $this->seedJob(8);

        $this->assertSame(2, $this->repo->countByOrganizationId(7));
        $this->assertCount(2, $this->repo->findByOrganizationId(7, 50, 0));
        $this->assertCount(1, $this->repo->findByOrganizationId(8, 50, 0));
    }

    public function test_transactions_append_and_find(): void
    {
        $id = $this->seedJob();
        $this->repo->appendTransactions($id, [
            new NormalizedTransaction(
                rawRowNumber: 2,
                transactionDate: '2026-05-30',
                valueDate: '2026-05-30',
                amountCents: -1500,
                description: 'コンビニ',
                counterparty: null,
                balanceCents: 98500,
                lineHash: 'abc',
            ),
        ]);

        $rows = $this->repo->findTransactions($id);
        $this->assertCount(1, $rows);
        $this->assertSame(-1500, $rows[0]->amountCents);
        $this->assertSame(98500, $rows[0]->balanceCents);
        $this->assertSame('JPY', $rows[0]->currency);
    }
}
