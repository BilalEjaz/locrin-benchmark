<?php

declare(strict_types=1);

namespace NeneProfile\User;

use Closure;
use LogicException;
use Nene2\Audit\AuditRecorderFactoryInterface;
use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Database\DatabaseTransactionManagerInterface;
use Nene2\DependencyInjection\ContainerBuilder;
use Nene2\DependencyInjection\ServiceProviderInterface;
use Nene2\Error\ProblemDetailsResponseFactory;
use Nene2\Http\ClockInterface;
use Nene2\Http\JsonResponseFactory;
use Psr\Container\ContainerInterface;
use Psr\Http\Message\ResponseFactoryInterface;

final readonly class UserServiceProvider implements ServiceProviderInterface
{
    public function register(ContainerBuilder $builder): void
    {
        $builder
            ->set(
                UserRepositoryInterface::class,
                static function (ContainerInterface $c): UserRepositoryInterface {
                    $query = $c->get(DatabaseQueryExecutorInterface::class);

                    if (!$query instanceof DatabaseQueryExecutorInterface) {
                        throw new LogicException('Database query executor service is invalid.');
                    }

                    return new PdoUserRepository($query, self::get($c, ClockInterface::class));
                },
            )
            ->set(
                ListUsersUseCaseInterface::class,
                static fn (ContainerInterface $c): ListUsersUseCaseInterface => new ListUsersUseCase(
                    self::repo($c),
                ),
            )
            ->set(
                GetUserByIdUseCaseInterface::class,
                static fn (ContainerInterface $c): GetUserByIdUseCaseInterface => new GetUserByIdUseCase(
                    self::repo($c),
                ),
            )
            ->set(
                CreateUserUseCaseInterface::class,
                static fn (ContainerInterface $c): CreateUserUseCaseInterface => new CreateUserUseCase(
                    self::repo($c),
                    self::tx($c),
                    self::usersFactory(self::get($c, ClockInterface::class)),
                    self::audit($c),
                ),
            )
            ->set(
                UpdateUserUseCaseInterface::class,
                static fn (ContainerInterface $c): UpdateUserUseCaseInterface => new UpdateUserUseCase(
                    self::repo($c),
                    self::tx($c),
                    self::usersFactory(self::get($c, ClockInterface::class)),
                    self::audit($c),
                ),
            )
            ->set(
                DeleteUserUseCaseInterface::class,
                static fn (ContainerInterface $c): DeleteUserUseCaseInterface => new DeleteUserUseCase(
                    self::repo($c),
                    self::tx($c),
                    self::usersFactory(self::get($c, ClockInterface::class)),
                    self::audit($c),
                ),
            )
            ->set(
                ListUsersHandler::class,
                static fn (ContainerInterface $c): ListUsersHandler => new ListUsersHandler(
                    self::get($c, ListUsersUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                GetUserByIdHandler::class,
                static fn (ContainerInterface $c): GetUserByIdHandler => new GetUserByIdHandler(
                    self::get($c, GetUserByIdUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                CreateUserHandler::class,
                static fn (ContainerInterface $c): CreateUserHandler => new CreateUserHandler(
                    self::get($c, CreateUserUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                UpdateUserHandler::class,
                static fn (ContainerInterface $c): UpdateUserHandler => new UpdateUserHandler(
                    self::get($c, UpdateUserUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                DeleteUserHandler::class,
                static fn (ContainerInterface $c): DeleteUserHandler => new DeleteUserHandler(
                    self::get($c, DeleteUserUseCaseInterface::class),
                    self::responseFactory($c),
                ),
            )
            ->set(
                UserNotFoundExceptionHandler::class,
                static fn (ContainerInterface $c): UserNotFoundExceptionHandler => new UserNotFoundExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                UserEmailConflictExceptionHandler::class,
                static fn (ContainerInterface $c): UserEmailConflictExceptionHandler => new UserEmailConflictExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                RoleNotAssignableExceptionHandler::class,
                static fn (ContainerInterface $c): RoleNotAssignableExceptionHandler => new RoleNotAssignableExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                CannotDeleteSelfExceptionHandler::class,
                static fn (ContainerInterface $c): CannotDeleteSelfExceptionHandler => new CannotDeleteSelfExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                UserRouteRegistrar::class,
                static fn (ContainerInterface $c): UserRouteRegistrar => new UserRouteRegistrar(
                    self::get($c, ListUsersHandler::class),
                    self::get($c, GetUserByIdHandler::class),
                    self::get($c, CreateUserHandler::class),
                    self::get($c, UpdateUserHandler::class),
                    self::get($c, DeleteUserHandler::class),
                ),
            );
    }

    private static function repo(ContainerInterface $c): UserRepositoryInterface
    {
        return self::get($c, UserRepositoryInterface::class);
    }

    private static function tx(ContainerInterface $c): DatabaseTransactionManagerInterface
    {
        return self::get($c, DatabaseTransactionManagerInterface::class);
    }

    private static function audit(ContainerInterface $c): AuditRecorderFactoryInterface
    {
        return self::get($c, AuditRecorderFactoryInterface::class);
    }

    /**
     * @return Closure(DatabaseQueryExecutorInterface): UserRepositoryInterface
     */
    private static function usersFactory(ClockInterface $clock): Closure
    {
        return static fn (DatabaseQueryExecutorInterface $exec): UserRepositoryInterface
            => new PdoUserRepository($exec, $clock);
    }

    private static function json(ContainerInterface $c): JsonResponseFactory
    {
        return self::get($c, JsonResponseFactory::class);
    }

    private static function problemDetails(ContainerInterface $c): ProblemDetailsResponseFactory
    {
        return self::get($c, ProblemDetailsResponseFactory::class);
    }

    private static function responseFactory(ContainerInterface $c): ResponseFactoryInterface
    {
        return self::get($c, ResponseFactoryInterface::class);
    }

    /**
     * @template T of object
     * @param class-string<T> $id
     * @return T
     */
    private static function get(ContainerInterface $c, string $id): object
    {
        $service = $c->get($id);

        if (!$service instanceof $id) {
            throw new LogicException(sprintf('Service %s is invalid.', $id));
        }

        return $service;
    }
}
