<?php

declare(strict_types=1);

namespace ZtdQuery\Connection;

use ZtdQuery\Platform\ResultColumnTypeResolver;
use ZtdQuery\Schema\TableDefinition;

/**
 * Minimal statement interface for ZTD layer.
 *
 * This interface defines the contract that all statement adapters must implement
 * to work with the ZTD session. It provides a driver-agnostic API for executing
 * prepared statements and fetching results.
 *
 * Rows retain the keys and opaque values supplied by the driver. The platform
 * owns value interpretation and SQL encoding.
 *
 * @phpstan-import-type Row from TableDefinition
 * @phpstan-import-type RowValue from TableDefinition
 */
interface StatementInterface
{
    /**
     * Execute the prepared statement.
     *
     * @param array<int|string, RowValue>|null $params Optional parameters to bind.
     * @return bool True on success, false on failure.
     */
    public function execute(?array $params = null): bool;

    /**
     * Fetch all rows as associative arrays.
     *
     * @return array<int, Row> Array of associative arrays.
     */
    public function fetchAll(): array;

    /**
     * Return result-set columns in projection order.
     *
     * Metadata must remain available when the result contains no rows.
     *
     * @return list<ResultColumn>
     */
    public function resultColumns(ResultColumnTypeResolver $typeResolver): array;

    /**
     * Return the number of affected rows.
     */
    public function rowCount(): int;
}
