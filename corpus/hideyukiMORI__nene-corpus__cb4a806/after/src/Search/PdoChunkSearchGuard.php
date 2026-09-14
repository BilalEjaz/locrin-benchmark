<?php

declare(strict_types=1);

namespace NeneCorpus\Search;

use LogicException;
use Nene2\Database\DatabaseQueryExecutorInterface;
use NeneCorpus\Chunk\Chunk;
use NeneCorpus\Source\SourceStatus;
use NeneCorpus\Tenancy\Context\RequestScopedOrgIdHolder;

/**
 * Turns chunk ids coming back from an external search backend into chunks that
 * are actually still readable in this organization.
 *
 * Two things are checked here rather than trusted upstream (ADR 0007 Decision 2,
 * Recall ADR 0020 Decision 6):
 *
 * 1. **Tenant isolation.** `organization_id = ?` is applied on our side as well.
 *    A backend that returned another tenant's id — by bug, by a stale index, or
 *    because someone pointed two deployments at one Recall — must not be able to
 *    put that content into an answer.
 * 2. **Soft deletes.** sources and documents are soft-deleted while chunks are
 *    hard-deleted, and the delete is pushed to Recall separately. If that push is
 *    ever missed, deleted material would come back; the `is_deleted = 0` joins
 *    are the second line of defence, matching {@see PdoChunkSearchRepository}.
 * 3. **Ingestion state.** A source that is not `ready` can still own rows in
 *    `chunks` — a failed run leaves what it had already committed behind. Those
 *    rows are a half-written corpus, so `s.status` is checked too (#394).
 *    See {@see SourceStatus::SEARCHABLE}.
 *
 * All three faults are invisible in single-tenant, happy-path development, which
 * is exactly why the filter is not optional.
 */
final readonly class PdoChunkSearchGuard
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

    /**
     * @param list<int> $chunkIds
     *
     * @return array<int, Chunk> Surviving chunks keyed by id; caller restores the ranking
     */
    public function filterAlive(array $chunkIds): array
    {
        if ($chunkIds === []) {
            return [];
        }

        $placeholders = implode(', ', array_fill(0, count($chunkIds), '?'));
        $params = $chunkIds;
        $params[] = $this->orgId();

        $rows = $this->query->fetchAll(
            'SELECT ' . self::SELECT_COLUMNS . ' '
            . 'FROM chunks c '
            . 'INNER JOIN sources s ON s.id = c.source_id AND ' . SourceStatus::SEARCHABLE_SOURCE_SQL . ' '
            . 'INNER JOIN documents d ON d.id = c.document_id AND d.is_deleted = 0 '
            . 'WHERE c.id IN (' . $placeholders . ') AND c.organization_id = ?',
            $params,
        );

        $alive = [];

        foreach ($rows as $row) {
            $chunk = $this->mapRow($row);
            $alive[(int) $chunk->id] = $chunk;
        }

        return $alive;
    }

    private function orgId(): int
    {
        $id = $this->orgIdHolder->getId();

        if ($id === null) {
            throw new LogicException('Organization ID is not resolved. Check OrgResolverMiddleware setup.');
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
