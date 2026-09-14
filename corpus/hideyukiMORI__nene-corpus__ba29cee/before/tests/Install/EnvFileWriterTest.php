<?php

declare(strict_types=1);

namespace NeneCorpus\Tests\Install;

use Dotenv\Dotenv;
use Nene2\Install\EnvironmentWriter;
use NeneCorpus\Install\EnvFileWriter;
use NeneCorpus\Install\InstallRuntimeException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Covers the security fixes delegated to NENE2's EnvironmentWriter: the installed .env must be
 * written non-world-readable (0640, fail-closed) and every operator-supplied value must be
 * escaped so it round-trips through phpdotenv verbatim (no .env injection).
 */
final class EnvFileWriterTest extends TestCase
{
    private string $projectRoot;

    protected function setUp(): void
    {
        $this->projectRoot = sys_get_temp_dir() . '/nene-corpus-envwriter-' . uniqid('', true);
        mkdir($this->projectRoot, 0775, true);

        file_put_contents(
            $this->projectRoot . '/.env.example',
            <<<'ENV'
                APP_ENV=local
                APP_NAME="NeNe Corpus"
                # --- Admin auth — never commit real secrets ---
                NENE2_LOCAL_JWT_SECRET=
                ANTHROPIC_API_KEY=
                DB_PASSWORD=
                ENV,
        );
    }

    protected function tearDown(): void
    {
        foreach (['/.env', '/.env.example'] as $file) {
            if (is_file($this->projectRoot . $file)) {
                unlink($this->projectRoot . $file);
            }
        }

        if (is_dir($this->projectRoot)) {
            rmdir($this->projectRoot);
        }
    }

    public function test_env_is_written_non_world_readable(): void
    {
        $this->writer()->write(['DB_PASSWORD' => 'secret']);

        $envPath = $this->projectRoot . '/.env';
        self::assertFileExists($envPath);

        $perms = fileperms($envPath);
        self::assertNotFalse($perms);
        self::assertSame(0, $perms & 0007, '.env must not be world-accessible');
        self::assertSame(0640, $perms & 0777);
    }

    #[DataProvider('awkwardValues')]
    public function test_values_round_trip_through_phpdotenv(string $value): void
    {
        $this->writer()->write([
            'DB_PASSWORD' => $value,
            'ANTHROPIC_API_KEY' => $value,
        ]);

        $content = file_get_contents($this->projectRoot . '/.env');
        self::assertIsString($content);

        $parsed = Dotenv::parse($content);
        self::assertSame($value, $parsed['DB_PASSWORD'] ?? null);
        self::assertSame($value, $parsed['ANTHROPIC_API_KEY'] ?? null);
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function awkwardValues(): iterable
    {
        yield 'dollar (phpdotenv expansion)' => ['pa$$word'];
        yield 'braced var' => ['${HOME}'];
        yield 'double quote' => ['has"quote'];
        yield 'space and hash' => ['has space #and hash'];
        yield 'backslash' => ['back\\slash'];
        yield 'everything' => ['mix "a" $b \\c #d = e'];
    }

    public function test_template_comments_are_preserved(): void
    {
        $this->writer()->write(['DB_PASSWORD' => 'secret']);

        $content = file_get_contents($this->projectRoot . '/.env');
        self::assertIsString($content);
        self::assertStringContainsString('# --- Admin auth', $content);
    }

    public function test_value_with_newline_is_rejected(): void
    {
        $this->expectException(InstallRuntimeException::class);

        $this->writer()->write(['DB_PASSWORD' => "line1\nINJECTED=evil"]);
    }

    private function writer(): EnvFileWriter
    {
        return new EnvFileWriter($this->projectRoot, new EnvironmentWriter());
    }
}
