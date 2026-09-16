<?php

declare(strict_types=1);

namespace ZtdQuery\Shadow;

use ZtdQuery\Exception\ForeignKeyViolationException;
use ZtdQuery\Schema\TableDefinition;
use ZtdQuery\Schema\TableDefinitionRegistry;
use ZtdQuery\Shadow\Mutation\DataMutation;
use ZtdQuery\Shadow\Mutation\ShadowMutation;

/**
 * Carries what a statement did outward through the constraints that declare it.
 *
 * A write to a parent table does not stop at that table: a key declared
 * ON DELETE CASCADE takes the children with it, and those children may
 * themselves be parents. What happened is therefore followed outward until
 * nothing more follows, and only then is the result checked for the references
 * it has left dangling.
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class ReferentialIntegrityEnforcer
{
    /**
     * @param TableDefinitionRegistry $registry Answers what a table declares
     */
    public function __construct(private readonly TableDefinitionRegistry $registry)
    {
    }

    /**
     * Applies every consequence of a statement, and refuses one it cannot.
     *
     * @param ShadowStore $before Shadow as it was
     * @param ShadowStore $after Shadow as it became, written back in place
     * @param ShadowMutation $mutation Statement that was simulated
     * @param list<Row> $resultRows Rows the rewritten statement read back
     * @param string $sql Statement being simulated, for the refusal
     *
     * @throws ForeignKeyViolationException When a constraint forbids the statement or is left broken
     */
    public function synchronize(
        ShadowStore $before,
        ShadowStore $after,
        ShadowMutation $mutation,
        array $resultRows,
        string $sql,
    ): void {
        if (!$mutation instanceof DataMutation) {
            return;
        }

        $ends = new ForeignKeyEnds($this->registry);
        $cascade = new ForeignKeyCascade($ends);

        $pending = (new TableTransitions($this->registry))->of($before, $after, $mutation, $resultRows);
        while ($pending !== []) {
            $parent = array_shift($pending);
            foreach ($this->registry->getAll() as $childTable => $childDefinition) {
                foreach ($childDefinition->foreignKeys as $constraintName => $foreignKey) {
                    if (strcasecmp($foreignKey->referencedTable, $parent->table) !== 0) {
                        continue;
                    }
                    $child = $cascade->of($after, $childTable, $constraintName, $foreignKey, $parent, $sql);
                    if ($child !== null) {
                        $pending[] = $child;
                    }
                }
            }
        }

        (new ForeignKeyIntegrity($this->registry, $ends))->assertHolds($after, $sql);
    }
}
