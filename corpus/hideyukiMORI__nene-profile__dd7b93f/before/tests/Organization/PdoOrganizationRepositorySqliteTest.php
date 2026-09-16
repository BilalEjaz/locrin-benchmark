<?php

declare(strict_types=1);

namespace NeneProfile\Tests\Organization;

use NeneProfile\Organization\Organization;
use NeneProfile\Organization\OrganizationSlugConflictException;
use NeneProfile\Organization\PdoOrganizationRepository;
use NeneProfile\Tests\Support\SqlitePdoTestTrait;
use PHPUnit\Framework\TestCase;

final class PdoOrganizationRepositorySqliteTest extends TestCase
{
    use SqlitePdoTestTrait;

    private PdoOrganizationRepository $repo;

    protected function setUp(): void
    {
        $pdo = $this->sqlitePdo();
        $pdo->exec(
            'CREATE TABLE organizations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                custom_domain TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )',
        );
        $pdo->exec('CREATE UNIQUE INDEX uniq_org_slug ON organizations (slug)');

        $this->repo = new PdoOrganizationRepository($this->executor($pdo));
    }

    public function test_save_and_find_by_id(): void
    {
        $id = $this->repo->save(new Organization(name: 'Acme', slug: 'acme', isActive: true));

        $this->assertGreaterThan(0, $id);

        $org = $this->repo->findById($id);
        $this->assertNotNull($org);
        $this->assertSame('Acme', $org->name);
        $this->assertSame('acme', $org->slug);
        $this->assertTrue($org->isActive);
        $this->assertIsString($org->createdAt);
    }

    public function test_find_by_slug_and_inactive_round_trips(): void
    {
        $this->repo->save(new Organization(name: 'Beta', slug: 'beta', isActive: false));

        $org = $this->repo->findBySlug('beta');
        $this->assertNotNull($org);
        $this->assertFalse($org->isActive);
    }

    public function test_duplicate_slug_throws_conflict(): void
    {
        $this->repo->save(new Organization(name: 'Acme', slug: 'acme', isActive: true));

        $this->expectException(OrganizationSlugConflictException::class);
        $this->repo->save(new Organization(name: 'Acme 2', slug: 'acme', isActive: true));
    }

    public function test_update_changes_fields(): void
    {
        $id = $this->repo->save(new Organization(name: 'Acme', slug: 'acme', isActive: true));

        $this->repo->update(new Organization(
            name: 'Renamed',
            slug: 'acme',
            isActive: false,
            id: $id,
            customDomain: 'acme.example.com',
        ));

        $org = $this->repo->findById($id);
        $this->assertNotNull($org);
        $this->assertSame('Renamed', $org->name);
        $this->assertFalse($org->isActive);
        $this->assertSame('acme.example.com', $org->customDomain);
    }

    public function test_list_and_count_and_delete(): void
    {
        $this->repo->save(new Organization(name: 'A', slug: 'a', isActive: true));
        $id = $this->repo->save(new Organization(name: 'B', slug: 'b', isActive: true));
        $this->repo->save(new Organization(name: 'C', slug: 'c', isActive: true));

        $this->assertSame(3, $this->repo->count());
        $this->assertCount(2, $this->repo->findAll(2, 0));
        $this->assertCount(1, $this->repo->findAll(2, 2));

        $this->repo->delete($id);
        $this->assertSame(2, $this->repo->count());
        $this->assertNull($this->repo->findById($id));
    }
}
