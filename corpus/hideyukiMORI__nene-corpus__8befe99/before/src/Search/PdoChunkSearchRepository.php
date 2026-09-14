<?php

declare(strict_types=1);

namespace NeneCorpus\Search;

use LogicException;
use Nene2\Database\DatabaseQueryExecutorInterface;
use NeneCorpus\Chunk\Chunk;
use NeneCorpus\Tenancy\Context\RequestScopedOrgIdHolder;

final readonly class PdoChunkSearchRepository implements ChunkSearchRepositoryInterface
{
    private const LIKE_ESCAPE_CHAR = '!';

    private const SELECT_COLUMNS = <<<'SQL'
        c.id, c.document_id, c.source_id, c.chunk_index, c.content, c.page_number, c.section_label,
        c.token_count, c.created_at, c.updated_at
        SQL;

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
        private RequestScopedOrgIdHolder $orgIdHolder,
    ) {
    }

    private function orgId(): int
    {
        $id = $this->orgIdHolder->getId();

        if ($id === null) {
            throw new LogicException('Organization ID is not resolved. Check OrgResolverMiddleware setup.');
        }

        return $id;
    }

    public function search(string $query, int $limit): array
    {
        $terms = $this->tokenize($query);

        if ($terms === []) {
            return [];
        }

        $scoreParts = [];
        $whereParts = [];
        $params = [];

        $escape = self::LIKE_ESCAPE_CHAR;

        foreach ($terms as $term) {
            $pattern = '%' . $this->escapeLike($term) . '%';
            $scoreParts[] = "CASE WHEN c.content LIKE ? ESCAPE '{$escape}' THEN 1 ELSE 0 END";
            $whereParts[] = "c.content LIKE ? ESCAPE '{$escape}'";
            $params[] = $pattern;
        }

        foreach ($terms as $term) {
            $params[] = '%' . $this->escapeLike($term) . '%';
        }

        $params[] = $this->orgId();
        $params[] = $limit;

        $scoreExpression = implode(' + ', $scoreParts);
        $whereExpression = implode(' OR ', $whereParts);

        $rows = $this->query->fetchAll(
            'SELECT ' . self::SELECT_COLUMNS . ', (' . $scoreExpression . ') AS relevance_score '
            . 'FROM chunks c '
            . 'INNER JOIN sources s ON s.id = c.source_id AND s.is_deleted = 0 '
            . 'INNER JOIN documents d ON d.id = c.document_id AND d.is_deleted = 0 '
            . 'WHERE (' . $whereExpression . ') AND c.organization_id = ? '
            . 'ORDER BY relevance_score DESC, c.id ASC '
            . 'LIMIT ?',
            $params,
        );

        return array_map(
            fn (array $row): ChunkSearchResult => new ChunkSearchResult(
                chunk: $this->mapRow($row),
                score: (int) $row['relevance_score'],
            ),
            $rows,
        );
    }

    /**
     * @return list<string>
     */
    private function tokenize(string $query): array
    {
        $parts = preg_split('/\s+/u', trim($query), -1, PREG_SPLIT_NO_EMPTY);

        if ($parts === false) {
            return [];
        }

        return array_values(array_unique($parts));
    }

    private function escapeLike(string $value): string
    {
        $escape = self::LIKE_ESCAPE_CHAR;

        return str_replace(
            [$escape, '%', '_'],
            [$escape . $escape, $escape . '%', $escape . '_'],
            $value,
        );
    }

    /**
     * @param array<string, mixed> $row
     */
    private function mapRow(array $row): Chunk
    {
        return new Chunk(
            documentId: (int) $row['document_id'],
            sourceId: (int) $row['source_id'],
            content: (string) $row['content'],
            chunkIndex: (int) $row['chunk_index'],
            pageNumber: isset($row['page_number']) ? (int) $row['page_number'] : null,
            sectionLabel: isset($row['section_label']) ? (string) $row['section_label'] : null,
            tokenCount: isset($row['token_count']) ? (int) $row['token_count'] : null,
            id: (int) $row['id'],
            createdAt: (string) $row['created_at'],
            updatedAt: (string) $row['updated_at'],
        );
    }
}
