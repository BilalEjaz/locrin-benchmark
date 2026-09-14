<?php

declare(strict_types=1);

namespace NeneProfile\Preset;

use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Http\ClockInterface;

final readonly class PdoMappingPresetRepository implements MappingPresetRepositoryInterface
{
    private const COLUMNS = 'id, organization_id, name, bank_label, current_version_id, is_deleted, created_at, updated_at';

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
        private ClockInterface $clock,
    ) {
    }

    public function findByIdInOrganization(int $id, int $organizationId): ?MappingPreset
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM mapping_presets WHERE id = ? AND organization_id = ? AND is_deleted = 0',
            [$id, $organizationId],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    /** @return list<MappingPreset> */
    public function findByOrganizationId(int $organizationId, int $limit, int $offset): array
    {
        $rows = $this->query->fetchAll(
            'SELECT ' . self::COLUMNS . ' FROM mapping_presets
             WHERE organization_id = ? AND is_deleted = 0
             ORDER BY id ASC LIMIT ? OFFSET ?',
            [$organizationId, $limit, $offset],
        );

        return array_map($this->mapRow(...), $rows);
    }

    public function countByOrganizationId(int $organizationId): int
    {
        $row = $this->query->fetchOne(
            'SELECT COUNT(*) AS cnt FROM mapping_presets WHERE organization_id = ? AND is_deleted = 0',
            [$organizationId],
        );

        return (int) ($row['cnt'] ?? 0);
    }

    public function save(MappingPreset $preset): int
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s');
        $this->query->execute(
            'INSERT INTO mapping_presets (organization_id, name, bank_label, current_version_id, is_deleted, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $preset->organizationId,
                $preset->name,
                $preset->bankLabel,
                $preset->currentVersionId,
                $preset->isDeleted ? 1 : 0,
                $now,
                $now,
            ],
        );

        return $this->query->lastInsertId();
    }

    public function updateMetadata(int $id, string $name, string $bankLabel): void
    {
        $this->query->execute(
            'UPDATE mapping_presets SET name = ?, bank_label = ?, updated_at = ? WHERE id = ?',
            [$name, $bankLabel, $this->clock->now()->format('Y-m-d H:i:s'), $id],
        );
    }

    public function setCurrentVersion(int $id, int $versionId): void
    {
        $this->query->execute(
            'UPDATE mapping_presets SET current_version_id = ?, updated_at = ? WHERE id = ?',
            [$versionId, $this->clock->now()->format('Y-m-d H:i:s'), $id],
        );
    }

    public function softDelete(int $id): void
    {
        $this->query->execute(
            'UPDATE mapping_presets SET is_deleted = 1, updated_at = ? WHERE id = ?',
            [$this->clock->now()->format('Y-m-d H:i:s'), $id],
        );
    }

    /** @param array<string, mixed> $row */
    private function mapRow(array $row): MappingPreset
    {
        return new MappingPreset(
            id: (int) $row['id'],
            organizationId: (int) $row['organization_id'],
            name: (string) $row['name'],
            bankLabel: (string) $row['bank_label'],
            currentVersionId: isset($row['current_version_id']) ? (int) $row['current_version_id'] : null,
            isDeleted: (bool) $row['is_deleted'],
            createdAt: isset($row['created_at']) ? (string) $row['created_at'] : null,
            updatedAt: isset($row['updated_at']) ? (string) $row['updated_at'] : null,
        );
    }
}
