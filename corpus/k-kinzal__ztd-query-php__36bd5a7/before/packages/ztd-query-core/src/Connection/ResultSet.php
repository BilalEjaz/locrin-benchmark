<?php

declare(strict_types=1);

namespace ZtdQuery\Connection;

use ZtdQuery\Schema\TableDefinition;

/**
 * Buffered rows together with metadata that remains available for an empty result.
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class ResultSet
{
    /**
     * @param list<Row> $rows
     * @param list<ResultColumn> $columns
     */
    public function __construct(
        public readonly array $rows,
        public readonly array $columns,
    ) {
    }
}
