<?php

declare(strict_types=1);

namespace ZtdQuery;

use ZtdQuery\Rewrite\QueryKind;
use ZtdQuery\Schema\TableDefinition;

/**
 * Result of a ZTD statement execution.
 *
 * This interface encapsulates the result of executing a statement through Session,
 * providing a unified API for fetching results whether from rewritten statements,
 * buffered rows (for simulated writes), or passthrough scenarios.
 *
 * @phpstan-import-type Row from TableDefinition
 */
interface ExecuteResult
{
    /**
     * Check if this is a passthrough result (original statement should be executed).
     */
    public function isPassthrough(): bool;

    /**
     * Check if the execution was successful.
     */
    public function isSuccess(): bool;

    /**
     * Get the query kind that was executed.
     */
    public function kind(): QueryKind;

    /**
     * Fetch the next row.
     *
     * @return Row|false
     */
    public function fetch(): array|false;

    /**
     * Fetch all remaining rows.
     *
     * @return list<Row>
     */
    public function fetchAll(): array;

    /**
     * Get the number of affected/returned rows.
     */
    public function rowCount(): int;

    /**
     * Whether this result contains a result set that can be fetched.
     */
    public function hasResultSet(): bool;
}
