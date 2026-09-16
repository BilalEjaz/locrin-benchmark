<?php

declare(strict_types=1);

namespace NeneCorpus\Tests\Search;

use NeneCorpus\Chunk\Chunk;
use NeneCorpus\Search\ChunkSearchRepositoryInterface;
use NeneCorpus\Search\ChunkSearchResult;
use NeneCorpus\Search\SearchChunksInput;
use NeneCorpus\Search\SearchChunksUseCase;
use PHPUnit\Framework\TestCase;

final class SearchChunksUseCaseTest extends TestCase
{
    public function test_execute_returns_empty_for_blank_query(): void
    {
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::never())->method('search');

        $results = (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: '   '));

        self::assertSame([], $results);
    }

    public function test_execute_clamps_limit_before_search(): void
    {
        $chunk = new Chunk(
            documentId: 1,
            sourceId: 1,
            content: 'Safety instructions.',
        );

        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::once())
            ->method('search')
            ->with('safety', 50)
            ->willReturn([new ChunkSearchResult(chunk: $chunk, score: 1.0)]);

        $results = (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: 'safety', limit: 999));

        self::assertCount(1, $results);
    }

    public function test_execute_returns_empty_for_empty_string_query(): void
    {
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::never())->method('search');

        $results = (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: ''));

        self::assertSame([], $results);
    }

    public function test_execute_clamps_limit_zero_to_one(): void
    {
        // limit = 0 → max(1, min(50, 0)) = 1
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::once())
            ->method('search')
            ->with(self::anything(), 1)
            ->willReturn([]);

        (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: 'hello', limit: 0));
    }

    public function test_execute_clamps_negative_limit_to_one(): void
    {
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::once())
            ->method('search')
            ->with(self::anything(), 1)
            ->willReturn([]);

        (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: 'hello', limit: -99));
    }

    public function test_execute_passes_limit_50_through_unchanged(): void
    {
        // limit = 50 = MAX → そのまま通る（境界値）
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::once())
            ->method('search')
            ->with(self::anything(), 50)
            ->willReturn([]);

        (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: 'hello', limit: 50));
    }

    public function test_execute_passes_limit_1_through_unchanged(): void
    {
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::once())
            ->method('search')
            ->with(self::anything(), 1)
            ->willReturn([]);

        (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: 'hello', limit: 1));
    }

    public function test_execute_trims_query_whitespace_before_passing_to_search(): void
    {
        $search = $this->createMock(ChunkSearchRepositoryInterface::class);
        $search->expects(self::once())
            ->method('search')
            ->with('hello world', self::anything())
            ->willReturn([]);

        (new SearchChunksUseCase($search))->execute(new SearchChunksInput(query: '  hello world  '));
    }
}
