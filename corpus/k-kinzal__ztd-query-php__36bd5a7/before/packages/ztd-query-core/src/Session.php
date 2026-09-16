<?php

declare(strict_types=1);

namespace ZtdQuery;

use ZtdQuery\Config\ZtdConfig;
use ZtdQuery\Connection\ConnectionInterface;
use ZtdQuery\Connection\Exception\DatabaseException;
use ZtdQuery\Connection\ResultSet;
use ZtdQuery\Connection\StatementInterface;
use ZtdQuery\Exception\UnknownSchemaException;
use ZtdQuery\Exception\UnsupportedSqlException;
use ZtdQuery\Platform\CopySupport;
use ZtdQuery\Platform\CopyTarget;
use ZtdQuery\Platform\MissingResultColumnTypeResolver;
use ZtdQuery\Platform\ParameterBindingCompiler;
use ZtdQuery\Platform\ResultColumnTypeResolver;
use ZtdQuery\Rewrite\QueryKind;
use ZtdQuery\Rewrite\RewritePlan;
use ZtdQuery\Rewrite\SqlRewriter;
use ZtdQuery\Schema\TableDefinition;
use ZtdQuery\Schema\TableDefinitionRegistry;
use ZtdQuery\Shadow\Mutation\MutationImpact;
use ZtdQuery\Shadow\Mutation\ShadowMutation;
use ZtdQuery\Shadow\ReferentialIntegrityEnforcer;
use ZtdQuery\Shadow\ShadowApplication;
use ZtdQuery\Shadow\ShadowStore;
use ZtdQuery\Shadow\ShadowTransactions;
use ZtdQuery\Sql\TransactionStatement;
use ZtdQuery\Sql\TransactionTarget;

/**
 * Aggregates ZTD session state and core collaborators.
 *
 * @phpstan-import-type Row from StatementInterface
 */
final class Session
{
    /**
     * SQL rewrite pipeline implementation.
     */
    private SqlRewriter $rewriter;

    /**
     * Executes result-select SQL on the database.
     */
    private ResultSelectRunner $resultSelectRunner;

    /**
     * Database connection for query execution.
     */
    private ConnectionInterface $connection;

    /**
     * Whether ZTD mode is enabled for this session.
     */
    private bool $enabled = true;

    private ShadowTransactions $transactions;

    private TableDefinitionRegistry $registry;

    private ?CopySupport $copySupport;

    private ?ParameterBindingCompiler $parameterBindingCompiler;

    private ResultColumnTypeResolver $resultColumnTypeResolver;

    private ShadowApplication $shadowApplication;

    private RewriteRefusal $refusals;

    private ?string $lastInsertId = null;

    /**
     * @param SqlRewriter $rewriter Rewrite pipeline for SQL.
     * @param ShadowStore $shadowStore Target shadow store for mutation application.
     * @param ResultSelectRunner $resultSelectRunner Executes result-select queries.
     * @param ZtdConfig $config ZTD configuration for error handling.
     * @param ConnectionInterface $connection Database connection for query execution.
     */
    public function __construct(
        SqlRewriter $rewriter,
        ShadowStore $shadowStore,
        ResultSelectRunner $resultSelectRunner,
        ZtdConfig $config,
        ConnectionInterface $connection,
        ?ShadowTransactions $transactions = null,
        ?TableDefinitionRegistry $registry = null,
        ?CopySupport $copySupport = null,
        ?ParameterBindingCompiler $parameterBindingCompiler = null,
        ResultColumnTypeResolver $resultColumnTypeResolver = new MissingResultColumnTypeResolver(),
    ) {
        $this->rewriter = $rewriter;
        $this->resultSelectRunner = $resultSelectRunner;
        $this->refusals = new RewriteRefusal($config);
        $this->connection = $connection;
        $this->transactions = $transactions ?? new ShadowTransactions($shadowStore);
        $this->registry = $registry ?? new TableDefinitionRegistry();
        $referentialIntegrity = new ReferentialIntegrityEnforcer($this->registry);
        $this->shadowApplication = new ShadowApplication(
            $shadowStore,
            $referentialIntegrity,
            $this->registry,
            $rewriter,
        );
        $this->copySupport = $copySupport;
        $this->parameterBindingCompiler = $parameterBindingCompiler;
        $this->resultColumnTypeResolver = $resultColumnTypeResolver;
    }

