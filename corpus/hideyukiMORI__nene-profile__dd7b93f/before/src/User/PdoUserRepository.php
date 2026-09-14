<?php

declare(strict_types=1);

namespace NeneProfile\User;

use Nene2\Database\DatabaseConstraintException;
use Nene2\Database\DatabaseQueryExecutorInterface;

final readonly class PdoUserRepository implements UserRepositoryInterface
{
    // Portable across MySQL and SQLite: select raw datetime strings and convert
    // to epoch seconds in PHP (mapRow). Avoid DB-specific UNIX_TIMESTAMP().
    private const SELECT_COLUMNS = '
        id, email, password_hash, role, organization_id, status,
        created_at, updated_at
    ';

    public function __construct(
        private DatabaseQueryExecutorInterface $query,
    ) {
    }

    public function findByEmail(string $email): ?User
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::SELECT_COLUMNS . ' FROM users WHERE email = ?',
            [$email],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    public function findById(int $id): ?User
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::SELECT_COLUMNS . ' FROM users WHERE id = ?',
            [$id],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    public function findByIdInOrganization(int $id, int $organizationId): ?User
    {
        $row = $this->query->fetchOne(
            'SELECT ' . self::SELECT_COLUMNS . ' FROM users WHERE id = ? AND organization_id = ?',
            [$id, $organizationId],
        );

        return $row !== null ? $this->mapRow($row) : null;
    }

    /** @return list<User> */
    public function findByOrganizationId(int $organizationId, int $limit, int $offset): array
    {
        $rows = $this->query->fetchAll(
            'SELECT ' . self::SELECT_COLUMNS . ' FROM users WHERE organization_id = ? ORDER BY id ASC LIMIT ? OFFSET ?',
            [$organizationId, $limit, $offset],
        );

        return array_map($this->mapRow(...), $rows);
    }

    public function countByOrganizationId(int $organizationId): int
    {
        $row = $this->query->fetchOne(
            'SELECT COUNT(*) AS cnt FROM users WHERE organization_id = ?',
            [$organizationId],
        );

        return (int) ($row['cnt'] ?? 0);
    }

    public function emailExists(string $email): bool
    {
        return $this->query->fetchOne('SELECT 1 FROM users WHERE email = ?', [$email]) !== null;
    }

    public function save(User $user): int
    {
        $now = date('Y-m-d H:i:s');

        try {
            $this->query->execute(
                'INSERT INTO users (email, password_hash, role, organization_id, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    $user->email,
                    $user->passwordHash,
                    $user->role,
                    $user->organizationId,
                    $user->status,
                    $now,
                    $now,
                ],
            );
        } catch (DatabaseConstraintException) {
            // Race backstop: the UseCase pre-checks emailExists(), but a concurrent
            // insert can still hit the unique(email) constraint. The executor wraps
            // the driver PDOException into DatabaseConstraintException (not a
            // PDOException), so we catch that type here.
            throw new UserEmailConflictException($user->email);
        }

        return $this->query->lastInsertId();
    }

    public function updateRole(int $id, string $role): void
    {
        $this->query->execute(
            'UPDATE users SET role = ?, updated_at = ? WHERE id = ?',
            [$role, date('Y-m-d H:i:s'), $id],
        );
    }

    public function updateStatus(int $id, string $status): void
    {
        $this->query->execute(
            'UPDATE users SET status = ?, updated_at = ? WHERE id = ?',
            [$status, date('Y-m-d H:i:s'), $id],
        );
    }

    public function updatePassword(int $id, string $passwordHash): void
    {
        $this->query->execute(
            'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
            [$passwordHash, date('Y-m-d H:i:s'), $id],
        );
    }

    public function delete(int $id): void
    {
        $this->query->execute('DELETE FROM users WHERE id = ?', [$id]);
    }

    public function count(): int
    {
        $row = $this->query->fetchOne('SELECT COUNT(*) AS cnt FROM users', []);

        return (int) ($row['cnt'] ?? 0);
    }

    /** @param array<string, mixed> $row */
    private function mapRow(array $row): User
    {
        return new User(
            id: (int) $row['id'],
            email: (string) $row['email'],
            passwordHash: (string) $row['password_hash'],
            role: (string) $row['role'],
            organizationId: isset($row['organization_id']) ? (int) $row['organization_id'] : null,
            status: (string) ($row['status'] ?? 'active'),
            createdAt: self::toEpoch($row['created_at'] ?? null),
            updatedAt: self::toEpoch($row['updated_at'] ?? null),
        );
    }

    private static function toEpoch(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        // Already an epoch integer (e.g. some drivers), or a datetime string.
        if (is_int($value) || ctype_digit((string) $value)) {
            return (int) $value;
        }

        $ts = strtotime((string) $value);

        return $ts !== false ? $ts : null;
    }
}
