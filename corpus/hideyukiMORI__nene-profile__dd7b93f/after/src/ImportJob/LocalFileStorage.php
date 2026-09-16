<?php

declare(strict_types=1);

namespace NeneProfile\ImportJob;

use Nene2\Http\ClockInterface;
use RuntimeException;

/**
 * Local-filesystem implementation of immutable original-file storage (ADR 0004).
 *
 * Files are written under {basePath}/{organizationId}/{ulid}.csv. The key is the
 * relative path. A write never overwrites an existing key.
 */
final readonly class LocalFileStorage implements FileStorageInterface
{
    public function __construct(
        private string $basePath,
        private ClockInterface $clock,
    ) {
    }

    public function store(int $organizationId, string $contents): string
    {
        $dir = $this->basePath . '/' . $organizationId;

        if (!is_dir($dir) && !mkdir($dir, 0o770, true) && !is_dir($dir)) {
            throw new RuntimeException("Could not create storage directory: {$dir}");
        }

        $key = $organizationId . '/' . $this->generateId() . '.csv';
        $path = $this->basePath . '/' . $key;

        if (file_exists($path)) {
            throw new RuntimeException("Refusing to overwrite existing file: {$key}");
        }

        if (file_put_contents($path, $contents, LOCK_EX) === false) {
            throw new RuntimeException("Could not write file: {$key}");
        }

        return $key;
    }

    public function read(string $key): string
    {
        $path = $this->basePath . '/' . $key;
        $contents = is_file($path) ? file_get_contents($path) : false;

        if ($contents === false) {
            throw new RuntimeException("Could not read file: {$key}");
        }

        return $contents;
    }

    public function exists(string $key): bool
    {
        return is_file($this->basePath . '/' . $key);
    }

    private function generateId(): string
    {
        // Time-sortable random id (not a strict ULID, but sufficient and unique).
        // format('Uv') = epoch milliseconds, same instant microtime(true)*1000 read.
        return dechex((int) $this->clock->now()->format('Uv')) . '_' . bin2hex(random_bytes(8));
    }
}
