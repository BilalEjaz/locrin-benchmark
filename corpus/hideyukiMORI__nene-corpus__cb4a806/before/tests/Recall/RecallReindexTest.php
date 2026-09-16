<?php

declare(strict_types=1);

namespace NeneCorpus\Tests\Recall;

use Nene2\Config\DatabaseConfig;
use Nene2\Database\PdoConnectionFactory;
use Nene2\Database\PdoDatabaseQueryExecutor;
use NeneCorpus\Chunk\Chunk;
use NeneCorpus\Chunk\PdoChunkRepository;
use NeneCorpus\Document\Document;
use NeneCorpus\Document\PdoDocumentRepository;
use NeneCorpus\Organization\Organization;
use NeneCorpus\Organization\OrganizationRepositoryInterface;
use NeneCorpus\Recall\PdoRecallReindexReader;
use NeneCorpus\Recall\RecallConfig;
use NeneCorpus\Recall\RecallReindexCommand;
use NeneCorpus\Recall\RecallReindexer;
use NeneCorpus\Source\PdoSourceRepository;
use NeneCorpus\Source\Source;
use NeneCorpus\Source\SourceStatus;
use NeneCorpus\Source\SourceType;
use NeneCorpus\Tenancy\Context\RequestScopedOrgIdHolder;
use NeneCorpus\Tests\Support\CorpusSchemaSetup;
use NeneCorpus\Tests\Support\FakeRecallClient;
use NeneCorpus\Tests\Support\FixedClock;
use PHPUnit\Framework\TestCase;

final class RecallReindexTest extends TestCase
{
    private PdoDatabaseQueryExecutor $executor;

    private RequestScopedOrgIdHolder $orgIdHolder;

    private FakeRecallClient $recall;

    private RecallReindexer $reindexer;

    protected function setUp(): void
    {
        $this->executor = new PdoDatabaseQueryExecutor(new PdoConnectionFactory(new DatabaseConfig(
            null,
            'test',
            'sqlite',
            'localhost',
            1,
            ':memory:',
            'nene_corpus',
            '',
            'utf8',
        )));

        CorpusSchemaSetup::create($this->executor);

        $this->orgIdHolder = new RequestScopedOrgIdHolder();
        $this->recall = new FakeRecallClient();
        $this->reindexer = new RecallReindexer(
            $this->recall,
            new PdoRecallReindexReader($this->executor, $this->orgIdHolder),
            $this->orgIdHolder,
        );
    }

    private function seedSource(int $orgId, string $name, bool $deleted = false): int
    {
        $holder = new RequestScopedOrgIdHolder();
        $holder->setId($orgId);

        $sources = new PdoSourceRepository($this->executor, $holder, new FixedClock());
        $sourceId = $sources->save(new Source(
            name: $name,
            sourceType: SourceType::Text,
            status: SourceStatus::Ready,
            storagePath: 'storage/uploads/' . $name . '.txt',
        ));

        if ($deleted) {
            $sources->softDelete($sourceId, '2026-09-02 12:00:00');
        }

        return $sourceId;
    }

    private function seedChunk(int $orgId, int $sourceId, string $content): int
    {
        $holder = new RequestScopedOrgIdHolder();
        $holder->setId($orgId);

        $documents = new PdoDocumentRepository($this->executor, $holder, new FixedClock());
        $documentId = $documents->save(new Document(
            sourceId: $sourceId,
            title: $content,
            position: 0,
        ));

        return (new PdoChunkRepository($this->executor, $holder, new FixedClock()))->save(new Chunk(
            documentId: $documentId,
            sourceId: $sourceId,
            content: $content,
        ));
    }

    public function test_reindex_clears_each_live_source_before_writing(): void
    {
        $sourceId = $this->seedSource(1, 'manual');
        $chunkId = $this->seedChunk(1, $sourceId, '安全手順');

        $report = $this->reindexer->reindex(1);

        // Clearing first is the only way to drop ids Corpus no longer has:
        // Recall exposes no "list every external_id you hold".
        self::assertSame([['org_id' => 1, 'source_id' => $sourceId]], $this->recall->sourceDeletes);
        self::assertSame(1, $report->clearedSources);
        self::assertSame(1, $report->indexedChunks);
        self::assertSame($chunkId, $this->recall->puts[0]['chunks'][0]->externalId);
    }

