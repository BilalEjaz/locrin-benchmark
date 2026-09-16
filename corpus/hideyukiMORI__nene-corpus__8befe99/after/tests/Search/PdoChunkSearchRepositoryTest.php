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
use NeneCorpus\Search\PdoChunkSearchRepository;
use NeneCorpus\Source\PdoSourceRepository;
use NeneCorpus\Source\Source;
use NeneCorpus\Source\SourceStatus;
use NeneCorpus\Source\SourceType;
use NeneCorpus\Tenancy\Context\RequestScopedOrgIdHolder;
use NeneCorpus\Tests\Support\CorpusSchemaSetup;
use NeneCorpus\Tests\Support\FixedClock;
use PHPUnit\Framework\TestCase;

final class PdoChunkSearchRepositoryTest extends TestCase
{
    private PdoDatabaseQueryExecutor $executor;

    private RequestScopedOrgIdHolder $orgIdHolder;

    private PdoChunkRepository $chunks;

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

        $sourceRepository = new PdoSourceRepository($this->executor, $this->orgIdHolder, new FixedClock());
        $this->sourceId = $sourceRepository->save(new Source(
            name: 'Manual',
            sourceType: SourceType::Pdf,
            status: SourceStatus::Ready,
            storagePath: 'storage/uploads/manual.pdf',
        ));

        $documentRepository = new PdoDocumentRepository($this->executor, $this->orgIdHolder, new FixedClock());
        $this->documentId = $documentRepository->save(new Document(
            sourceId: $this->sourceId,
            title: 'Safety guide',
            position: 0,
        ));

        $this->chunks = new PdoChunkRepository($this->executor, $this->orgIdHolder, new FixedClock());
    }

    public function test_search_returns_chunks_matching_single_term(): void
    {
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Equipment safety instructions for operators.',
            chunkIndex: 0,
        ));
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Unrelated maintenance schedule.',
            chunkIndex: 1,
        ));

        $results = (new PdoChunkSearchRepository($this->executor, $this->orgIdHolder))->search('safety', 10);

        self::assertCount(1, $results);
        self::assertSame('Equipment safety instructions for operators.', $results[0]->chunk->content);
        self::assertSame(1.0, $results[0]->score);
    }

    public function test_search_ranks_chunks_by_matching_term_count(): void
    {
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Safety overview for operators.',
            chunkIndex: 0,
        ));
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Equipment safety instructions for operators.',
            chunkIndex: 1,
        ));

        $results = (new PdoChunkSearchRepository($this->executor, $this->orgIdHolder))->search('equipment safety', 10);

        self::assertCount(2, $results);
        self::assertSame('Equipment safety instructions for operators.', $results[0]->chunk->content);
        self::assertSame(2.0, $results[0]->score);
        self::assertSame('Safety overview for operators.', $results[1]->chunk->content);
        self::assertSame(1.0, $results[1]->score);
    }

    public function test_search_excludes_soft_deleted_source(): void
    {
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Safety instructions for archived source.',
            chunkIndex: 0,
        ));

        (new PdoSourceRepository($this->executor, $this->orgIdHolder, new FixedClock()))->softDelete($this->sourceId, '2026-05-25 12:00:00');

        $results = (new PdoChunkSearchRepository($this->executor, $this->orgIdHolder))->search('safety', 10);

        self::assertSame([], $results);
    }

    public function test_search_excludes_soft_deleted_document(): void
    {
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Safety instructions for archived document.',
            chunkIndex: 0,
        ));

        (new PdoDocumentRepository($this->executor, $this->orgIdHolder, new FixedClock()))->softDelete($this->documentId, '2026-05-25 12:00:00');

        $results = (new PdoChunkSearchRepository($this->executor, $this->orgIdHolder))->search('safety', 10);

        self::assertSame([], $results);
    }

    public function test_search_org_isolation_excludes_other_org_chunks(): void
    {
        $org2Holder = new RequestScopedOrgIdHolder();
        $org2Holder->setId(2);

        // Org 1 chunk
        $this->chunks->save(new Chunk(
            documentId: $this->documentId,
            sourceId: $this->sourceId,
            content: 'Safety manual for org one operators.',
            chunkIndex: 0,
        ));

        // Search from org 2 perspective — should return nothing
        $results = (new PdoChunkSearchRepository($this->executor, $org2Holder))->search('safety', 10);

        self::assertSame([], $results);

        // Search from org 1 perspective — should return the chunk
        $results = (new PdoChunkSearchRepository($this->executor, $this->orgIdHolder))->search('safety', 10);

        self::assertCount(1, $results);
    }
}
