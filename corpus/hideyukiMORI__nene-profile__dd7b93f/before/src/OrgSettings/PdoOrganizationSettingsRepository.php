<?php

declare(strict_types=1);

namespace NeneProfile\OrgSettings;

use Nene2\Database\DatabaseQueryExecutorInterface;

final readonly class PdoOrganizationSettingsRepository implements OrganizationSettingsRepositoryInterface
{
    private const COLUMNS = 'organization_id, default_encoding, max_file_size_bytes, clear_bearer_token, created_at, updated_at';

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
    ) {
    }

    public function findByOrganizationId(int $organizationId): ?OrganizationSettings
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM organization_settings WHERE organization_id = ?',
            [$organizationId],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    public function upsert(OrganizationSettings $settings): void
    {
        $now = date('Y-m-d H:i:s');
        $existing = $this->findByOrganizationId($settings->organizationId);

        if ($existing === null) {
            $this->query->execute(
                'INSERT INTO organization_settings
                    (organization_id, default_encoding, max_file_size_bytes, clear_bearer_token, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [
                    $settings->organizationId,
                    $settings->defaultEncoding,
                    $settings->maxFileSizeBytes,
                    $settings->clearBearerToken,
                    $now,
                    $now,
                ],
            );

            return;
        }

        $this->query->execute(
            'UPDATE organization_settings
                SET default_encoding = ?, max_file_size_bytes = ?, clear_bearer_token = ?, updated_at = ?
                WHERE organization_id = ?',
            [
                $settings->defaultEncoding,
                $settings->maxFileSizeBytes,
                $settings->clearBearerToken,
                $now,
                $settings->organizationId,
            ],
        );
    }

    /** @param array<string, mixed> $row */
    private function mapRow(array $row): OrganizationSettings
    {
        return new OrganizationSettings(
            organizationId: (int) $row['organization_id'],
            defaultEncoding: (string) $row['default_encoding'],
            maxFileSizeBytes: (int) $row['max_file_size_bytes'],
            clearBearerToken: isset($row['clear_bearer_token']) && $row['clear_bearer_token'] !== ''
                ? (string) $row['clear_bearer_token']
                : null,
            createdAt: isset($row['created_at']) ? (string) $row['created_at'] : null,
            updatedAt: isset($row['updated_at']) ? (string) $row['updated_at'] : null,
        );
    }
}
