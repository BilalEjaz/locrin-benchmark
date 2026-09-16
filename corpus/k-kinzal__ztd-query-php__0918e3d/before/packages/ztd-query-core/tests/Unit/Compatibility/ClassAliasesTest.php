<?php

declare(strict_types=1);

namespace Tests\Unit\Compatibility;

use PHPUnit\Framework\Attributes\CoversNothing;
use PHPUnit\Framework\TestCase;
use ZtdQuery\Schema\CandidateKeySet;
use ZtdQuery\Schema\ColumnType;
use ZtdQuery\Schema\ColumnTypeFamily;
use ZtdQuery\Shadow\Mutation\InsertMutation;
use ZtdQuery\Shadow\ShadowStore;
use ZtdQuery\Shadow\ShadowTransactionManager;

#[CoversNothing]
final class ClassAliasesTest extends TestCase
{
    public function testLegacyNamesConstructWorkingSchemaAndMutationObjects(): void
    {
        $type = new ColumnType(ColumnTypeFamily::INTEGER, 'INTEGER');
        $store = new ShadowStore();
        $store->set('users', []);
        $mutation = new InsertMutation('users', ['id'], candidateKeys: new CandidateKeySet(['PRIMARY' => ['id']]));
        $mutation->apply($store, [['id' => 1]]);

        self::assertSame([['id' => 1]], $store->get('users'));
        self::assertSame(ColumnTypeFamily::INTEGER, $type->family);
    }

    public function testLegacyTransactionNameRollsBackRows(): void
    {
        $store = new ShadowStore();
        $store->set('users', [['id' => 1]]);
        $transactions = new ShadowTransactionManager($store);
        $transactions->begin();
        $store->insert('users', [['id' => 2]]);
        $transactions->rollBack();

        self::assertSame([['id' => 1]], $store->get('users'));
    }
}
