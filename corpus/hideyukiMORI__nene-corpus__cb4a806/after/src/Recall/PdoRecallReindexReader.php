<?php

declare(strict_types=1);

namespace NeneCorpus\Recall;

use LogicException;
use Nene2\Database\DatabaseQueryExecutorInterface;
use NeneCorpus\Chunk\Chunk;
use NeneCorpus\Source\SourceStatus;
use NeneCorpus\Tenancy\Context\RequestScopedOrgIdHolder;

/**
 * SQL for `recall:reindex`. Org-scoped through {@see RequestScopedOrgIdHolder}
 * like every other Pdo* class, so the reindex of one tenant can never read
 * another one's chunks.
 *
 * 🔴 The two methods filter differently on purpose (#394).
 * `listAliveSourceIds()` is the **clear** list — {@see RecallReindexer} sends a
 * `deleteBySource` for every id it returns before writing anything — so it stays
 * as wide as possible. `listAliveChunks()` is the **write** list and drops
 * sources that are not `ready`. Narrowing the clear list the same way would leave
 * a failed source's chunks sitting in Recall with nothing left to ever delete them.
 */
final readonly class PdoRecallReindexReader implements RecallReindexReaderInterface
{
    private const SELECT_COLUMNS = <<<'SQL'
        c.id, c.document_id, c.source_id, c.chunk_index, c.content, c.page_number, c.section_label,
        c.token_count, c.created_at, c.updated_at
        SQL;

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
        private RequestScopedOrgIdHolder $orgIdHolder,
    ) {
    }

    /** @return list<int> */
    public function listAliveSourceIds(): array
    {
        $rows = $this->query->fetchAll(
            'SELECT id FROM sources WHERE organization_id = ? AND is_deleted = 0 ORDER BY id ASC',
            [$this->orgId()],
        );

        return array_map(static fn (array $row): int => (int) $row['id'], $rows);
    }

    /** @return list<Chunk> */
    public function listAliveChunks(int $afterId, int $limit): array
    {
        $rows = $this->query->fetchAll(
            'SELECT ' . self::SELECT_COLUMNS . ' '
            . 'FROM chunks c '
            . 'INNER JOIN sources s ON s.id = c.source_id AND ' . SourceStatus::SEARCHABLE_SOURCE_SQL . ' '
            . 'INNER JOIN documents d ON d.id = c.document_id AND d.is_deleted = 0 '
            . 'WHERE c.organization_id = ? AND c.id > ? '
            . 'ORDER BY c.id ASC '
            . 'LIMIT ?',
            [$this->orgId(), $afterId, $limit],
        );

        return array_map(fn (array $row): Chunk => $this->mapRow($row), $rows);
    }

    private function orgId(): int
    {
        $id = $this->orgIdHolder->getId();

        if ($id === null) {
            throw new LogicException('Organization ID is not resolved. Set it before reindexing.');
        }

        return $id;
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
