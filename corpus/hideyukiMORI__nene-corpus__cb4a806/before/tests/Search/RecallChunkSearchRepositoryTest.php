<?php

declare(strict_types=1);

namespace NeneCorpus\Tests\Search;

use Nene2\Config\DatabaseConfig;
use Nene2\Database\PdoConnectionFactory;
use Nene2\Database\PdoDatabaseQueryExecutor;
use NeneCorpus\Chunk\Chunk;
use NeneCorpus\Chunk\PdoChunkRepository;
use NeneCorpus\Document\Document;
use NeneCorpus\Document\PdoDocumentRepository;
use NeneCorpus\Recall\RecallSearchHit;
use NeneCorpus\Recall\RecallUnavailableException;
use NeneCorpus\Search\PdoChunkSearchGuard;
use NeneCorpus\Search\PdoChunkSearchRepository;
use NeneCorpus\Search\RecallChunkSearchRepository;
use NeneCorpus\Source\PdoSourceRepository;
use NeneCorpus\Source\Source;
use NeneCorpus\Source\SourceStatus;
use NeneCorpus\Source\SourceType;
use NeneCorpus\Tenancy\Context\RequestScopedOrgIdHolder;
use NeneCorpus\Tests\Support\CorpusSchemaSetup;
use NeneCorpus\Tests\Support\FakeRecallClient;
use NeneCorpus\Tests\Support\FixedClock;
use NeneCorpus\Tests\Support\RecordingLogger;
use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;

final class RecallChunkSearchRepositoryTest extends TestCase
{
    private PdoDatabaseQueryExecutor $executor;

    private RequestScopedOrgIdHolder $orgIdHolder;

    private FakeRecallClient $recall;

    private int $sourceId;

    private int $documentId;

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
        $this->orgIdHolder->setId(1);
        $this->recall = new FakeRecallClient();

        $sources = new PdoSourceRepository($this->executor, $this->orgIdHolder, new FixedClock());
        $this->sourceId = $sources->save(new Source(
            name: 'Manual',
            sourceType: SourceType::Pdf,
            status: SourceStatus::Ready,
            storagePath: 'storage/uploads/manual.pdf',
        ));

