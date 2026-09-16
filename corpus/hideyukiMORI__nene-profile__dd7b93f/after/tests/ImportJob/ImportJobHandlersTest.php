<?php

declare(strict_types=1);

namespace NeneProfile\Tests\ImportJob;

use Closure;
use Nene2\Audit\AuditRecorderFactoryInterface;
use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Routing\Router;
use Nene2\Validation\ValidationException;
use NeneProfile\ImportJob\CreateImportJobHandler;
use NeneProfile\ImportJob\CreateImportJobUseCase;
use NeneProfile\ImportJob\CsvParser;
use NeneProfile\ImportJob\ExportImportJobCsvHandler;
use NeneProfile\ImportJob\ExportImportJobJsonHandler;
use NeneProfile\ImportJob\ExportImportJobUseCase;
use NeneProfile\ImportJob\GetImportJobHandler;
use NeneProfile\ImportJob\GetImportJobUseCase;
use NeneProfile\ImportJob\ImportFileTooLargeException;
use NeneProfile\ImportJob\ImportJob;
use NeneProfile\ImportJob\ImportJobError;
use NeneProfile\ImportJob\ImportJobRepositoryInterface;
use NeneProfile\ImportJob\ListImportJobErrorsHandler;
use NeneProfile\ImportJob\ListImportJobErrorsUseCase;
use NeneProfile\ImportJob\ListImportJobsHandler;
use NeneProfile\ImportJob\ListImportJobsUseCase;
use NeneProfile\ImportJob\NormalizationRunner;
use NeneProfile\ImportJob\NormalizedTransaction;
use NeneProfile\Organization\OrganizationNotResolvedException;
use NeneProfile\OrgSettings\OrganizationSettings;
use NeneProfile\Preset\CreateMappingPresetUseCase;
use NeneProfile\Preset\MappingDefinitionFactory;
use NeneProfile\Preset\MappingPresetRepositoryInterface;
use NeneProfile\Preset\MappingPresetVersionRepositoryInterface;
use NeneProfile\Tests\Audit\InMemoryAuditRecorderFactory;
use NeneProfile\Tests\Http\ProblemDetailsTestTrait;
use NeneProfile\Tests\OrgSettings\InMemoryOrganizationSettingsRepository;
use NeneProfile\Tests\Preset\InMemoryMappingPresetRepository;
use NeneProfile\Tests\Preset\InMemoryMappingPresetVersionRepository;
use NeneProfile\Tests\Support\FixedClock;
use NeneProfile\Tests\Support\ImmediateTransactionManager;
use NeneProfile\Transformer\TransformerRegistry;
use Nyholm\Psr7\UploadedFile;
use PHPUnit\Framework\TestCase;

final class ImportJobHandlersTest extends TestCase
{
    use ProblemDetailsTestTrait;

    private InMemoryImportJobRepository $jobs;
    private InMemoryFileStorage $storage;
    private InMemoryMappingPresetRepository $presets;
    private InMemoryMappingPresetVersionRepository $versions;
    private AuditRecorderFactoryInterface $audit;
    private InMemoryOrganizationSettingsRepository $settings;
    private int $presetVersionId;

    protected function setUp(): void
    {
        $this->jobs     = new InMemoryImportJobRepository();
        $this->storage  = new InMemoryFileStorage();
        $this->presets  = new InMemoryMappingPresetRepository();
        $this->versions = new InMemoryMappingPresetVersionRepository();
        $this->audit    = new InMemoryAuditRecorderFactory(new FixedClock());
        $this->settings = new InMemoryOrganizationSettingsRepository();

        // Seed a preset+version to use in tests
        $uc  = new CreateMappingPresetUseCase(new ImmediateTransactionManager(), $this->presetsFactory(), $this->versionsFactory(), $this->audit);
        $def = MappingDefinitionFactory::fromArray([
            'encoding'         => 'auto',
            'delimiter'        => 'auto',
            'header_row_index' => 0,
            'year_pivot'       => 50,
            'columns'          => [
                'transaction_date' => ['source' => '日付', 'transform' => 'date_ymd_slash'],
                'amount_cents'     => ['source' => ['入金額', '出金額'], 'transform' => 'debit_credit_to_signed_cents'],
                'description'      => ['source' => '摘要', 'transform' => 'trim'],
            ],
        ]);
        $result = $uc->execute(1, new \NeneProfile\Preset\CreateMappingPresetInput(
            organizationId: 1,
            name: 'MUFG Preset',
            bankLabel: 'MUFG',
            definition: $def,
        ));
        $this->presetVersionId = $result->version->id;
    }

