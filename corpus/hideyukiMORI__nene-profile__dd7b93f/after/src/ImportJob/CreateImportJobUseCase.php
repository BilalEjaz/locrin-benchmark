<?php

declare(strict_types=1);

namespace NeneProfile\ImportJob;

use Closure;
use Nene2\Audit\AuditEvent;
use Nene2\Audit\AuditRecorderFactoryInterface;
use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Database\DatabaseTransactionManagerInterface;
use Nene2\Http\ClockInterface;
use NeneProfile\OrgSettings\OrganizationSettings;
use NeneProfile\OrgSettings\OrganizationSettingsRepositoryInterface;
use NeneProfile\Preset\MappingPresetNotFoundException;
use NeneProfile\Preset\MappingPresetRepositoryInterface;
use NeneProfile\Preset\MappingPresetVersionRepositoryInterface;

/**
 * Orchestrates one CSV normalization run (ADR 0004, compliance §3-9):
 *
 *  1. Resolve the preset and its current version (org-scoped).
 *  2. Store the original file IMMUTABLY with its SHA-256 (before processing).
 *  3. Parse + normalize via the runner.
 *  4. Persist normalized rows, errors, and the terminal job state.
 *  5. Record the audit event.
 *
 * The original file hash is computed on the raw bytes and recorded on the job,
 * so any output row can later be re-verified against the stored original.
 *
 * Steps 1-3 (and the parse-failure branch of step 4) run outside a database
 * transaction by design (ADR 0004: the original file + its initial job row must
 * be durable *before* the potentially slow parse/normalize work starts, so a
 * crash mid-parse still leaves a recoverable "running" job). Only the terminal
 * write of step 4 (row/error persistence + status flip) and the step 5 audit
 * record are wrapped in one transaction, so the job never finishes without a
 * matching audit entry (or vice versa).
 */
final readonly class CreateImportJobUseCase implements CreateImportJobUseCaseInterface
{
    /**
     * @param Closure(DatabaseQueryExecutorInterface): ImportJobRepositoryInterface $jobsFactory
     */
    public function __construct(
        private ImportJobRepositoryInterface $jobs,
        private MappingPresetRepositoryInterface $presets,
        private MappingPresetVersionRepositoryInterface $versions,
        private FileStorageInterface $storage,
        private CsvParser $parser,
        private NormalizationRunner $runner,
        private DatabaseTransactionManagerInterface $tx,
        private Closure $jobsFactory,
        private AuditRecorderFactoryInterface $auditFactory,
        private OrganizationSettingsRepositoryInterface $settings,
        private ClockInterface $clock,
    ) {
    }

    public function execute(CreateImportJobInput $input): ImportJob
    {
        // Enforce the organization's configured upload limit, not a global
        // constant (backend-standards §7). Falls back to the documented default
        // when the organization has no settings row yet.
        $settings = $this->settings->findByOrganizationId($input->organizationId)
            ?? OrganizationSettings::defaultsFor($input->organizationId);

        if (strlen($input->fileContents) > $settings->maxFileSizeBytes) {
            throw new ImportFileTooLargeException($settings->maxFileSizeBytes);
        }

        $preset = $this->presets->findByIdInOrganization($input->presetId, $input->organizationId);

        if ($preset === null || $preset->currentVersionId === null) {
            throw new MappingPresetNotFoundException($input->presetId);
        }

        $version = $this->versions->findById($preset->currentVersionId);

        if ($version === null) {
            throw new MappingPresetNotFoundException($input->presetId);
        }

        // Store the original immutably + hash BEFORE any processing (ADR 0004).
        $fileHash = hash('sha256', $input->fileContents);
        $this->storage->store($input->organizationId, $input->fileContents);

        $now = $this->clock->now()->format('Y-m-d H:i:s');
        $jobId = $this->jobs->save(new ImportJob(
            id: 0,
            organizationId: $input->organizationId,
            actorUserId: $input->actorUserId,
            presetVersionId: $version->id,
            originalFilename: $input->originalFilename,
            originalFileHash: $fileHash,
            status: ImportJob::STATUS_RUNNING,
            rowCount: 0,
            errorCount: 0,
            startedAt: $now,
        ));

        // Parse + normalize. A whole-file parse failure marks the job failed.
        // Not audited (pre-existing behavior): only a completed run records an
        // audit event.
        try {
            $parsed = $this->parser->parse($input->fileContents, $version->definition);
        } catch (CsvParseException $e) {
            $this->jobs->appendErrors($jobId, [new ImportJobError(
                rawRowNumber: 0,
                message: $e->getMessage(),
            )]);
            $this->jobs->complete($jobId, ImportJob::STATUS_FAILED, 0, 1);

            return $this->finish($this->jobs, $jobId, $input->organizationId);
        }

        $result = $this->runner->run($parsed, $version->definition);

        return $this->tx->transactional(function (DatabaseQueryExecutorInterface $exec) use ($input, $jobId, $result): ImportJob {
            $jobs = ($this->jobsFactory)($exec);

            $jobs->appendTransactions($jobId, $result->transactions);
            $jobs->appendErrors($jobId, $result->errors);
            $jobs->complete(
                $jobId,
                $result->deriveStatus(),
                count($result->transactions),
                count($result->errors),
            );

            $job = $this->finish($jobs, $jobId, $input->organizationId);

            $this->auditFactory->forExecutor($exec)->record(new AuditEvent(
                action: 'import_job.' . ($result->hasErrors() ? 'completed_with_errors' : 'completed'),
                entityType: 'import_job',
                entityId: $jobId,
                actorId: $input->actorUserId,
                organizationId: $input->organizationId,
                before: null,
                after: ImportJobSnapshot::toArray($job),
            ));

            return $job;
        });
    }

    private function finish(ImportJobRepositoryInterface $jobs, int $jobId, int $organizationId): ImportJob
    {
        $job = $jobs->findByIdInOrganization($jobId, $organizationId);
        assert($job !== null);

        return $job;
    }
}
