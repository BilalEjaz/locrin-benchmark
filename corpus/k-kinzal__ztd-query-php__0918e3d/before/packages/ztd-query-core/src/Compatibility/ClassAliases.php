<?php

declare(strict_types=1);

/**
 * Former public names of classes moved into responsibility namespaces.
 *
 * Registered while Composer bootstraps so that parameter and return types
 * declared with a former name accept the relocated class.
 *
 * @var array<string, class-string>
 */
$classAliases = [
    'ZtdQuery\\Shadow\\Mutation\\MultiTableMutationRow' => ZtdQuery\Shadow\Mutation\Row\MultiTableMutationRow::class,
    'ZtdQuery\\Shadow\\Mutation\\UpdateMutation' => ZtdQuery\Shadow\Mutation\Row\UpdateMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\InsertMutation' => ZtdQuery\Shadow\Mutation\Row\InsertMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\MultiTableMutationTarget' => ZtdQuery\Shadow\Mutation\Row\MultiTableMutationTarget::class,
    'ZtdQuery\\Shadow\\Mutation\\DeleteMutation' => ZtdQuery\Shadow\Mutation\Row\DeleteMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\MultiUpdateMutation' => ZtdQuery\Shadow\Mutation\Row\MultiUpdateMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\ReplaceMutation' => ZtdQuery\Shadow\Mutation\Row\ReplaceMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\ResultSetMutation' => ZtdQuery\Shadow\Mutation\Row\ResultSetMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\MultiDeleteMutation' => ZtdQuery\Shadow\Mutation\Row\MultiDeleteMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\CreateTableLikeMutation' => ZtdQuery\Shadow\Mutation\Table\CreateTableLikeMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\CreateTableAsSelectMutation' => ZtdQuery\Shadow\Mutation\Table\CreateTableAsSelectMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\TruncateMutation' => ZtdQuery\Shadow\Mutation\Table\TruncateMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\CreateTableMutation' => ZtdQuery\Shadow\Mutation\Table\CreateTableMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\MultiTruncateMutation' => ZtdQuery\Shadow\Mutation\Table\MultiTruncateMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\SynchronizeMutation' => ZtdQuery\Shadow\Mutation\Table\SynchronizeMutation::class,
    'ZtdQuery\\Shadow\\Mutation\\DropTableMutation' => ZtdQuery\Shadow\Mutation\Table\DropTableMutation::class,
    'ZtdQuery\\Shadow\\ShadowTransactionManager' => ZtdQuery\Shadow\ShadowTransactions::class,
    'ZtdQuery\\Schema\\ReferentialAction' => ZtdQuery\Schema\Key\ReferentialAction::class,
    'ZtdQuery\\Schema\\PartialUniqueIndex' => ZtdQuery\Schema\Key\PartialUniqueIndex::class,
    'ZtdQuery\\Schema\\IdentityGenerationStrategy' => ZtdQuery\Schema\Key\IdentityGenerationStrategy::class,
    'ZtdQuery\\Schema\\CandidateKeySet' => ZtdQuery\Schema\Key\CandidateKeySet::class,
    'ZtdQuery\\Schema\\ForeignKeyDefinition' => ZtdQuery\Schema\Key\ForeignKeyDefinition::class,
    'ZtdQuery\\Schema\\CandidateKeyConflict' => ZtdQuery\Schema\Key\CandidateKeyConflict::class,
    'ZtdQuery\\Schema\\TablePartitionKey' => ZtdQuery\Schema\Partition\TablePartitionKey::class,
    'ZtdQuery\\Schema\\TablePartitionStrategy' => ZtdQuery\Schema\Partition\TablePartitionStrategy::class,
    'ZtdQuery\\Schema\\TablePartitionRelation' => ZtdQuery\Schema\Partition\TablePartitionRelation::class,
    'ZtdQuery\\Schema\\TablePartitioning' => ZtdQuery\Schema\Partition\TablePartitioning::class,
    'ZtdQuery\\Schema\\ColumnType' => ZtdQuery\Schema\ColumnDeclaration::class,
];

foreach ($classAliases as $formerName => $currentClass) {
    if (!class_exists($formerName, false) && !enum_exists($formerName, false)) {
        class_alias($currentClass, $formerName);
    }
}