        $documents = new PdoDocumentRepository($this->executor, $this->orgIdHolder, new FixedClock());
        $this->documentId = $documents->save(new Document(
            sourceId: $this->sourceId,
            title: 'Safety guide',
            position: 0,
        ));
    }

    private function saveChunk(string $content, int $index = 0, ?RequestScopedOrgIdHolder $holder = null): int
    {
        $repository = new PdoChunkRepository($this->executor, $holder ?? $this->orgIdHolder, new FixedClock());

        return $repository->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: $content,
            chunkIndex: $index,
        ));
    }

    private function repository(bool $strict = false, ?RecordingLogger $logger = null): RecallChunkSearchRepository
    {
        return new RecallChunkSearchRepository(
            recall: $this->recall,
            guard: new PdoChunkSearchGuard($this->executor, $this->orgIdHolder),
            fallback: new PdoChunkSearchRepository($this->executor, $this->orgIdHolder),
            orgIdHolder: $this->orgIdHolder,
            logger: $logger ?? new NullLogger(),
            strict: $strict,
        );
    }

    public function test_search_keeps_recall_ranking_not_database_order(): void
    {
        $first = $this->saveChunk('Equipment safety instructions.', 0);
        $second = $this->saveChunk('Maintenance schedule.', 1);

        // Recall ranks the second-inserted chunk highest.
        $this->recall->willReturn([
            new RecallSearchHit(chunkId: 900, externalId: $second, score: 0.91),
            new RecallSearchHit(chunkId: 901, externalId: $first, score: 0.42),
        ]);

        $results = $this->repository()->search('安全', 10);

        self::assertCount(2, $results);
        self::assertSame($second, $results[0]->chunk->id);
        self::assertSame(0.91, $results[0]->score);
        self::assertSame($first, $results[1]->chunk->id);
        self::assertSame(0.42, $results[1]->score);

        // The chunk body comes from the database, not from the search backend.
        self::assertSame('Maintenance schedule.', $results[0]->chunk->content);
        self::assertNotNull($results[0]->chunk->createdAt);
    }

    public function test_search_passes_the_resolved_org_id_upstream(): void
    {
        $this->orgIdHolder->setId(42);
        $this->recall->willReturn([]);

        $this->repository()->search('安全', 5);

        self::assertSame([['org_id' => 42, 'query' => '安全', 'limit' => 5]], $this->recall->searches);
    }

    public function test_results_without_external_id_are_dropped(): void
    {
        $id = $this->saveChunk('Equipment safety instructions.');

        $this->recall->willReturn([
            new RecallSearchHit(chunkId: 900, externalId: null, score: 0.99),
            new RecallSearchHit(chunkId: 901, externalId: $id, score: 0.42),
        ]);

        $results = $this->repository()->search('安全', 10);

        self::assertCount(1, $results);
        self::assertSame($id, $results[0]->chunk->id);
    }

    public function test_soft_deleted_source_is_filtered_out(): void
    {
        $id = $this->saveChunk('Equipment safety instructions.');

        (new PdoSourceRepository($this->executor, $this->orgIdHolder, new FixedClock()))
            ->softDelete($this->sourceId, '2026-09-02 12:00:00');

        $this->recall->willReturn([new RecallSearchHit(chunkId: 900, externalId: $id, score: 0.9)]);

        self::assertSame([], $this->repository()->search('安全', 10));
    }

    public function test_soft_deleted_document_is_filtered_out(): void
    {
        $id = $this->saveChunk('Equipment safety instructions.');

        (new PdoDocumentRepository($this->executor, $this->orgIdHolder, new FixedClock()))
            ->softDelete($this->documentId, '2026-09-02 12:00:00');

        $this->recall->willReturn([new RecallSearchHit(chunkId: 900, externalId: $id, score: 0.9)]);

        self::assertSame([], $this->repository()->search('安全', 10));
    }

    public function test_chunk_of_another_org_is_dropped_even_when_recall_returns_it(): void
    {
        $otherOrg = new RequestScopedOrgIdHolder();
        $otherOrg->setId(2);

        $ownChunkId = $this->saveChunk('Org one safety manual.', 0);
        $foreignChunkId = $this->saveChunk('Org two salary table.', 1, $otherOrg);

        // A backend bug, a stale index, or two deployments sharing one Recall all
        // look like this. The guard is the reason it cannot become an answer.
        $this->recall->willReturn([
            new RecallSearchHit(chunkId: 900, externalId: $foreignChunkId, score: 0.99),
            new RecallSearchHit(chunkId: 901, externalId: $ownChunkId, score: 0.10),
        ]);

        $results = $this->repository()->search('安全', 10);

        self::assertCount(1, $results);
        self::assertSame($ownChunkId, $results[0]->chunk->id);
    }

    public function test_failure_falls_back_to_like_search_and_logs_a_warning(): void
    {
        $this->saveChunk('Equipment safety instructions.');
        $this->recall->willFail();

        $logger = new RecordingLogger();
        $results = $this->repository(strict: false, logger: $logger)->search('safety', 10);

        self::assertCount(1, $results);
        self::assertSame(1.0, $results[0]->score);
        self::assertTrue($logger->hasWarningContaining('falling back to LIKE search'));
    }

    public function test_failure_is_raised_when_strict_is_on(): void
    {
        $this->saveChunk('Equipment safety instructions.');
        $this->recall->willFail();

        $this->expectException(RecallUnavailableException::class);

        $this->repository(strict: true)->search('safety', 10);
    }

    public function test_empty_recall_result_does_not_touch_the_database(): void
    {
        $this->saveChunk('Equipment safety instructions.');
        $this->recall->willReturn([]);

        // An empty hybrid result means "nothing matched" — it must not silently
        // become a LIKE search, or the two backends would be indistinguishable.
        self::assertSame([], $this->repository()->search('safety', 10));
    }
}
