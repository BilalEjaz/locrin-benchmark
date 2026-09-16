<?php

declare(strict_types=1);

use Composer\Autoload\ClassLoader;

/**
 * Former public names of classes moved into responsibility namespaces.
 *
 * A former name becomes an alias as soon as either name is autoloaded, so a
 * parameter or return type declared with a former name accepts the relocated
 * class while no implementation is loaded during Composer bootstrap.
 *
 * @var array<class-string, string>
 */
$formerNames = [
    ZtdQuery\Shadow\Mutation\Row\MultiTableMutationRow::class => 'ZtdQuery\\Shadow\\Mutation\\MultiTableMutationRow',
    ZtdQuery\Shadow\Mutation\Row\UpdateMutation::class => 'ZtdQuery\\Shadow\\Mutation\\UpdateMutation',
    ZtdQuery\Shadow\Mutation\Row\InsertMutation::class => 'ZtdQuery\\Shadow\\Mutation\\InsertMutation',
    ZtdQuery\Shadow\Mutation\Row\MultiTableMutationTarget::class => 'ZtdQuery\\Shadow\\Mutation\\MultiTableMutationTarget',
    ZtdQuery\Shadow\Mutation\Row\DeleteMutation::class => 'ZtdQuery\\Shadow\\Mutation\\DeleteMutation',
    ZtdQuery\Shadow\Mutation\Row\MultiUpdateMutation::class => 'ZtdQuery\\Shadow\\Mutation\\MultiUpdateMutation',
    ZtdQuery\Shadow\Mutation\Row\ReplaceMutation::class => 'ZtdQuery\\Shadow\\Mutation\\ReplaceMutation',
    ZtdQuery\Shadow\Mutation\Row\ResultSetMutation::class => 'ZtdQuery\\Shadow\\Mutation\\ResultSetMutation',
    ZtdQuery\Shadow\Mutation\Row\MultiDeleteMutation::class => 'ZtdQuery\\Shadow\\Mutation\\MultiDeleteMutation',
    ZtdQuery\Shadow\Mutation\Table\CreateTableLikeMutation::class => 'ZtdQuery\\Shadow\\Mutation\\CreateTableLikeMutation',
    ZtdQuery\Shadow\Mutation\Table\CreateTableAsSelectMutation::class => 'ZtdQuery\\Shadow\\Mutation\\CreateTableAsSelectMutation',
    ZtdQuery\Shadow\Mutation\Table\TruncateMutation::class => 'ZtdQuery\\Shadow\\Mutation\\TruncateMutation',
    ZtdQuery\Shadow\Mutation\Table\CreateTableMutation::class => 'ZtdQuery\\Shadow\\Mutation\\CreateTableMutation',
    ZtdQuery\Shadow\Mutation\Table\MultiTruncateMutation::class => 'ZtdQuery\\Shadow\\Mutation\\MultiTruncateMutation',
    ZtdQuery\Shadow\Mutation\Table\SynchronizeMutation::class => 'ZtdQuery\\Shadow\\Mutation\\SynchronizeMutation',
    ZtdQuery\Shadow\Mutation\Table\DropTableMutation::class => 'ZtdQuery\\Shadow\\Mutation\\DropTableMutation',
    ZtdQuery\Shadow\ShadowTransactions::class => 'ZtdQuery\\Shadow\\ShadowTransactionManager',
    ZtdQuery\Schema\Key\ReferentialAction::class => 'ZtdQuery\\Schema\\ReferentialAction',
    ZtdQuery\Schema\Key\PartialUniqueIndex::class => 'ZtdQuery\\Schema\\PartialUniqueIndex',
    ZtdQuery\Schema\Key\IdentityGenerationStrategy::class => 'ZtdQuery\\Schema\\IdentityGenerationStrategy',
    ZtdQuery\Schema\Key\CandidateKeySet::class => 'ZtdQuery\\Schema\\CandidateKeySet',
    ZtdQuery\Schema\Key\ForeignKeyDefinition::class => 'ZtdQuery\\Schema\\ForeignKeyDefinition',
    ZtdQuery\Schema\Key\CandidateKeyConflict::class => 'ZtdQuery\\Schema\\CandidateKeyConflict',
    ZtdQuery\Schema\Partition\TablePartitionKey::class => 'ZtdQuery\\Schema\\TablePartitionKey',
    ZtdQuery\Schema\Partition\TablePartitionStrategy::class => 'ZtdQuery\\Schema\\TablePartitionStrategy',
    ZtdQuery\Schema\Partition\TablePartitionRelation::class => 'ZtdQuery\\Schema\\TablePartitionRelation',
    ZtdQuery\Schema\Partition\TablePartitioning::class => 'ZtdQuery\\Schema\\TablePartitioning',
    ZtdQuery\Schema\ColumnDeclaration::class => 'ZtdQuery\\Schema\\ColumnType',
];
$currentNames = array_flip($formerNames);

spl_autoload_register(static function (string $class) use ($formerNames, $currentNames): void {
    $current = $currentNames[$class] ?? $class;
    $former = $formerNames[$current] ?? null;
    if ($former === null) {
        return;
    }
    if (!class_exists($current, false)) {
        foreach (ClassLoader::getRegisteredLoaders() as $loader) {
            if ($loader->loadClass($current) === true) {
                break;
            }
        }
    }
    if (class_exists($current, false) && !class_exists($former, false)) {
        class_alias($current, $former);
    }
}, true, true);