    public function test_reindex_skips_soft_deleted_sources(): void
    {
        $live = $this->seedSource(1, 'manual');
        $this->seedChunk(1, $live, '生きている');

        $archived = $this->seedSource(1, 'archived', deleted: true);
        $this->seedChunk(1, $archived, '消したはずの内容');

        $report = $this->reindexer->reindex(1);

        self::assertSame(1, $report->clearedSources);
        self::assertSame(1, $report->indexedChunks);
        self::assertSame('生きている', $this->recall->puts[0]['chunks'][0]->content);
    }

    public function test_reindex_never_reads_another_org(): void
    {
        $mine = $this->seedSource(1, 'mine');
        $this->seedChunk(1, $mine, '自組織の内容');

        $theirs = $this->seedSource(2, 'theirs');
        $this->seedChunk(2, $theirs, '他組織の内容');

        $report = $this->reindexer->reindex(1);

        self::assertSame(1, $report->indexedChunks);
        self::assertSame('自組織の内容', $this->recall->puts[0]['chunks'][0]->content);
        self::assertSame([['org_id' => 1, 'source_id' => $mine]], $this->recall->sourceDeletes);
    }

    public function test_reindex_reports_nothing_for_an_empty_org(): void
    {
        $report = $this->reindexer->reindex(9);

        self::assertSame(9, $report->organizationId);
        self::assertSame(0, $report->clearedSources);
        self::assertSame(0, $report->indexedChunks);
        self::assertSame([], $this->recall->puts);
    }

    public function test_command_reindexes_only_the_requested_org(): void
    {
        $mine = $this->seedSource(1, 'mine');
        $this->seedChunk(1, $mine, '自組織の内容');
        $this->seedChunk(2, $this->seedSource(2, 'theirs'), '他組織の内容');

        $lines = [];
        $exitCode = $this->command()->run(['--org=1'], static function (string $line) use (&$lines): void {
            $lines[] = $line;
        });

        self::assertSame(0, $exitCode);
        self::assertSame([1], array_column($this->recall->puts, 'org_id'));
        self::assertNotSame([], $lines);
    }

    public function test_command_rejects_a_non_numeric_org(): void
    {
        $lines = [];
        $exitCode = $this->command()->run(['--org=all'], static function (string $line) use (&$lines): void {
            $lines[] = $line;
        });

        self::assertSame(1, $exitCode);
        self::assertSame([], $this->recall->puts);
        self::assertStringContainsString('--org must be a positive integer.', $lines[0]);
    }

    public function test_command_refuses_to_run_when_recall_is_not_configured(): void
    {
        $lines = [];
        $exitCode = $this->command(configured: false)->run([], static function (string $line) use (&$lines): void {
            $lines[] = $line;
        });

        self::assertSame(1, $exitCode);
        self::assertSame([], $this->recall->sourceDeletes);
        self::assertStringContainsString('NENE_RECALL_BASE_URL is not set', $lines[0]);
    }

    public function test_command_stops_at_the_first_failure(): void
    {
        $this->seedChunk(1, $this->seedSource(1, 'manual'), '安全手順');
        $this->recall->willFail('NeNe Recall deleteBySource returned HTTP 503.');

        $lines = [];
        $exitCode = $this->command()->run([], static function (string $line) use (&$lines): void {
            $lines[] = $line;
        });

        self::assertSame(1, $exitCode);
        self::assertStringContainsString('Reindex aborted', $lines[count($lines) - 1]);
    }

    private function command(bool $configured = true): RecallReindexCommand
    {
        $organizations = $this->createStub(OrganizationRepositoryInterface::class);
        $organizations->method('listAll')->willReturn([
            new Organization(name: 'One', slug: 'one', plan: 'free', isActive: true, id: 1),
        ]);

        return new RecallReindexCommand(
            new RecallConfig(baseUrl: $configured ? 'http://127.0.0.1:8080' : null),
            $this->reindexer,
            $organizations,
        );
    }
}
