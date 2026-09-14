<?php

declare(strict_types=1);

namespace NeneCorpus\Search;

use NeneCorpus\Chunk\Chunk;

final readonly class ChunkSearchResult
{
    public function __construct(
        public Chunk $chunk,
        public int $score,
    ) {
    }
}
