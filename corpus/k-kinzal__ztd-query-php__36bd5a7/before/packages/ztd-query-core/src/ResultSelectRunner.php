<?php

declare(strict_types=1);

namespace ZtdQuery;

use ZtdQuery\Connection\ResultSet;
use ZtdQuery\Connection\StatementInterface;
use ZtdQuery\Platform\ResultColumnTypeResolver;
use ZtdQuery\Schema\TableDefinition;

/**
 * Executes result-select queries and returns rows.
 *
 * @phpstan-import-type Row from TableDefinition
 * @phpstan-import-type RowValue from TableDefinition
 */
final class ResultSelectRunner
{
    /**
     * Execute SQL using the provided executor and return result rows.
     *
     * @param callable(string): (StatementInterface|false) $executor
     * @return list<Row>
     */
    public function run(
        string $sql,
        callable $executor,
        ResultColumnTypeResolver $typeResolver,
    ): array {
        return $this->runResultSet($sql, $executor, $typeResolver)->rows;
    }

    /**
     * @param callable(string): (StatementInterface|false) $executor
     */
    public function runResultSet(
        string $sql,
        callable $executor,
        ResultColumnTypeResolver $typeResolver,
    ): ResultSet {
        $statement = $executor($sql);
        if ($statement === false) {
            return new ResultSet([], []);
        }

        return $this->readResultSet($statement, $typeResolver);
    }

    /**
     * Execute a prepared statement and return result rows.
     *
     * @param array<int|string, RowValue>|null $params
     * @return list<Row>
     */
    public function runStatement(
        StatementInterface $statement,
        ResultColumnTypeResolver $typeResolver,
        ?array $params = null,
    ): array {
        $statement->execute($params);

        return $this->readResultSet($statement, $typeResolver)->rows;
    }

    /**
     * Reads result set.
     *
     * @param StatementInterface $statement
     * @param ResultColumnTypeResolver $typeResolver
     * @return ResultSet
     */
    public function readResultSet(
        StatementInterface $statement,
        ResultColumnTypeResolver $typeResolver,
    ): ResultSet {
        $columns = $statement->resultColumns($typeResolver);
        $rows = $statement->fetchAll();

        return new ResultSet($rows, $columns);
    }
}
