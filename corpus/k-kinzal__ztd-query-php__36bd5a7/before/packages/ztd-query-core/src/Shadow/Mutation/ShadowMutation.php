<?php

declare(strict_types=1);

namespace ZtdQuery\Shadow\Mutation;

use ZtdQuery\Exception\SimulationException;
use ZtdQuery\Schema\TableDefinition;
use ZtdQuery\Shadow\ShadowStore;

/**
 * What a statement would do to the shadow.
 *
 * @phpstan-import-type Row from TableDefinition
 */
interface ShadowMutation
{
    /**
     * Writes into the shadow what the statement would have written.
     *
     * The rows are what the rewritten statement read back, which is what the
     * database would have written -- so applying is carrying that into the
     * shadow, not working out the effect a second time.
     *
     * @param ShadowStore $store Shadow to write into
     * @param list<Row> $rows Rows the rewritten statement read back
     *
     * @throws SimulationException When the shadow will not take what the statement would write
     */
    public function apply(ShadowStore $store, array $rows): void;

    /**
     * Target table name for the mutation.
     */
    public function tableName(): string;
}
