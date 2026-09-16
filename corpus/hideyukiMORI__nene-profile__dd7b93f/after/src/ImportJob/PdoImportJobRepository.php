<?php

declare(strict_types=1);

namespace NeneProfile\ImportJob;

use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Http\ClockInterface;

final readonly class PdoImportJobRepository implements ImportJobRepositoryInterface
{
    private const JOB_COLUMNS = 'id, organization_id, actor_user_id, preset_version_id, original_filename,
        original_file_hash, status, row_count, error_count, started_at, completed_at, created_at, updated_at';

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
        private ClockInterface $clock,
    ) {
    }

    public function findByIdInOrganization(int $id, int $organizationId): ?ImportJob
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::JOB_COLUMNS . ' FROM import_jobs WHERE id = ? AND organization_id = ?',
            [$id, $organizationId],
        );

        return $row !== null ? $this->mapJob($row) : null;
    }

    /** @return list<ImportJob> */
    public function findByOrganizationId(int $organizationId, int $limit, int $offset): array
    {
        $rows = $this->query->fetchAll(
            'SELECT ' . self::JOB_COLUMNS . ' FROM import_jobs WHERE organization_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
            [$organizationId, $limit, $offset],
        );

        return array_map($this->mapJob(...), $rows);
    }

    public function countByOrganizationId(int $organizationId): int
    {
        $row = $this->query->fetchOne('SELECT COUNT(*) AS cnt FROM import_jobs WHERE organization_id = ?', [$organizationId]);

        return (int) ($row['cnt'] ?? 0);
    }

    public function save(ImportJob $job): int
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s');
        $this->query->execute(
            'INSERT INTO import_jobs
                (organization_id, actor_user_id, preset_version_id, original_filename, original_file_hash,
                 status, row_count, error_count, started_at, completed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $job->organizationId,
                $job->actorUserId,
                $job->presetVersionId,
                $job->originalFilename,
                $job->originalFileHash,
                $job->status,
                $job->rowCount,
                $job->errorCount,
                $job->startedAt,
                $job->completedAt,
                $now,
                $now,
            ],
        );

        return $this->query->lastInsertId();
    }

    public function complete(int $id, string $status, int $rowCount, int $errorCount): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s');
        $this->query->execute(
            'UPDATE import_jobs SET status = ?, row_count = ?, error_count = ?, completed_at = ?, updated_at = ? WHERE id = ?',
            [$status, $rowCount, $errorCount, $now, $now, $id],
        );
    }

    /** @param list<ImportJobError> $errors */
    public function appendErrors(int $importJobId, array $errors): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s');
        foreach ($errors as $error) {
            $this->query->execute(
                'INSERT INTO import_job_errors (import_job_id, raw_row_number, message, raw_snippet, created_at)
                 VALUES (?, ?, ?, ?, ?)',
                [$importJobId, $error->rawRowNumber, $error->message, $error->rawSnippet, $now],
            );
        }
    }

    /** @return list<ImportJobError> */
    public function findErrors(int $importJobId, int $limit, int $offset): array
    {
        $rows = $this->query->fetchAll(
            'SELECT id, import_job_id, raw_row_number, message, raw_snippet
             FROM import_job_errors WHERE import_job_id = ? ORDER BY raw_row_number ASC LIMIT ? OFFSET ?',
            [$importJobId, $limit, $offset],
        );

        return array_map(
            static fn (array $r): ImportJobError => new ImportJobError(
                rawRowNumber: (int) $r['raw_row_number'],
                message: (string) $r['message'],
                rawSnippet: isset($r['raw_snippet']) ? (string) $r['raw_snippet'] : null,
                id: (int) $r['id'],
                importJobId: (int) $r['import_job_id'],
            ),
            $rows,
        );
    }

    public function countErrors(int $importJobId): int
    {
        $row = $this->query->fetchOne('SELECT COUNT(*) AS cnt FROM import_job_errors WHERE import_job_id = ?', [$importJobId]);

        return (int) ($row['cnt'] ?? 0);
    }

    /** @param list<NormalizedTransaction> $transactions */
    public function appendTransactions(int $importJobId, array $transactions): void
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s');
        foreach ($transactions as $t) {
            $this->query->execute(
                'INSERT INTO normalized_transactions
                    (import_job_id, raw_row_number, transaction_date, value_date, amount_cents, description,
                     counterparty, balance_cents, currency, line_hash, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $importJobId,
                    $t->rawRowNumber,
                    $t->transactionDate,
                    $t->valueDate,
                    $t->amountCents,
                    $t->description,
                    $t->counterparty,
                    $t->balanceCents,
                    $t->currency,
                    $t->lineHash,
                    $now,
                ],
            );
        }
    }

    /** @return list<NormalizedTransaction> */
    public function findTransactions(int $importJobId): array
    {
        $rows = $this->query->fetchAll(
            'SELECT id, import_job_id, raw_row_number, transaction_date, value_date, amount_cents, description,
                    counterparty, balance_cents, currency, line_hash
             FROM normalized_transactions WHERE import_job_id = ? ORDER BY raw_row_number ASC',
            [$importJobId],
        );

        return array_map(
            static fn (array $r): NormalizedTransaction => new NormalizedTransaction(
                rawRowNumber: (int) $r['raw_row_number'],
                transactionDate: (string) $r['transaction_date'],
                valueDate: (string) $r['value_date'],
                amountCents: (int) $r['amount_cents'],
                description: (string) $r['description'],
                counterparty: isset($r['counterparty']) ? (string) $r['counterparty'] : null,
                balanceCents: isset($r['balance_cents']) ? (int) $r['balance_cents'] : null,
                lineHash: (string) $r['line_hash'],
                currency: (string) $r['currency'],
                id: (int) $r['id'],
                importJobId: (int) $r['import_job_id'],
            ),
            $rows,
        );
    }

    /** @param array<string, mixed> $row */
    private function mapJob(array $row): ImportJob
    {
        return new ImportJob(
            id: (int) $row['id'],
            organizationId: (int) $row['organization_id'],
            actorUserId: isset($row['actor_user_id']) ? (int) $row['actor_user_id'] : null,
            presetVersionId: (int) $row['preset_version_id'],
            originalFilename: (string) $row['original_filename'],
            originalFileHash: (string) $row['original_file_hash'],
            status: (string) $row['status'],
            rowCount: (int) $row['row_count'],
            errorCount: (int) $row['error_count'],
            startedAt: isset($row['started_at']) ? (string) $row['started_at'] : null,
            completedAt: isset($row['completed_at']) ? (string) $row['completed_at'] : null,
            createdAt: isset($row['created_at']) ? (string) $row['created_at'] : null,
            updatedAt: isset($row['updated_at']) ? (string) $row['updated_at'] : null,
        );
    }
}
