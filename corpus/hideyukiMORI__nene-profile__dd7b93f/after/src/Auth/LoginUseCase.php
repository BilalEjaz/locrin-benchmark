<?php

declare(strict_types=1);

namespace NeneProfile\Auth;

use Nene2\Auth\TokenIssuerInterface;
use Nene2\Http\ClockInterface;
use NeneProfile\User\UserRepositoryInterface;

final readonly class LoginUseCase implements LoginUseCaseInterface
{
    private const TOKEN_TTL_SECONDS = 86400; // 24 hours

    public function __construct(
        private UserRepositoryInterface $users,
        private TokenIssuerInterface $tokenIssuer,
        private ClockInterface $clock,
    ) {
    }

    public function execute(LoginInput $input): LoginOutput
    {
        $user = $this->users->findByEmail($input->email);

        if ($user === null || !password_verify($input->password, $user->passwordHash)) {
            throw new InvalidCredentialsException();
        }

        $role = Role::tryFrom($user->role);

        if ($role === null) {
            throw new InvalidCredentialsException();
        }

        // Read "now" once so iat and exp can never straddle a second boundary.
        $now = $this->clock->now()->getTimestamp();
        $expiresAt = $now + self::TOKEN_TTL_SECONDS;

        // superadmin has no org context; all other roles embed their org_id in the JWT.
        $orgId = $role === Role::Superadmin ? null : $user->organizationId;

        // sub = user ID (integer) for AuthContext::userId() without a DB lookup.
        $token = $this->tokenIssuer->issue([
            'sub'    => $user->id,
            'role'   => $role->value,
            'org_id' => $orgId,
            'iat'    => $now,
            'exp'    => $expiresAt,
        ]);

        return new LoginOutput(
            token: $token,
            expiresAt: $expiresAt,
            email: $user->email,
            role: $role->value,
            orgId: $orgId,
        );
    }
}