    /** @return Closure(DatabaseQueryExecutorInterface): ImportJobRepositoryInterface */
    private function jobsFactory(): Closure
    {
        $repo = $this->jobs;

        return static fn (DatabaseQueryExecutorInterface $exec): ImportJobRepositoryInterface => $repo;
    }

    /** @return Closure(DatabaseQueryExecutorInterface): MappingPresetRepositoryInterface */
    private function presetsFactory(): Closure
    {
        $repo = $this->presets;

        return static fn (DatabaseQueryExecutorInterface $exec): MappingPresetRepositoryInterface => $repo;
    }

    /** @return Closure(DatabaseQueryExecutorInterface): MappingPresetVersionRepositoryInterface */
    private function versionsFactory(): Closure
    {
        $repo = $this->versions;

        return static fn (DatabaseQueryExecutorInterface $exec): MappingPresetVersionRepositoryInterface => $repo;
    }

    private function createImportJobUseCase(): CreateImportJobUseCase
    {
        return new CreateImportJobUseCase(
            $this->jobs,
            $this->presets,
            $this->versions,
            $this->storage,
            new CsvParser(),
            new NormalizationRunner(new TransformerRegistry()),
            new ImmediateTransactionManager(),
            $this->jobsFactory(),
            $this->audit,
            $this->settings,
            new FixedClock(),
        );
    }

    private function savedJob(int $orgId = 1, string $status = ImportJob::STATUS_COMPLETED): int
    {
        $jobId = $this->jobs->save(new ImportJob(
            id: 0,
            organizationId: $orgId,
            actorUserId: 1,
            presetVersionId: $this->presetVersionId,
            originalFilename: 'test.csv',
            originalFileHash: 'sha256:abc',
            status: $status,
            rowCount: 3,
            errorCount: 0,
            startedAt: date('Y-m-d H:i:s'),
        ));
        $this->jobs->complete($jobId, $status, 3, 0);

        return $jobId;
    }

    // ── GetImportJobHandler ───────────────────────────────────────────────

