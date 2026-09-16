<?php

declare(strict_types=1);

namespace NeneProfile\Organization;

use Nene2\Database\DatabaseConstraintException;
use Nene2\Database\DatabaseQueryExecutorInterface;

final readonly class PdoOrganizationRepository implements OrganizationRepositoryInterface
{
    private const COLUMNS = 'id, name, slug, is_active, custom_domain, created_at, updated_at';

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
    ) {
    }

    public function findById(int $id): ?Organization
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM organizations WHERE id = ?',
            [$id],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    public function findBySlug(string $slug): ?Organization
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM organizations WHERE slug = ?',
            [$slug],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    public function findByCustomDomain(string $domain): ?Organization
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::COLUMNS . ' FROM organizations WHERE custom_domain = ?',
            [$domain],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    /** @return list<Organization> */
    public function findAll(int $limit, int $offset): array
    {
        $rows = $this->query->fetchAll(
            'SELECT ' . self::COLUMNS . ' FROM organizations ORDER BY id ASC LIMIT ? OFFSET ?',
            [$limit, $offset],
        );

        return array_map(fn (array $row) => $this->mapRow($row), $rows);
    }

    public function count(): int
    {
        $row = $this->query->fetchOne('SELECT COUNT(*) AS cnt FROM organizations', []);

        return $row !== null ? (int) $row['cnt'] : 0;
    }

    public function save(Organization $organization): int
    {
        $now = date('Y-m-d H:i:s');

        try {
            $this->query->execute(
                'INSERT INTO organizations (name, slug, is_active, custom_domain, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [
                    $organization->name,
                    $organization->slug,
                    $organization->isActive ? 1 : 0,
                    $organization->customDomain,
                    $now,
                    $now,
                ],
            );
        } catch (DatabaseConstraintException $e) {
            // The query executor wraps the driver's PDOException (which never
            // reaches a `catch (PDOException)`) into this type. The slug carries
            // the only unique constraint a caller can act on, so map it; inspect
            // the original message to avoid mislabelling a custom_domain clash.
            $previous = $e->getPrevious();
            $detail = $previous !== null ? $previous->getMessage() : $e->getMessage();
            if (!str_contains($detail, 'custom_domain')) {
                throw new OrganizationSlugConflictException($organization->slug);
            }

            throw $e;
        }

        return $this->query->lastInsertId();
    }

    public function update(Organization $organization): void
    {
        if ($organization->id === null) {
            throw new OrganizationNotFoundException(0);
        }

        $now = date('Y-m-d H:i:s');

        $this->query->execute(
            'UPDATE organizations SET name = ?, slug = ?, is_active = ?, custom_domain = ?, updated_at = ? WHERE id = ?',
            [
                $organization->name,
                $organization->slug,
                $organization->isActive ? 1 : 0,
                $organization->customDomain,
                $now,
                $organization->id,
            ],
        );
    }

    public function delete(int $id): void
    {
        $org = $this->findById($id);

        if ($org === null) {
            throw new OrganizationNotFoundException($id);
        }

        $this->query->execute('DELETE FROM organizations WHERE id = ?', [$id]);
    }

    /** @param array<string, mixed> $row */
    private function mapRow(array $row): Organization
    {
        return new Organization(
            name: (string) $row['name'],
            slug: (string) $row['slug'],
            isActive: (bool) $row['is_active'],
            id: (int) $row['id'],
            customDomain: isset($row['custom_domain']) && $row['custom_domain'] !== '' ? (string) $row['custom_domain'] : null,
            createdAt: (string) $row['created_at'],
            updatedAt: (string) $row['updated_at'],
        );
    }
}
