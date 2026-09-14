<?php

declare(strict_types=1);

/**
 * Resolve former public names on demand, without loading implementations during Composer bootstrap.
 */
$classAliases = [
    'ztdquery\shadow\mutation\multitablemutationrow' => ZtdQuery\Shadow\Mutation\Row\MultiTableMutationRow::class,
    'ztdquery\shadow\mutation\updatemutation' => ZtdQuery\Shadow\Mutation\Row\UpdateMutation::class,
    'ztdquery\shadow\mutation\insertmutation' => ZtdQuery\Shadow\Mutation\Row\InsertMutation::class,
    'ztdquery\shadow\mutation\multitablemutationtarget' => ZtdQuery\Shadow\Mutation\Row\MultiTableMutationTarget::class,
    'ztdquery\shadow\mutation\deletemutation' => ZtdQuery\Shadow\Mutation\Row\DeleteMutation::class,
    'ztdquery\shadow\mutation\multiupdatemutation' => ZtdQuery\Shadow\Mutation\Row\MultiUpdateMutation::class,
    'ztdquery\shadow\mutation\replacemutation' => ZtdQuery\Shadow\Mutation\Row\ReplaceMutation::class,
    'ztdquery\shadow\mutation\resultsetmutation' => ZtdQuery\Shadow\Mutation\Row\ResultSetMutation::class,
    'ztdquery\shadow\mutation\multideletemutation' => ZtdQuery\Shadow\Mutation\Row\MultiDeleteMutation::class,
    'ztdquery\shadow\mutation\createtablelikemutation' => ZtdQuery\Shadow\Mutation\Table\CreateTableLikeMutation::class,
    'ztdquery\shadow\mutation\createtableasselectmutation' => ZtdQuery\Shadow\Mutation\Table\CreateTableAsSelectMutation::class,
    'ztdquery\shadow\mutation\truncatemutation' => ZtdQuery\Shadow\Mutation\Table\TruncateMutation::class,
    'ztdquery\shadow\mutation\createtablemutation' => ZtdQuery\Shadow\Mutation\Table\CreateTableMutation::class,
    'ztdquery\shadow\mutation\multitruncatemutation' => ZtdQuery\Shadow\Mutation\Table\MultiTruncateMutation::class,
    'ztdquery\shadow\mutation\synchronizemutation' => ZtdQuery\Shadow\Mutation\Table\SynchronizeMutation::class,
    'ztdquery\shadow\mutation\droptablemutation' => ZtdQuery\Shadow\Mutation\Table\DropTableMutation::class,
    'ztdquery\shadow\shadowtransactionmanager' => ZtdQuery\Shadow\ShadowTransactions::class,
    'ztdquery\schema\referentialaction' => ZtdQuery\Schema\Key\ReferentialAction::class,
    'ztdquery\schema\partialuniqueindex' => ZtdQuery\Schema\Key\PartialUniqueIndex::class,
    'ztdquery\schema\identitygenerationstrategy' => ZtdQuery\Schema\Key\IdentityGenerationStrategy::class,
    'ztdquery\schema\candidatekeyset' => ZtdQuery\Schema\Key\CandidateKeySet::class,
    'ztdquery\schema\foreignkeydefinition' => ZtdQuery\Schema\Key\ForeignKeyDefinition::class,
    'ztdquery\schema\candidatekeyconflict' => ZtdQuery\Schema\Key\CandidateKeyConflict::class,
    'ztdquery\schema\tablepartitionkey' => ZtdQuery\Schema\Partition\TablePartitionKey::class,
    'ztdquery\schema\tablepartitionstrategy' => ZtdQuery\Schema\Partition\TablePartitionStrategy::class,
    'ztdquery\schema\tablepartitionrelation' => ZtdQuery\Schema\Partition\TablePartitionRelation::class,
    'ztdquery\schema\tablepartitioning' => ZtdQuery\Schema\Partition\TablePartitioning::class,
    'ztdquery\schema\columntype' => ZtdQuery\Schema\ColumnDeclaration::class,
];

spl_autoload_register(static function (string $class) use ($classAliases): void {
    $target = $classAliases[strtolower($class)] ?? null;
    if ($target !== null) {
        class_alias($target, $class);
    }
});
