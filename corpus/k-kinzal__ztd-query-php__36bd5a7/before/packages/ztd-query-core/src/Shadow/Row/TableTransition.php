<?php

declare(strict_types=1);

namespace ZtdQuery\Shadow\Row;

use ZtdQuery\Schema\TableDefinition;

/**
 * What happened to one table, as the rows themselves rather than as a count.
 *
 * A referential action is decided by the values in the rows that moved, so
 * what a statement did has to be carried around as those rows and not as the
 * number of them.
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class TableTransition
{
    /**
     * @param string $table Table this happened to
     * @param list<Row> $deleted Rows that are no longer there
     * @param list<RowChange> $updated Rows that are still there, changed
     */
    public function __construct(
        public readonly string $table,
        public readonly array $deleted,
        public readonly array $updated,
    ) {
    }

    /**
     * Reports whether nothing happened to the table.
     *
     * @return bool True when no row was deleted and none was changed
     */
    public function isEmpty(): bool
    {
        return $this->deleted === [] && $this->updated === [];
    }
}