    /**
     * Writes a mutation into the shadow, and remembers the identity it produced.
     *
     * @param ShadowMutation $mutation Mutation to write
     * @param ResultSet $resultSet What the rewritten statement read back
     * @param string $sql Statement being simulated, for the refusal
     *
     * @return MutationImpact What the statement came to
     *
     * @throws DatabaseException When the shadow refuses the statement
     */
    public function applyShadow(ShadowMutation $mutation, ResultSet $resultSet, string $sql): MutationImpact
    {
        $impact = $this->shadowApplication->apply($mutation, $resultSet, $sql);
        $this->lastInsertId = $this->shadowApplication->lastInsertIdOf($mutation, $impact) ?? $this->lastInsertId;

        return $impact;
    }

    /**
     * Whether the plan's SQL should be executed against the database.
     */
    public function shouldExecute(RewritePlan $plan): bool
    {
        return $plan->kind() !== QueryKind::SKIPPED;
    }

    /**
     * Whether the plan requires post-execution processing via processExecutedStatement().
     */
    public function needsPostProcessing(RewritePlan $plan): bool
    {
        return $plan->kind() === QueryKind::WRITE_SIMULATED
            || $plan->kind() === QueryKind::DDL_SIMULATED;
    }

    /**
     * Create an empty write-simulated result for skipped writes.
     */
    public function createEmptyWriteResult(): ExecuteResult
    {
        return GenericExecuteResult::fromBufferedRows([], QueryKind::WRITE_SIMULATED);
    }

    /**
     * Enable ZTD behavior for this session.
     */
    public function enable(): void
    {
        $this->enabled = true;
    }

    /**
     * Disable ZTD behavior for this session.
     */
    public function disable(): void
    {
        $this->enabled = false;
    }

    /**
     * Check whether ZTD mode is enabled.
     */
    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    /**
     * Provides the target used to apply transaction statements to shadow state.
     */
    public function transactions(): TransactionTarget
    {
        return $this->transactions;
    }

    /**
     * Starts a transaction over the shadow state.
     */
    public function beginTransaction(): void
    {
        $this->transactions->begin();
    }

    /**
     * Keeps the current shadow state and discards transactional snapshots.
     */
    public function commitTransaction(): void
    {
        $this->transactions->commit();
    }

    /**
     * Restores the shadow state captured when the transaction began.
     */
    public function rollBackTransaction(): void
    {
        $this->transactions->rollBack();
    }

    /**
     * Applies a parsed transaction statement to this session's shadow state.
     */
    public function applyTransactionStatement(TransactionStatement $statement): void
    {
        $statement->apply($this->transactions);
    }

    /**
     * Answers the transaction statement a statement is, if it is one.
     *
     * @param string $sql Statement as it was written
     *
     * @return TransactionStatement|null What it does to the transaction, or null when it is not one
     */
    public function transactionStatement(string $sql): ?TransactionStatement
    {
        return $this->rewriter->transactionStatement($sql);
    }

    /**
     * Answers the identity the last simulated insert would have been given.
     *
     * @return string|false The identity, or false when nothing has been inserted
     */
    public function lastInsertId(): string|false
    {
        return $this->lastInsertId ?? false;
    }

    /**
     * Answers what a table was described as, where something described it.
     *
     * @param string $tableName Table to answer for
     *
     * @return TableDefinition|null Its description, or null when nothing has described it
     */
    public function tableDefinition(string $tableName): ?TableDefinition
    {
        return $this->registry->get($tableName);
    }

    /**
     * Answers how this dialect writes COPY, where it writes it at all.
     *
     * @return CopySupport|null What the dialect supports, or null where it has no COPY
     */
    public function copySupport(): ?CopySupport
    {
        return $this->copySupport;
    }

    /**
     * Answers what a COPY statement is written against, where everything it needs is known.
     *
     * @param string $relation Relation as the statement named it
     * @param string|null $fields Column list as the statement wrote it, or null for every column
     *
     * @return CopyTarget|null The target, or null when the dialect has no COPY or the table is undescribed
     */
    public function copyTarget(string $relation, ?string $fields): ?CopyTarget
    {
        if ($this->copySupport === null) {
            return null;
        }
        $definition = $this->registry->get($this->copySupport->tableName($relation));
        if ($definition === null) {
            return null;
        }

        return $this->copySupport->target($relation, $fields, $definition);
    }

    /**
     * Answers how this dialect writes bound parameters, where it needs to be told.
     *
     * @return ParameterBindingCompiler|null The compiler, or null where the driver binds them itself
     */
    public function parameterBindingCompiler(): ?ParameterBindingCompiler
    {
        return $this->parameterBindingCompiler;
    }

