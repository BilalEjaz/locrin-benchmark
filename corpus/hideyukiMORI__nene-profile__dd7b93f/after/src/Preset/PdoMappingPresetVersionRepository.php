<?php

declare(strict_types=1);

namespace NeneProfile\Preset;

use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Http\ClockInterface;

final readonly class PdoMappingPresetVersionRepository implements MappingPresetVersionRepositoryInterface
{
    public function __construct(
        private DatabaseQueryExecutorInterface $query,
        private ClockInterface $clock,
    ) {
    }

    public function findById(int $id): ?MappingPresetVersion
    {
        $row = $this->query->fetchOne(
            'SELECT id, preset_id, version_number, definition_json, created_at FROM mapping_preset_versions WHERE id = ?',
            [$id],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    public function maxVersionNumber(int $presetId): int
    {
        $row = $this->query->fetchOne(
            'SELECT MAX(version_number) AS max_version FROM mapping_preset_versions WHERE preset_id = ?',
            [$presetId],
        );

        return (int) ($row['max_version'] ?? 0);
    }

    public function append(int $presetId, int $versionNumber, MappingDefinition $definition): int
    {
        $json = json_encode($definition->toArray(), JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);

        $this->query->execute(
            'INSERT INTO mapping_preset_versions (preset_id, version_number, definition_json, created_at)
             VALUES (?, ?, ?, ?)',
            [$presetId, $versionNumber, $json, $this->clock->now()->format('Y-m-d H:i:s')],
        );

        return $this->query->lastInsertId();
    }

    /** @param array<string, mixed> $row */
    private function mapRow(array $row): MappingPresetVersion
    {
        $decoded = json_decode((string) $row['definition_json'], true, 512, JSON_THROW_ON_ERROR);
        $definition = MappingDefinitionFactory::fromArray(is_array($decoded) ? $decoded : []);

        return new MappingPresetVersion(
            id: (int) $row['id'],
            presetId: (int) $row['preset_id'],
            versionNumber: (int) $row['version_number'],
            definition: $definition,
            createdAt: isset($row['created_at']) ? (string) $row['created_at'] : null,
        );
    }
}
