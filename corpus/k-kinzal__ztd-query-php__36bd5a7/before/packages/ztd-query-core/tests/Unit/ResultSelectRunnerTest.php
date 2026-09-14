<?php

declare(strict_types=1);

namespace Tests\Unit;

use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\UsesClass;
use PHPUnit\Framework\TestCase;
use Tests\Fake\FakeStatement;
use ZtdQuery\Connection\ResultColumn;
use ZtdQuery\Connection\ResultSet;
use ZtdQuery\Platform\ResultColumnTypeResolver;
use ZtdQuery\ResultSelectRunner;
use ZtdQuery\Schema\ColumnDeclaration;
use ZtdQuery\Schema\ColumnTypeFamily;

#[CoversClass(ResultSelectRunner::class)]
#[UsesClass(ColumnDeclaration::class)]
#[UsesClass(ResultColumn::class)]
#[UsesClass(ResultSet::class)]
#[UsesClass(\ZtdQuery\Schema\RowSet::class)]
final class ResultSelectRunnerTest extends TestCase
{
    public function testRunReturnsRowsFromExecutor(): void
    {
        $runner = new ResultSelectRunner();
        $rows = [['id' => 1, 'name' => 'Alice']];

        $resolver = self::createStub(ResultColumnTypeResolver::class);
        $result = $runner->run('SELECT * FROM users', fn () => new FakeStatement($rows), $resolver);

        self::assertSame($rows, $result);
    }

    public function testRunReturnsEmptyWhenExecutorReturnsFalse(): void
    {
        $runner = new ResultSelectRunner();

        $resolver = self::createStub(ResultColumnTypeResolver::class);
        $result = $runner->run('SELECT * FROM users', fn () => false, $resolver);

        self::assertSame([], $result);
    }

    public function testRunStatementReturnsRows(): void
    {
        $runner = new ResultSelectRunner();
        $rows = [['id' => 1]];
        $statement = new FakeStatement($rows);

        $resolver = self::createStub(ResultColumnTypeResolver::class);
        $result = $runner->runStatement($statement, $resolver);

        self::assertSame($rows, $result);
        self::assertTrue($statement->isExecuted());
    }

    public function testRunResultSetRetainsColumnsWhenRowsAreEmpty(): void
    {
        $runner = new ResultSelectRunner();
        $column = new ResultColumn('id', new ColumnDeclaration(ColumnTypeFamily::INTEGER, 'int4'));

        $resolver = self::createStub(ResultColumnTypeResolver::class);
        $result = $runner->runResultSet(
            'SELECT id FROM users WHERE FALSE',
            fn () => new FakeStatement([], [$column]),
            $resolver,
        );

        self::assertSame([], $result->rows);
        self::assertSame([$column], $result->columns);
    }

    public function testReadResultSetReadsMetadataBeforeRows(): void
    {
        $runner = new ResultSelectRunner();
        $column = new ResultColumn('id', new ColumnDeclaration(ColumnTypeFamily::INTEGER, 'int4'));
        $statement = new FakeStatement([['id' => 1]], [$column]);

        $resolver = self::createStub(ResultColumnTypeResolver::class);
        $result = $runner->readResultSet($statement, $resolver);

        self::assertSame([['id' => 1]], $result->rows);
        self::assertSame([$column], $result->columns);
    }

    public function testReadResultSetPassesPlatformTypeResolverToStatement(): void
    {
        $resolver = self::createStub(ResultColumnTypeResolver::class);
        $statement = new FakeStatement();

        (new ResultSelectRunner())->readResultSet($statement, $resolver);

        self::assertSame([$resolver], $statement->typeResolversAsked());
    }
}
