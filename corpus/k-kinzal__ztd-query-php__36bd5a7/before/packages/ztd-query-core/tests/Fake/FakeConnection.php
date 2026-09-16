<?php

declare(strict_types=1);

namespace Tests\Fake;

use ZtdQuery\Connection\ConnectionInterface;
use ZtdQuery\Connection\StatementInterface;
use ZtdQuery\Schema\RowSet;
use ZtdQuery\Schema\TableDefinition;

/**
 * Fake ConnectionInterface that returns pre-configured FakeStatements.
 *
 * Queries are recorded for inspection. Results can be pre-loaded per SQL string
 * or a default result set can be provided. Specific queries can be configured to
 * fail by returning false, enabling tests for error-handling branches.
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class FakeConnection implements ConnectionInterface
{
    /**
     * Recorded queries.
     *
     * @var array<int, string>
     */
    public array $queries = [];

    /**
     * Pre-configured results keyed by SQL.
     *
     * @var array<string, RowSet>
     */
    private array $results;

    /**
     * Default rows returned when no specific result is configured.
     *
     */
    private RowSet $defaultRows;

    /**
     * SQL patterns that should return false (simulating query failure).
     *
     * @var array<int, string>
     */
    private array $failPatterns = [];

    /**
     * @param array<string, list<Row>> $results SQL => rows mapping.
     * @param list<Row> $defaultRows Default rows for unconfigured queries.
     */
    public function __construct(array $results = [], array $defaultRows = [])
    {
        $this->results = [];
        foreach ($results as $sql => $rows) {
            $this->addResult($sql, $rows);
        }
        $this->defaultRows = new RowSet($defaultRows);
    }

    /**
     * Query.
     *
     * @param string $sql
     * @return StatementInterface|false
     */
    public function query(string $sql): StatementInterface|false
    {
        $this->queries[] = $sql;

        foreach ($this->failPatterns as $pattern) {
            if ($sql === $pattern) {
                return false;
            }
        }

        $rows = $this->results[$sql] ?? $this->defaultRows;

        return new FakeStatement(array_values($rows->rows));
    }

    /**
     * Pre-load a result for a specific SQL query.
     *
     * @param list<Row> $rows
     */
    public function addResult(string $sql, array $rows): void
    {
        $this->results[$sql] = new RowSet($rows);
    }

    /**
     * Configure a query to return false (simulate failure).
     */
    public function failOnQuery(string $sql): void
    {
        $this->failPatterns[] = $sql;
    }
}
