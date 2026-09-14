<?php

declare(strict_types=1);

namespace Tests\Unit\Shadow\Mutation;

use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use PHPUnit\Framework\TestCase;
use ZtdQuery\Rewrite\AffectedRowsMode;
use ZtdQuery\Schema\Key\CandidateKeyConflict;
use ZtdQuery\Schema\Key\CandidateKeySet;
use ZtdQuery\Schema\TableDefinition;
use ZtdQuery\Shadow\Mutation\MutationImpact;
use ZtdQuery\Shadow\Mutation\MutationRowIdentity;
use ZtdQuery\Shadow\Mutation\Row\DeleteMutation;
use ZtdQuery\Shadow\Mutation\Row\InsertMutation;
use ZtdQuery\Shadow\Mutation\Row\ReplaceMutation;
use ZtdQuery\Shadow\Mutation\Row\UpdateMutation;
use ZtdQuery\Shadow\Mutation\Table\SynchronizeMutation;
use ZtdQuery\Shadow\Mutation\Upsert\UpsertOperator;
use ZtdQuery\Shadow\Mutation\UpsertColumnSource;
use ZtdQuery\Shadow\Mutation\UpsertExpression;
use ZtdQuery\Shadow\Mutation\UpsertExpressionKind;
use ZtdQuery\Shadow\Mutation\UpsertMutation;
use ZtdQuery\Shadow\Mutation\UpsertUpdate;
use ZtdQuery\Shadow\ShadowStore;
use ZtdQuery\Sql\SqlToken;
use ZtdQuery\Sql\SqlTokenStream;

#[CoversClass(MutationImpact::class)]
#[UsesClass(CandidateKeyConflict::class)]
#[UsesClass(CandidateKeySet::class)]
#[UsesClass(DeleteMutation::class)]
#[UsesClass(InsertMutation::class)]
#[UsesClass(MutationRowIdentity::class)]
#[UsesClass(ReplaceMutation::class)]
#[UsesClass(SynchronizeMutation::class)]
#[UsesClass(TableDefinition::class)]
#[UsesClass(UpsertExpression::class)]
#[UsesClass(UpsertMutation::class)]
#[UsesClass(UpdateMutation::class)]
#[UsesClass(ShadowStore::class)]
#[UsesClass(SqlToken::class)]
#[UsesClass(SqlTokenStream::class)]
#[UsesClass(\ZtdQuery\Schema\Key\CandidateKeyMatch::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\ConflictSearch::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\RowConstraints::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\Upsert\UpsertColumn::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\Upsert\UpsertComparison::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\Upsert\UpsertNumber::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\Upsert\UpsertTruth::class)]
#[UsesClass(\ZtdQuery\Shadow\Row\RowMatch::class)]
#[UsesClass(\ZtdQuery\Shadow\Row\RowMultiset::class)]
#[UsesClass(UpsertUpdate::class)]
#[UsesClass(UpsertOperator::class)]
#[UsesClass(\ZtdQuery\Schema\RowSet::class)]
#[UsesClass(\ZtdQuery\Shadow\Mutation\Upsert\UpsertLiteral::class)]
final class MutationImpactTest extends TestCase
{
    public function testInsertImpactContainsOnlyRowsActuallyAdded(): void
    {
        $before = [['id' => 1]];
        $after = [['id' => 1], ['id' => 2]];
        $impact = new MutationImpact(new InsertMutation('items'), $before, [['id' => 2]], $after);

        self::assertSame(1, $impact->affectedRowCount(AffectedRowsMode::Changed));
        self::assertSame([['id' => 2]], $impact->returningRows());
        self::assertTrue($impact->isInsertLike());
    }

    public function testNoOpUpdateUsesPlatformRowCountMode(): void
    {
        $row = ['id' => 1, 'name' => 'same'];
        $reordered = ['name' => 'same', 'id' => 1];
        $impact = new MutationImpact(new UpdateMutation('items', ['id']), [$row], [$reordered], [$reordered]);

        self::assertSame(0, $impact->affectedRowCount(AffectedRowsMode::Changed));
        self::assertSame(1, $impact->affectedRowCount(AffectedRowsMode::Matched));
        self::assertFalse($impact->isInsertLike());
    }

    public function testNoneModeHidesInternalMigrationRows(): void
    {
        $impact = new MutationImpact(
            new UpdateMutation('items', ['id']),
            [['id' => 1]],
            [['id' => 1, 'age' => 7]],
            [['id' => 1, 'age' => 7]],
        );

        self::assertSame(0, $impact->affectedRowCount(AffectedRowsMode::None));
    }

    public function testReturningUpdateRowsExcludeInternalIdentityMetadata(): void
    {
        $impact = new MutationImpact(
            new UpdateMutation('items', ['id']),
            [['id' => 1, 'name' => 'before']],
            [['id' => 2, 'name' => 'after', '__ztd_original_id' => 1]],
            [['id' => 2, 'name' => 'after']],
        );

        self::assertSame([['id' => 2, 'name' => 'after']], $impact->returningRows());
    }

    public function testReturningDeleteRowsComeFromMutationInput(): void
    {
        $deleted = ['id' => 2, 'name' => 'deleted', '__ztd_original_id' => 2];
        $impact = new MutationImpact(
            new DeleteMutation('items', ['id']),
            [['id' => 1], ['id' => 2, 'name' => 'deleted']],
            [$deleted],
            [['id' => 1]],
        );

        self::assertSame([['id' => 2, 'name' => 'deleted']], $impact->returningRows());
        self::assertFalse($impact->isInsertLike());
    }

