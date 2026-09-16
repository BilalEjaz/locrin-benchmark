<?php

declare(strict_types=1);

namespace NeneProfile\Organization;

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

final readonly class OrganizationServiceProvider implements ServiceProviderInterface
{
    public function register(ContainerBuilder $builder): void
    {
        $builder
            ->set(
                OrganizationRepositoryInterface::class,
                static function (ContainerInterface $c): OrganizationRepositoryInterface {
                    $query = $c->get(DatabaseQueryExecutorInterface::class);

                    if (!$query instanceof DatabaseQueryExecutorInterface) {
                        throw new LogicException('Database query executor service is invalid.');
                    }

                    return new PdoOrganizationRepository($query, self::clock($c));
                },
            )
            ->set(
                ListOrganizationsUseCaseInterface::class,
                static function (ContainerInterface $c): ListOrganizationsUseCaseInterface {
                    $repo = $c->get(OrganizationRepositoryInterface::class);

                    if (!$repo instanceof OrganizationRepositoryInterface) {
                        throw new LogicException('Organization repository service is invalid.');
                    }

                    return new ListOrganizationsUseCase($repo);
                },
            )
            ->set(
                GetOrganizationByIdUseCaseInterface::class,
                static function (ContainerInterface $c): GetOrganizationByIdUseCaseInterface {
                    $repo = $c->get(OrganizationRepositoryInterface::class);

                    if (!$repo instanceof OrganizationRepositoryInterface) {
                        throw new LogicException('Organization repository service is invalid.');
                    }

                    return new GetOrganizationByIdUseCase($repo);
                },
            )
            ->set(
                CreateOrganizationUseCaseInterface::class,
                static fn (ContainerInterface $c): CreateOrganizationUseCaseInterface => new CreateOrganizationUseCase(
                    self::repo($c),
                    self::tx($c),
                    self::organizationsFactory(self::clock($c)),
                    self::audit($c),
                ),
            )
            ->set(
                DeleteOrganizationUseCaseInterface::class,
                static fn (ContainerInterface $c): DeleteOrganizationUseCaseInterface => new DeleteOrganizationUseCase(
                    self::repo($c),
                    self::tx($c),
                    self::organizationsFactory(self::clock($c)),
                    self::audit($c),
                ),
            )
            ->set(
                ListOrganizationsHandler::class,
                static function (ContainerInterface $c): ListOrganizationsHandler {
                    $uc   = $c->get(ListOrganizationsUseCaseInterface::class);
                    $json = $c->get(JsonResponseFactory::class);

                    if (!$uc instanceof ListOrganizationsUseCaseInterface) {
                        throw new LogicException('ListOrganizations use case service is invalid.');
                    }

                    if (!$json instanceof JsonResponseFactory) {
                        throw new LogicException('JSON response factory service is invalid.');
                    }

                    return new ListOrganizationsHandler($uc, $json);
                },
            )
            ->set(
                GetOrganizationByIdHandler::class,
                static function (ContainerInterface $c): GetOrganizationByIdHandler {
                    $uc   = $c->get(GetOrganizationByIdUseCaseInterface::class);
                    $json = $c->get(JsonResponseFactory::class);

                    if (!$uc instanceof GetOrganizationByIdUseCaseInterface) {
                        throw new LogicException('GetOrganizationById use case service is invalid.');
                    }

                    if (!$json instanceof JsonResponseFactory) {
                        throw new LogicException('JSON response factory service is invalid.');
                    }

                    return new GetOrganizationByIdHandler($uc, $json);
                },
            )
            ->set(
                CreateOrganizationHandler::class,
                static function (ContainerInterface $c): CreateOrganizationHandler {
                    $uc   = $c->get(CreateOrganizationUseCaseInterface::class);
                    $json = $c->get(JsonResponseFactory::class);

                    if (!$uc instanceof CreateOrganizationUseCaseInterface) {
                        throw new LogicException('CreateOrganization use case service is invalid.');
                    }

                    if (!$json instanceof JsonResponseFactory) {
                        throw new LogicException('JSON response factory service is invalid.');
                    }

                    return new CreateOrganizationHandler($uc, $json);
                },
            )
            ->set(
                UpdateOrganizationUseCaseInterface::class,
                static fn (ContainerInterface $c): UpdateOrganizationUseCaseInterface => new UpdateOrganizationUseCase(
                    self::repo($c),
                    self::tx($c),
                    self::organizationsFactory(self::clock($c)),
                    self::audit($c),
                ),
            )
            ->set(
                UpdateOrganizationHandler::class,
                static function (ContainerInterface $c): UpdateOrganizationHandler {
                    $uc   = $c->get(UpdateOrganizationUseCaseInterface::class);
                    $json = $c->get(JsonResponseFactory::class);

                    if (!$uc instanceof UpdateOrganizationUseCaseInterface) {
                        throw new LogicException('UpdateOrganization use case service is invalid.');
                    }

                    if (!$json instanceof JsonResponseFactory) {
                        throw new LogicException('JSON response factory service is invalid.');
                    }

                    return new UpdateOrganizationHandler($uc, $json);
                },
            )
            ->set(
                DeleteOrganizationHandler::class,
                static function (ContainerInterface $c): DeleteOrganizationHandler {
                    $uc              = $c->get(DeleteOrganizationUseCaseInterface::class);
                    $responseFactory = $c->get(ResponseFactoryInterface::class);

                    if (!$uc instanceof DeleteOrganizationUseCaseInterface) {
                        throw new LogicException('DeleteOrganization use case service is invalid.');
                    }

                    if (!$responseFactory instanceof ResponseFactoryInterface) {
                        throw new LogicException('Response factory service is invalid.');
                    }

                    return new DeleteOrganizationHandler($uc, $responseFactory);
                },
            )
            ->set(
                OrganizationNotFoundExceptionHandler::class,
                static function (ContainerInterface $c): OrganizationNotFoundExceptionHandler {
                    $pd = $c->get(ProblemDetailsResponseFactory::class);

                    if (!$pd instanceof ProblemDetailsResponseFactory) {
                        throw new LogicException('Problem details response factory service is invalid.');
                    }

                    return new OrganizationNotFoundExceptionHandler($pd);
                },
            )
            ->set(
                OrganizationNotResolvedExceptionHandler::class,
                static function (ContainerInterface $c): OrganizationNotResolvedExceptionHandler {
                    $pd = $c->get(ProblemDetailsResponseFactory::class);

                    if (!$pd instanceof ProblemDetailsResponseFactory) {
                        throw new LogicException('Problem details response factory service is invalid.');
                    }

                    return new OrganizationNotResolvedExceptionHandler($pd);
                },
            )
            ->set(
                OrganizationSlugConflictExceptionHandler::class,
                static function (ContainerInterface $c): OrganizationSlugConflictExceptionHandler {
                    $pd = $c->get(ProblemDetailsResponseFactory::class);

                    if (!$pd instanceof ProblemDetailsResponseFactory) {
                        throw new LogicException('Problem details response factory service is invalid.');
                    }

                    return new OrganizationSlugConflictExceptionHandler($pd);
                },
            )
            ->set(
                OrganizationRouteRegistrar::class,
                static function (ContainerInterface $c): OrganizationRouteRegistrar {
                    $list   = $c->get(ListOrganizationsHandler::class);
                    $get    = $c->get(GetOrganizationByIdHandler::class);
                    $create = $c->get(CreateOrganizationHandler::class);
                    $update = $c->get(UpdateOrganizationHandler::class);
                    $delete = $c->get(DeleteOrganizationHandler::class);

                    if (!$list instanceof ListOrganizationsHandler) {
                        throw new LogicException('ListOrganizations handler service is invalid.');
                    }

                    if (!$get instanceof GetOrganizationByIdHandler) {
                        throw new LogicException('GetOrganizationById handler service is invalid.');
                    }

                    if (!$create instanceof CreateOrganizationHandler) {
                        throw new LogicException('CreateOrganization handler service is invalid.');
                    }

                    if (!$update instanceof UpdateOrganizationHandler) {
                        throw new LogicException('UpdateOrganization handler service is invalid.');
                    }

                    if (!$delete instanceof DeleteOrganizationHandler) {
                        throw new LogicException('DeleteOrganization handler service is invalid.');
                    }

                    return new OrganizationRouteRegistrar($list, $get, $create, $update, $delete);
                },
            );
    }

    private static function repo(ContainerInterface $c): OrganizationRepositoryInterface
    {
        $repo = $c->get(OrganizationRepositoryInterface::class);

        if (!$repo instanceof OrganizationRepositoryInterface) {
            throw new LogicException('Organization repository service is invalid.');
        }

        return $repo;
    }

    private static function tx(ContainerInterface $c): DatabaseTransactionManagerInterface
    {
        $tx = $c->get(DatabaseTransactionManagerInterface::class);

        if (!$tx instanceof DatabaseTransactionManagerInterface) {
            throw new LogicException('Database transaction manager service is invalid.');
        }

        return $tx;
    }

    private static function audit(ContainerInterface $c): AuditRecorderFactoryInterface
    {
        $audit = $c->get(AuditRecorderFactoryInterface::class);

        if (!$audit instanceof AuditRecorderFactoryInterface) {
            throw new LogicException('Audit recorder factory service is invalid.');
        }

        return $audit;
    }

    private static function clock(ContainerInterface $c): ClockInterface
    {
        $clock = $c->get(ClockInterface::class);

        if (!$clock instanceof ClockInterface) {
            throw new LogicException('Clock service is invalid.');
        }

        return $clock;
    }

    /**
     * @return Closure(DatabaseQueryExecutorInterface): OrganizationRepositoryInterface
     */
    private static function organizationsFactory(ClockInterface $clock): Closure
    {
        return static fn (DatabaseQueryExecutorInterface $exec): OrganizationRepositoryInterface
            => new PdoOrganizationRepository($exec, $clock);
    }
}