    /**
     * Answers how this dialect reads the column types a driver reports.
     *
     * @return ResultColumnTypeResolver The resolver
     */
    public function resultColumnTypeResolver(): ResultColumnTypeResolver
    {
        return $this->resultColumnTypeResolver;
    }

    /**
     * Rewrite SQL using the configured rewriter.
     *
     * Catches exceptions from the rewriter and handles them based on config.
     * For ignore/notice modes, returns a passthrough plan (READ with original SQL).
     *
     * @throws DatabaseException When config is Exception mode and rewrite fails.
     */
    public function rewrite(string $sql): RewritePlan
    {
        try {
            return $this->rewriter->rewrite($sql);
        } catch (UnsupportedSqlException $e) {
            return $this->refusals->forUnsupported($e, $sql);
        } catch (UnknownSchemaException $e) {
            return $this->refusals->forUnknownSchema($e, $sql, $this->rewriter->emptyResultSelect());
        }
    }

    /**
     * @return list<string>
     */
    public function splitStatements(string $sql): array
    {
        return $this->rewriter->splitStatements($sql);
    }

    /**
     * Process an already-executed statement based on the rewrite plan.
     *
     * This method handles post-execution logic like shadow application for write queries.
     * Use this when you need to control statement preparation and execution externally.
     *
     * @param RewritePlan $plan The rewrite plan from rewrite().
     * @param StatementInterface $statement The already-executed statement.
     * @return ExecuteResult The execution result.
     *
     * @throws DatabaseException When the shadow refuses the statement
     */
    public function processExecutedStatement(RewritePlan $plan, StatementInterface $statement): ExecuteResult
    {
        if ($plan->kind() === QueryKind::READ) {
            return GenericExecuteResult::fromStatement($statement, QueryKind::READ);
        }

        $resultSet = $this->resultSelectRunner->readResultSet($statement, $this->resultColumnTypeResolver);
        $rows = $resultSet->rows;

        $mutation = $plan->requireMutation();
        $impact = $this->applyShadow($mutation, $resultSet, $plan->sql());
        $returningProjection = $plan->returningProjection();
        $resultRows = $returningProjection !== null
            ? $returningProjection->project($impact->returningRows())
            : $rows;

        return GenericExecuteResult::fromBufferedRows(
            $resultRows,
            QueryKind::WRITE_SIMULATED,
            $impact->affectedRowCount($plan->affectedRowsMode()),
            $returningProjection !== null,
        );
    }

    /**
     * Run result-select query and apply shadow mutation.
     *
     * This method executes a result-select query using the provided executor,
     * then applies the mutation from the rewrite plan to the shadow store.
     *
     * @param RewritePlan $plan The rewrite plan containing the SQL and mutation.
     * @param callable(string): (StatementInterface|false) $executor Function to execute SQL.
     * @return list<Row> The affected rows.
     * @throws UnsupportedSqlException When the plan carries no mutation to write.
     *
     * @throws DatabaseException When the shadow refuses the statement
     */
    public function runResultSelectAndApplyShadow(RewritePlan $plan, callable $executor): array
    {
        $mutation = $plan->requireMutation();

        $resultSet = $this->resultSelectRunner->runResultSet(
            $plan->sql(),
            $executor,
            $this->resultColumnTypeResolver,
        );
        $this->applyShadow($mutation, $resultSet, $plan->sql());

        return $resultSet->rows;
    }

    /**
     * Execute an exec-style statement with ZTD rewriting and shadow application.
     *
     * @param string $sql The original SQL statement.
     * @return int|false The number of affected rows, or false on failure.
     * @throws DatabaseException When config is Exception mode and rewrite fails.
     */
    public function execStatement(string $sql): int|false
    {
        $plan = $this->rewrite($sql);

        if ($plan->kind() === QueryKind::SKIPPED) {
            return 0;
        }

        if ($plan->kind() === QueryKind::READ) {
            $stmt = $this->connection->query($plan->sql());
            if ($stmt === false) {
                return false;
            }
            return $stmt->rowCount();
        }

        $mutation = $plan->requireMutation();

        $resultSet = $this->resultSelectRunner->runResultSet(
            $plan->sql(),
            fn (string $s) => $this->connection->query($s),
            $this->resultColumnTypeResolver,
        );
        $impact = $this->applyShadow($mutation, $resultSet, $sql);

        return $impact->affectedRowCount($plan->affectedRowsMode());
    }
}