    public function testIgnoredInsertHasNoReturningRows(): void
    {
        $row = ['id' => 1];
        $impact = new MutationImpact(new InsertMutation('items'), [$row], [$row], [$row]);

        self::assertSame([], $impact->returningRows());
    }

    public function testAppliedUpsertReturnsResultRowsAndIsInsertLike(): void
    {
        $before = ['id' => 1, 'name' => 'same'];
        $input = $before;
        $mutation = new UpsertMutation('items', ['id']);
        $store = new ShadowStore();
        $store->set('items', [$before]);
        $mutation->apply($store, [$input]);
        $impact = new MutationImpact($mutation, [$before], [$input], $store->get('items'));

        self::assertSame([$input], $impact->returningRows());
        self::assertSame(1, $impact->affectedRowCount(AffectedRowsMode::Matched));
        self::assertSame(0, $impact->affectedRowCount(AffectedRowsMode::Changed));
        self::assertTrue($impact->isInsertLike());
    }

    public function testReplaceIsInsertLike(): void
    {
        $before = [['id' => 1, 'name' => 'before']];
        $after = [['id' => 1]];
        $impact = new MutationImpact(new ReplaceMutation('items', ['id']), $before, $after, $after);

        self::assertTrue($impact->isInsertLike());
        self::assertSame($after, $impact->returningRows());
    }

    public function testImpactPreservesEveryChangedRowAndDuplicateMultiplicity(): void
    {
        $first = ['id' => 1];
        $second = ['id' => 2];
        $impact = new MutationImpact(new InsertMutation('items'), [], [$first, $second], [$first, $second]);
        self::assertSame(2, $impact->affectedRowCount(AffectedRowsMode::Changed));
        self::assertSame([$first, $second], $impact->returningRows());

        $duplicateImpact = new MutationImpact(
            new DeleteMutation('items', ['id']),
            [$first, $first],
            [$first],
            [$first],
        );
        self::assertSame(1, $duplicateImpact->affectedRowCount(AffectedRowsMode::Changed));
    }

    public function testRowsWithDifferentColumnsOrValuesAreChanged(): void
    {
        $impact = new MutationImpact(
            new UpdateMutation('items', ['id']),
            [['id' => 1, 'name' => 'before'], ['id' => 2], ['id' => 3]],
            [],
            [['id' => 1, 'other' => 'before'], ['id' => 2, 'name' => null], ['id' => 4]],
        );

        self::assertSame(3, $impact->affectedRowCount(AffectedRowsMode::Changed));
    }

    public function testSynchronizationCountsMixedOperationsOnceEach(): void
    {
        $definition = new TableDefinition(
            ['id', 'name'],
            ['id' => 'INTEGER', 'name' => 'TEXT'],
            ['id'],
            ['id'],
            [],
        );
        $mutation = new SynchronizeMutation('items', $definition);
        $impact = new MutationImpact(
            $mutation,
            [['id' => 1, 'name' => 'old'], ['id' => 3, 'name' => 'deleted']],
            [['id' => 1, 'name' => 'updated'], ['id' => 2, 'name' => 'inserted']],
            [['id' => 1, 'name' => 'updated'], ['id' => 2, 'name' => 'inserted']],
        );

        self::assertSame(3, $impact->affectedRowCount(AffectedRowsMode::Changed));
        self::assertTrue($impact->isInsertLike());
    }

    public function testSkippedConditionalUpsertHasNoAffectedOrReturningRows(): void
    {
        $row = ['id' => 1, 'name' => 'original', 'score' => 50];
        $mutation = new UpsertMutation(
            'items',
            ['id'],
            ['name'],
            ['name' => UpsertExpression::column(UpsertColumnSource::Incoming, 'name')],
            updatePredicate: UpsertExpression::binary(
                UpsertExpressionKind::GreaterOrEqual,
                UpsertExpression::column(UpsertColumnSource::Existing, 'score'),
                UpsertExpression::literal(80),
            ),
        );
        $store = new ShadowStore();
        $store->set('items', [$row]);
        $input = [['id' => 1, 'name' => 'skipped', 'score' => 95]];
        $mutation->apply($store, $input);
        $impact = new MutationImpact($mutation, [$row], $input, $store->get('items'));

        self::assertSame(0, $impact->affectedRowCount(AffectedRowsMode::Matched));
        self::assertSame([], $impact->returningRows());
    }

    public function testAffectedRowCountIsNothingWhereTheStatementReportsNone(): void
    {
        $impact = new MutationImpact(new InsertMutation('users'), [], [['id' => 1]], [['id' => 1]]);

        self::assertSame(0, $impact->affectedRowCount(AffectedRowsMode::None));
    }

    public function testReturningRowsAnswersTheRowsAStatementWouldReadBack(): void
    {
        $impact = new MutationImpact(new InsertMutation('users'), [], [['id' => 1]], [['id' => 1]]);

        self::assertSame([['id' => 1]], $impact->returningRows());
    }

    public function testIsInsertLikeIsFalseForAStatementThatOnlyRemovesRows(): void
    {
        $impact = new MutationImpact(new DeleteMutation('users', ['id']), [['id' => 1]], [['id' => 1]], []);

        self::assertFalse($impact->isInsertLike());
    }
}
