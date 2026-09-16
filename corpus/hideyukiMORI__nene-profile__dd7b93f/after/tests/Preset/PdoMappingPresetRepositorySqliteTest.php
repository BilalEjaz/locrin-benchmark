<?php

declare(strict_types=1);

namespace NeneProfile\Tests\Preset;

use NeneProfile\Preset\MappingDefinition;
use NeneProfile\Preset\MappingDefinitionFactory;
use NeneProfile\Preset\MappingPreset;
use NeneProfile\Preset\PdoMappingPresetRepository;
use NeneProfile\Preset\PdoMappingPresetVersionRepository;
use NeneProfile\Tests\Support\FixedClock;
use NeneProfile\Tests\Support\SqlitePdoTestTrait;
use PDO;
use PHPUnit\Framework\TestCase;

final class PdoMappingPresetRepositorySqliteTest extends TestCase
{
    use SqlitePdoTestTrait;

    private PdoMappingPresetRepository $presets;
    private PdoMappingPresetVersionRepository $versions;

    protected function setUp(): void
    {
        $pdo = $this->sqlitePdo();
        $this->createSchema($pdo);
        $executor = $this->executor($pdo);
        $this->presets  = new PdoMappingPresetRepository($executor, new FixedClock());
        $this->versions = new PdoMappingPresetVersionRepository($executor, new FixedClock());
    }

    private function createSchema(PDO $pdo): void
    {
        $pdo->exec(
            'CREATE TABLE mapping_presets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                organization_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                bank_label TEXT NOT NULL,
                current_version_id INTEGER,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )',
        );
        $pdo->exec(
            'CREATE TABLE mapping_preset_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                preset_id INTEGER NOT NULL,
                version_number INTEGER NOT NULL,
                definition_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            )',
        );
    }

    private static function definition(): MappingDefinition
    {
        return MappingDefinitionFactory::fromArray([
            'encoding'         => 'auto',
            'delimiter'        => 'comma',
            'header_row_index' => 0,
            'year_pivot'       => 50,
            'columns'          => [
                'transaction_date' => ['source' => '日付', 'transform' => 'date_ymd_slash'],
                'amount_cents'     => ['source' => '金額', 'transform' => 'single_column_signed_cents'],
                'description'      => ['source' => '摘要', 'transform' => 'trim'],
            ],
        ]);
    }

    public function test_save_preset_and_set_current_version(): void
    {
        $presetId = $this->presets->save(new MappingPreset(
            id: 0,
            organizationId: 7,
            name: 'みずほ',
            bankLabel: 'みずほ銀行',
        ));
        $this->assertGreaterThan(0, $presetId);

        $versionId = $this->versions->append($presetId, 1, self::definition());
        $this->presets->setCurrentVersion($presetId, $versionId);

        $preset = $this->presets->findByIdInOrganization($presetId, 7);
        $this->assertNotNull($preset);
        $this->assertSame('みずほ', $preset->name);
        $this->assertSame($versionId, $preset->currentVersionId);
        $this->assertFalse($preset->isDeleted);
    }

    public function test_version_definition_round_trips_through_json(): void
    {
        $presetId = $this->presets->save(new MappingPreset(id: 0, organizationId: 7, name: 'p', bankLabel: 'b'));
        $versionId = $this->versions->append($presetId, 1, self::definition());

        $this->assertSame(1, $this->versions->maxVersionNumber($presetId));

        $version = $this->versions->findById($versionId);
        $this->assertNotNull($version);
        $this->assertSame('comma', $version->definition->delimiter);
        $this->assertSame(50, $version->definition->yearPivot);
        $this->assertArrayHasKey('transaction_date', $version->definition->columns);
    }

    public function test_update_metadata_and_soft_delete(): void
    {
        $presetId = $this->presets->save(new MappingPreset(id: 0, organizationId: 7, name: 'old', bankLabel: 'old'));

        $this->presets->updateMetadata($presetId, 'new', 'new bank');
        $renamed = $this->presets->findByIdInOrganization($presetId, 7);
        $this->assertNotNull($renamed);
        $this->assertSame('new', $renamed->name);
        $this->assertSame('new bank', $renamed->bankLabel);

        $this->presets->softDelete($presetId);
        $this->assertNull($this->presets->findByIdInOrganization($presetId, 7), 'soft-deleted preset is hidden');
    }

    public function test_list_and_count_scoped_to_org_excluding_deleted(): void
    {
        $this->presets->save(new MappingPreset(id: 0, organizationId: 7, name: 'a', bankLabel: 'a'));
        $this->presets->save(new MappingPreset(id: 0, organizationId: 7, name: 'b', bankLabel: 'b'));
        $gone = $this->presets->save(new MappingPreset(id: 0, organizationId: 7, name: 'c', bankLabel: 'c'));
        $this->presets->save(new MappingPreset(id: 0, organizationId: 99, name: 'other', bankLabel: 'o'));
        $this->presets->softDelete($gone);

        $this->assertSame(2, $this->presets->countByOrganizationId(7));
        $this->assertCount(2, $this->presets->findByOrganizationId(7, 50, 0));
        $this->assertSame(1, $this->presets->countByOrganizationId(99));
    }
}
