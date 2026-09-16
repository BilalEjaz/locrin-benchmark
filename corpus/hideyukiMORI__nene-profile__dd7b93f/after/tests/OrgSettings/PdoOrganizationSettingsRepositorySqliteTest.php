<?php

declare(strict_types=1);

namespace NeneProfile\Tests\OrgSettings;

use NeneProfile\OrgSettings\OrganizationSettings;
use NeneProfile\OrgSettings\PdoOrganizationSettingsRepository;
use NeneProfile\Tests\Support\FixedClock;
use NeneProfile\Tests\Support\SqlitePdoTestTrait;
use PHPUnit\Framework\TestCase;

final class PdoOrganizationSettingsRepositorySqliteTest extends TestCase
{
    use SqlitePdoTestTrait;

    private PdoOrganizationSettingsRepository $repo;

    protected function setUp(): void
    {
        $pdo = $this->sqlitePdo();
        $pdo->exec(
            'CREATE TABLE organization_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                default_encoding TEXT NOT NULL DEFAULT "auto",
                max_file_size_bytes INTEGER NOT NULL DEFAULT 10485760,
                clear_bearer_token TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )',
        );
        $pdo->exec('CREATE UNIQUE INDEX uniq_settings_org ON organization_settings (organization_id)');

        $this->repo = new PdoOrganizationSettingsRepository($this->executor($pdo), new FixedClock());
    }

    public function test_returns_null_when_unset(): void
    {
        $this->assertNull($this->repo->findByOrganizationId(7));
    }

    public function test_upsert_inserts_then_updates_without_duplicating(): void
    {
        $this->repo->upsert(new OrganizationSettings(
            organizationId: 7,
            defaultEncoding: 'utf-8',
            maxFileSizeBytes: 2048,
            clearBearerToken: 'tok_1',
        ));

        $first = $this->repo->findByOrganizationId(7);
        $this->assertNotNull($first);
        $this->assertSame('utf-8', $first->defaultEncoding);
        $this->assertSame(2048, $first->maxFileSizeBytes);
        $this->assertSame('tok_1', $first->clearBearerToken);

        // Second upsert must UPDATE the existing row, not INSERT a duplicate.
        $this->repo->upsert(new OrganizationSettings(
            organizationId: 7,
            defaultEncoding: 'shift_jis',
            maxFileSizeBytes: 4096,
            clearBearerToken: 'tok_2',
        ));

        $second = $this->repo->findByOrganizationId(7);
        $this->assertNotNull($second);
        $this->assertSame('shift_jis', $second->defaultEncoding);
        $this->assertSame(4096, $second->maxFileSizeBytes);
        $this->assertSame('tok_2', $second->clearBearerToken);
    }

    public function test_upsert_is_scoped_per_organization(): void
    {
        $this->repo->upsert(new OrganizationSettings(organizationId: 7, defaultEncoding: 'utf-8'));
        $this->repo->upsert(new OrganizationSettings(organizationId: 8, defaultEncoding: 'shift_jis'));

        $this->assertSame('utf-8', $this->repo->findByOrganizationId(7)?->defaultEncoding);
        $this->assertSame('shift_jis', $this->repo->findByOrganizationId(8)?->defaultEncoding);
    }
}