    public function test_get_returns_job_json(): void
    {
        $id = $this->savedJob();

        $handler = new GetImportJobHandler(
            new GetImportJobUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('GET', "/admin/import-jobs/{$id}"))
            ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => (string) $id]);

        $response = $handler->handle($request);
        $payload  = $this->decodeJson($response);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($id, $payload['id']);
        $this->assertSame('test.csv', $payload['original_filename']);
        $this->assertSame(ImportJob::STATUS_COMPLETED, $payload['status']);
        $this->assertArrayHasKey('row_count', $payload);
        $this->assertArrayHasKey('error_count', $payload);
    }

    public function test_get_returns_400_without_org(): void
    {
        $this->expectException(OrganizationNotResolvedException::class);

        $handler = new GetImportJobHandler(
            new GetImportJobUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $response = $handler->handle(
            $this->request('GET', '/admin/import-jobs/1')
                ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => '1']),
        );

    }

    public function test_get_propagates_not_found(): void
    {
        $this->expectException(\NeneProfile\ImportJob\ImportJobNotFoundException::class);

        $handler = new GetImportJobHandler(
            new GetImportJobUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('GET', '/admin/import-jobs/999'))
            ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => '999']);

        $handler->handle($request);
    }

    // ── ListImportJobsHandler ─────────────────────────────────────────────

    public function test_list_returns_paginated_envelope(): void
    {
        $this->savedJob();
        $this->savedJob();

        $handler = new ListImportJobsHandler(
            new ListImportJobsUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $response = $handler->handle($this->withAuth($this->request('GET', '/admin/import-jobs')));
        $payload  = $this->decodeJson($response);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(2, $payload['total']);
        $this->assertArrayHasKey('items', $payload);
    }

    public function test_list_respects_limit_and_offset(): void
    {
        for ($i = 0; $i < 4; $i++) {
            $this->savedJob();
        }

        $handler = new ListImportJobsHandler(
            new ListImportJobsUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('GET', '/admin/import-jobs'))
            ->withQueryParams(['limit' => '2', 'offset' => '2']);

        $response = $handler->handle($request);
        $payload  = $this->decodeJson($response);

        $this->assertSame(4, $payload['total']);
        $this->assertCount(2, $payload['items']);
    }

    // ── ListImportJobErrorsHandler ────────────────────────────────────────

    public function test_list_errors_returns_error_envelope(): void
    {
        $id = $this->savedJob(status: ImportJob::STATUS_COMPLETED_WITH_ERRORS);
        $this->jobs->appendErrors($id, [
            new ImportJobError(rawRowNumber: 2, message: 'Bad date', rawSnippet: 'row2data'),
            new ImportJobError(rawRowNumber: 5, message: 'Bad amount', rawSnippet: 'row5data'),
        ]);

        $handler = new ListImportJobErrorsHandler(
            new ListImportJobErrorsUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('GET', "/admin/import-jobs/{$id}/errors"))
            ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => (string) $id]);

        $response = $handler->handle($request);
        $payload  = $this->decodeJson($response);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(2, $payload['total']);
        /** @var list<array<string, mixed>> $items */
        $items = $payload['items'];
        $this->assertSame(2, $items[0]['raw_row_number']);
        $this->assertSame('Bad date', $items[0]['message']);
        $this->assertSame('row2data', $items[0]['raw_snippet']);
    }

    public function test_list_errors_returns_empty_when_no_errors(): void
    {
        $id = $this->savedJob();

        $handler = new ListImportJobErrorsHandler(
            new ListImportJobErrorsUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('GET', "/admin/import-jobs/{$id}/errors"))
            ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => (string) $id]);

        $response = $handler->handle($request);
        $payload  = $this->decodeJson($response);

        $this->assertSame(0, $payload['total']);
        $this->assertCount(0, $payload['items']);
    }

    // ── ExportImportJobJsonHandler ────────────────────────────────────────

    public function test_export_json_returns_transaction_list(): void
    {
        $id = $this->savedJob();
        $this->jobs->appendTransactions($id, [
            new NormalizedTransaction(
                rawRowNumber: 1,
                transactionDate: '2026-05-01',
                valueDate: '2026-05-01',
                amountCents: 10000,
                description: '入金',
                counterparty: null,
                balanceCents: null,
                lineHash: 'sha256:abc',
            ),
        ]);

        $handler = new ExportImportJobJsonHandler(
            new ExportImportJobUseCase($this->jobs),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('GET', "/admin/import-jobs/{$id}/export.json"))
            ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => (string) $id]);

        $response = $handler->handle($request);

        $this->assertSame(200, $response->getStatusCode());
        /** @var list<array<string, mixed>> $rows */
        $rows = json_decode((string) $response->getBody(), true, 512, JSON_THROW_ON_ERROR);
        $this->assertCount(1, $rows);
        $this->assertSame('2026-05-01', $rows[0]['transaction_date']);
        $this->assertSame(10000, $rows[0]['amount_cents']);
        $this->assertArrayHasKey('schema_version', $rows[0]);
        $this->assertArrayHasKey('line_hash', $rows[0]);
        $this->assertArrayHasKey('raw_row_number', $rows[0]);
    }

    // ── ExportImportJobCsvHandler ─────────────────────────────────────────

    public function test_export_csv_returns_text_csv(): void
    {
        $id = $this->savedJob();
        $this->jobs->appendTransactions($id, [
            new NormalizedTransaction(
                rawRowNumber: 1,
                transactionDate: '2026-05-01',
                valueDate: '2026-05-01',
                amountCents: -5000,
                description: '出金',
                counterparty: null,
                balanceCents: null,
                lineHash: 'sha256:def',
            ),
        ]);

        $handler = new ExportImportJobCsvHandler(
            new ExportImportJobUseCase($this->jobs),
            $this->psr17(),
            $this->psr17(),
        );

        $request = $this->withAuth($this->request('GET', "/admin/import-jobs/{$id}/export.csv"))
            ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => (string) $id]);

        $response = $handler->handle($request);

        $this->assertSame(200, $response->getStatusCode());
        $this->assertStringContainsString('text/csv', $response->getHeaderLine('Content-Type'));
        $this->assertStringContainsString('attachment', $response->getHeaderLine('Content-Disposition'));
        $body = (string) $response->getBody();
        $this->assertStringContainsString('2026-05-01', $body);
        $this->assertStringContainsString('-5000', $body);
    }

    public function test_export_csv_returns_400_without_org(): void
    {
        $this->expectException(OrganizationNotResolvedException::class);

        $handler = new ExportImportJobCsvHandler(
            new ExportImportJobUseCase($this->jobs),
            $this->psr17(),
            $this->psr17(),
        );

        $response = $handler->handle(
            $this->request('GET', '/admin/import-jobs/1/export.csv')
                ->withAttribute(Router::PARAMETERS_ATTRIBUTE, ['id' => '1']),
        );

    }

    // ── CreateImportJobHandler ────────────────────────────────────────────

    public function test_create_returns_400_without_org(): void
    {
        $this->expectException(OrganizationNotResolvedException::class);

        $handler = new CreateImportJobHandler(
            $this->createImportJobUseCase(),
            $this->jsonFactory(),
        );

        $response = $handler->handle($this->request('POST', '/admin/import-jobs'));

    }

    public function test_create_throws_validation_when_file_missing(): void
    {
        $this->expectException(ValidationException::class);

        $handler = new CreateImportJobHandler(
            $this->createImportJobUseCase(),
            $this->jsonFactory(),
        );

        $request = $this->withAuth($this->request('POST', '/admin/import-jobs'))
            ->withParsedBody(['preset_id' => '1']);

        $handler->handle($request);
    }

    public function test_create_throws_validation_when_preset_id_missing(): void
    {
        $this->expectException(ValidationException::class);

        $handler = new CreateImportJobHandler(
            $this->createImportJobUseCase(),
            $this->jsonFactory(),
        );

        $psr17  = $this->psr17();
        $stream = $psr17->createStream("日付,入金額,出金額,摘要\n2026/05/01,1000,,入金\n");
        $upload = new UploadedFile($stream, (int) $stream->getSize(), UPLOAD_ERR_OK, 'test.csv', 'text/csv');

        $request = $this->withAuth($this->request('POST', '/admin/import-jobs'))
            ->withUploadedFiles(['file' => $upload])
            ->withParsedBody([]); // no preset_id

        $handler->handle($request);
    }

    public function test_create_rejects_file_above_the_organization_limit(): void
    {
        // The limit is per-organization (organization_settings.max_file_size_bytes),
        // enforced in the use case. Seed a tiny limit for org 7 and exceed it. The
        // ImportFileTooLargeException → 413 mapping is covered by its handler test.
        $this->settings->upsert(new OrganizationSettings(organizationId: 1, maxFileSizeBytes: 4));

        $handler = new CreateImportJobHandler(
            $this->createImportJobUseCase(),
            $this->jsonFactory(),
        );

        $psr17  = $this->psr17();
        $stream = $psr17->createStream('123456789'); // 9 bytes > 4-byte limit
        $upload = new UploadedFile($stream, (int) $stream->getSize(), UPLOAD_ERR_OK, 'big.csv', 'text/csv');

        $request = $this->withAuth($this->request('POST', '/admin/import-jobs'))
            ->withUploadedFiles(['file' => $upload])
            ->withParsedBody(['preset_id' => '1']);

        $this->expectException(ImportFileTooLargeException::class);
        $handler->handle($request);
    }
}
