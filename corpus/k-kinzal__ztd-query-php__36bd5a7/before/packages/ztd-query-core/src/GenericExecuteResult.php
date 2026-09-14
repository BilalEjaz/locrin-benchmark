<?php

declare(strict_types=1);

namespace ZtdQuery;

use ZtdQuery\Connection\StatementInterface;
use ZtdQuery\Rewrite\QueryKind;
use ZtdQuery\Schema\RowSet;
use ZtdQuery\Schema\TableDefinition;

/**
 * Generic implementation of ExecuteResult.
 *
 * This implementation handles all result types:
 * - Passthrough: signals that original statement should be executed
 * - Rewritten SELECT: wraps a StatementInterface for fetching
 * - Simulated WRITE: buffers rows and provides iteration
 * - Failure: represents execution failure
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class GenericExecuteResult implements ExecuteResult
{
    private bool $passthrough;
    private bool $success;
    private QueryKind $kind;
    private ?StatementInterface $rewrittenStatement;

    /**
     * Buffered rows for simulated writes.
     *
     */
    private ?RowSet $bufferedRows;

    /**
     * Current index into buffered rows.
     */
    private int $bufferIndex = 0;

    /**
     * Row count override (for simulated writes).
     */
    private ?int $rowCountOverride;

    private bool $resultSet;

    /**
     * Binds a result to everything it will answer from.
     *
     * Every way of building one goes through a named constructor, because what a
     * result is depends on which of them was used.
     *
     * @param list<Row>|null $bufferedRows
     */
    public function __construct(
        bool $passthrough,
        bool $success,
        QueryKind $kind,
        ?StatementInterface $rewrittenStatement = null,
        ?array $bufferedRows = null,
        ?int $rowCountOverride = null,
        bool $resultSet = false,
    ) {
        $this->passthrough = $passthrough;
        $this->success = $success;
        $this->kind = $kind;
        $this->rewrittenStatement = $rewrittenStatement;
        $this->bufferedRows = $bufferedRows === null ? null : new RowSet($bufferedRows);
        $this->rowCountOverride = $rowCountOverride;
        $this->resultSet = $resultSet;
    }

    /**
     * Create a passthrough result (original statement should be executed).
     */
    public static function passthrough(QueryKind $kind = QueryKind::READ): self
    {
        return new self(
            passthrough: true,
            success: true,
            kind: $kind
        );
    }

    /**
     * Create a failure result.
     */
    public static function failure(QueryKind $kind): self
    {
        return new self(
            passthrough: false,
            success: false,
            kind: $kind
        );
    }

    /**
     * Create a result wrapping a rewritten statement (for SELECT queries).
     */
    public static function fromStatement(StatementInterface $statement, QueryKind $kind = QueryKind::READ): self
    {
        return new self(
            passthrough: false,
            success: true,
            kind: $kind,
            rewrittenStatement: $statement
        );
    }

    /**
     * Create a result with buffered rows (for simulated WRITE queries).
     *
     * @param list<Row> $rows
     */
    public static function fromBufferedRows(
        array $rows,
        QueryKind $kind = QueryKind::WRITE_SIMULATED,
        ?int $affectedRowCount = null,
        bool $hasResultSet = false,
    ): self {
        return new self(
            passthrough: false,
            success: true,
            kind: $kind,
            rewrittenStatement: null,
            bufferedRows: $rows,
            rowCountOverride: $affectedRowCount ?? count($rows),
            resultSet: $hasResultSet,
        );
    }

    /**
     * Create a result with both a statement and buffered rows.
     *
     * @param list<Row> $rows
     */
    public static function fromStatementAndRows(
        StatementInterface $statement,
        array $rows,
        QueryKind $kind = QueryKind::WRITE_SIMULATED
    ): self {
        return new self(
            passthrough: false,
            success: true,
            kind: $kind,
            rewrittenStatement: $statement,
            bufferedRows: $rows,
            rowCountOverride: count($rows)
        );
    }

    /**
     * {@inheritDoc}
     */
    public function isPassthrough(): bool
    {
        return $this->passthrough;
    }

    /**
     * {@inheritDoc}
     */
    public function isSuccess(): bool
    {
        return $this->success;
    }

    /**
     * {@inheritDoc}
     */
    public function kind(): QueryKind
    {
        return $this->kind;
    }

    /**
     * {@inheritDoc}
     */
    public function fetch(): array|false
    {
        if ($this->bufferedRows !== null) {
            if ($this->bufferIndex >= count($this->bufferedRows->rows)) {
                return false;
            }
            $row = $this->bufferedRows->rows[$this->bufferIndex];
            $this->bufferIndex++;

            return $row;
        }

        if ($this->rewrittenStatement !== null) {
            $rows = $this->rewrittenStatement->fetchAll();
            if ($rows === []) {
                return false;
            }
            $this->bufferedRows = new RowSet($rows);
            $this->bufferIndex = 1;

            return $rows[0];
        }

        return false;
    }

    /**
     * {@inheritDoc}
     */
    public function fetchAll(): array
    {
        if ($this->bufferedRows !== null) {
            $rows = array_slice($this->bufferedRows->rows, $this->bufferIndex);
            $this->bufferIndex = count($this->bufferedRows->rows);

            return $rows;
        }

        if ($this->rewrittenStatement !== null) {
            return $this->rewrittenStatement->fetchAll();
        }

        return [];
    }

    /**
     * {@inheritDoc}
     */
    public function rowCount(): int
    {
        if ($this->rowCountOverride !== null) {
            return $this->rowCountOverride;
        }

        if ($this->rewrittenStatement !== null) {
            return $this->rewrittenStatement->rowCount();
        }

        return 0;
    }

    /**
     * {@inheritDoc}
     */
    public function hasResultSet(): bool
    {
        return $this->kind === QueryKind::READ || $this->resultSet;
    }

    /**
     * Reset the buffer index for re-iteration.
     */
    public function resetBuffer(): void
    {
        $this->bufferIndex = 0;
    }
}
