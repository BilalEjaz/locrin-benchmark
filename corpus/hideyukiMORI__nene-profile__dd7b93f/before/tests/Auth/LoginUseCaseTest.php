<?php

declare(strict_types=1);

namespace NeneProfile\Tests\Auth;

use Nene2\Auth\TokenIssuerInterface;
use NeneProfile\Auth\InvalidCredentialsException;
use NeneProfile\Auth\LoginInput;
use NeneProfile\Auth\LoginUseCase;
use NeneProfile\Tests\User\InMemoryUserRepository;
use NeneProfile\User\User;
use PHPUnit\Framework\TestCase;

final class LoginUseCaseTest extends TestCase
{
    private InMemoryUserRepository $repo;
    private LoginUseCase $useCase;

    protected function setUp(): void
    {
        $this->repo = new InMemoryUserRepository();

        $tokenIssuer = new class () implements TokenIssuerInterface {
            /** @param array<string, mixed> $claims */
            public function issue(array $claims): string
            {
                return 'test-token.' . base64_encode(json_encode($claims) ?: '{}');
            }
        };

        $this->useCase = new LoginUseCase($this->repo, $tokenIssuer);
    }

    private function seedUser(string $email, string $password, string $role, ?int $organizationId): void
    {
        $this->repo->seed(new User(
            id: 0,
            email: $email,
            passwordHash: password_hash($password, PASSWORD_BCRYPT),
            role: $role,
            organizationId: $organizationId,
            status: 'active',
        ));
    }

    public function test_login_succeeds_with_valid_credentials(): void
    {
        $this->seedUser('admin@example.com', 'secret', 'admin', 1);

        $output = $this->useCase->execute(new LoginInput(
            email: 'admin@example.com',
            password: 'secret',
        ));

        $this->assertSame('admin@example.com', $output->email);
        $this->assertSame('admin', $output->role);
        $this->assertSame(1, $output->orgId);
        $this->assertNotEmpty($output->token);
        $this->assertGreaterThan(time(), $output->expiresAt);
    }

    public function test_superadmin_login_has_null_org_id(): void
    {
        $this->seedUser('superadmin@example.com', 'secret', 'superadmin', null);

        $output = $this->useCase->execute(new LoginInput(
            email: 'superadmin@example.com',
            password: 'secret',
        ));

        $this->assertNull($output->orgId);
        $this->assertSame('superadmin', $output->role);
    }

    public function test_throws_on_wrong_password(): void
    {
        $this->seedUser('admin@example.com', 'secret', 'admin', 1);

        $this->expectException(InvalidCredentialsException::class);

        $this->useCase->execute(new LoginInput(
            email: 'admin@example.com',
            password: 'wrong-password',
        ));
    }

    public function test_throws_on_unknown_email(): void
    {
        $this->expectException(InvalidCredentialsException::class);

        $this->useCase->execute(new LoginInput(
            email: 'nobody@example.com',
            password: 'secret',
        ));
    }
}
