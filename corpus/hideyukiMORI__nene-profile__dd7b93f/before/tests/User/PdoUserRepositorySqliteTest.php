<?php

declare(strict_types=1);

namespace NeneProfile\Tests\User;

use Nene2\Database\DatabaseConnectionFactoryInterface;
use Nene2\Database\PdoDatabaseQueryExecutor;
use NeneProfile\User\PdoUserRepository;
use NeneProfile\User\User;
use NeneProfile\User\UserEmailConflictException;
use PDO;
use PHPUnit\Framework\TestCase;

/**
 * Integration test for PdoUserRepository against a real (in-memory) SQLite
 * database. This catches database-portability regressions — e.g. the MySQL-only
 * UNIX_TIMESTAMP() that broke login on SQLite (issue #27).
 */
final class PdoUserRepositorySqliteTest extends TestCase
{
    private PdoUserRepository $repo;

    protected function setUp(): void
    {
        $pdo = new PDO('sqlite::memory:');
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->exec(
            'CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                organization_id INTEGER,
                status TEXT NOT NULL DEFAULT "active",
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )',
        );
        $pdo->exec('CREATE UNIQUE INDEX uniq_users_email ON users (email)');

        $factory = new class ($pdo) implements DatabaseConnectionFactoryInterface {
            public function __construct(private readonly PDO $pdo)
            {
            }

            public function create(): PDO
            {
                return $this->pdo;
            }
        };

        $this->repo = new PdoUserRepository(new PdoDatabaseQueryExecutor($factory, $pdo));
    }

    public function test_create_and_find_by_email(): void
    {
        $id = $this->repo->save(new User(
            id: 0,
            email: 'admin@example.com',
            passwordHash: password_hash('secret', PASSWORD_BCRYPT),
            role: 'admin',
            organizationId: 7,
            status: 'active',
        ));

        $this->assertGreaterThan(0, $id);

        $found = $this->repo->findByEmail('admin@example.com');
        $this->assertNotNull($found);
        $this->assertSame('admin', $found->role);
        $this->assertSame(7, $found->organizationId);
        // Timestamps converted to epoch integers without UNIX_TIMESTAMP().
        $this->assertIsInt($found->createdAt);
        $this->assertGreaterThan(0, $found->createdAt);
    }

    public function test_org_scoped_lookup(): void
    {
        $id = $this->repo->save(new User(
            id: 0,
            email: 'member@example.com',
            passwordHash: 'x',
            role: 'member',
            organizationId: 7,
        ));

        $this->assertNotNull($this->repo->findByIdInOrganization($id, 7));
        $this->assertNull($this->repo->findByIdInOrganization($id, 999));
    }

    public function test_update_role_and_status(): void
    {
        $id = $this->repo->save(new User(
            id: 0,
            email: 'u@example.com',
            passwordHash: 'x',
            role: 'member',
            organizationId: 7,
        ));

        $this->repo->updateRole($id, 'viewer');
        $this->repo->updateStatus($id, 'invited');

        $user = $this->repo->findById($id);
        $this->assertNotNull($user);
        $this->assertSame('viewer', $user->role);
        $this->assertSame('invited', $user->status);
    }

    public function test_list_and_count_by_organization(): void
    {
        $this->repo->save(new User(id: 0, email: 'a@x.com', passwordHash: 'x', role: 'member', organizationId: 7));
        $this->repo->save(new User(id: 0, email: 'b@x.com', passwordHash: 'x', role: 'member', organizationId: 7));
        $this->repo->save(new User(id: 0, email: 'c@x.com', passwordHash: 'x', role: 'member', organizationId: 8));

        $this->assertCount(2, $this->repo->findByOrganizationId(7, 50, 0));
        $this->assertSame(2, $this->repo->countByOrganizationId(7));
        $this->assertTrue($this->repo->emailExists('a@x.com'));
        $this->assertFalse($this->repo->emailExists('z@x.com'));
    }

    public function test_duplicate_email_maps_unique_violation_to_conflict(): void
    {
        // Race backstop: a unique(email) violation must surface as the domain
        // conflict (422), not a raw constraint exception (500). The executor
        // wraps the driver error in DatabaseConstraintException, so the repo must
        // catch that type rather than PDOException.
        $this->repo->save(new User(id: 0, email: 'dup@x.com', passwordHash: 'x', role: 'member', organizationId: 7));

        $this->expectException(UserEmailConflictException::class);
        $this->repo->save(new User(id: 0, email: 'dup@x.com', passwordHash: 'x', role: 'member', organizationId: 7));
    }
}
