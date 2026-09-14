<?php

declare(strict_types=1);

namespace NeneProfile\Preset;

use Closure;
use LogicException;
use Nene2\Audit\AuditRecorderFactoryInterface;
use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Database\DatabaseTransactionManagerInterface;
use Nene2\DependencyInjection\ContainerBuilder;
use Nene2\DependencyInjection\ServiceProviderInterface;
use Nene2\Error\ProblemDetailsResponseFactory;
use Nene2\Http\JsonResponseFactory;
use Psr\Container\ContainerInterface;
use Psr\Http\Message\ResponseFactoryInterface;

final readonly class MappingPresetServiceProvider implements ServiceProviderInterface
{
    public function register(ContainerBuilder $builder): void
    {
        $builder
            ->set(
                MappingPresetRepositoryInterface::class,
                static function (ContainerInterface $c): MappingPresetRepositoryInterface {
                    $query = $c->get(DatabaseQueryExecutorInterface::class);

                    if (!$query instanceof DatabaseQueryExecutorInterface) {
                        throw new LogicException('Database query executor service is invalid.');
                    }

                    return new PdoMappingPresetRepository($query);
                },
            )
            ->set(
                MappingPresetVersionRepositoryInterface::class,
                static function (ContainerInterface $c): MappingPresetVersionRepositoryInterface {
                    $query = $c->get(DatabaseQueryExecutorInterface::class);

                    if (!$query instanceof DatabaseQueryExecutorInterface) {
                        throw new LogicException('Database query executor service is invalid.');
                    }

                    return new PdoMappingPresetVersionRepository($query);
                },
            )
            ->set(
                ListMappingPresetsUseCaseInterface::class,
                static fn (ContainerInterface $c): ListMappingPresetsUseCaseInterface => new ListMappingPresetsUseCase(
                    self::presetRepo($c),
                ),
            )
            ->set(
                GetMappingPresetByIdUseCaseInterface::class,
                static fn (ContainerInterface $c): GetMappingPresetByIdUseCaseInterface => new GetMappingPresetByIdUseCase(
                    self::presetRepo($c),
                    self::versionRepo($c),
                ),
            )
            ->set(
                CreateMappingPresetUseCaseInterface::class,
                static fn (ContainerInterface $c): CreateMappingPresetUseCaseInterface => new CreateMappingPresetUseCase(
                    self::tx($c),
                    self::presetsFactory(),
                    self::versionsFactory(),
                    self::audit($c),
                ),
            )
            ->set(
                UpdateMappingPresetUseCaseInterface::class,
                static fn (ContainerInterface $c): UpdateMappingPresetUseCaseInterface => new UpdateMappingPresetUseCase(
                    self::presetRepo($c),
                    self::versionRepo($c),
                    self::tx($c),
                    self::presetsFactory(),
                    self::versionsFactory(),
                    self::audit($c),
                ),
            )
            ->set(
                DeleteMappingPresetUseCaseInterface::class,
                static fn (ContainerInterface $c): DeleteMappingPresetUseCaseInterface => new DeleteMappingPresetUseCase(
                    self::presetRepo($c),
                    self::tx($c),
                    self::presetsFactory(),
                    self::audit($c),
                ),
            )
            ->set(
                ListMappingPresetsHandler::class,
                static fn (ContainerInterface $c): ListMappingPresetsHandler => new ListMappingPresetsHandler(
                    self::get($c, ListMappingPresetsUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                GetMappingPresetByIdHandler::class,
                static fn (ContainerInterface $c): GetMappingPresetByIdHandler => new GetMappingPresetByIdHandler(
                    self::get($c, GetMappingPresetByIdUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                CreateMappingPresetHandler::class,
                static fn (ContainerInterface $c): CreateMappingPresetHandler => new CreateMappingPresetHandler(
                    self::get($c, CreateMappingPresetUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                UpdateMappingPresetHandler::class,
                static fn (ContainerInterface $c): UpdateMappingPresetHandler => new UpdateMappingPresetHandler(
                    self::get($c, UpdateMappingPresetUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                DeleteMappingPresetHandler::class,
                static fn (ContainerInterface $c): DeleteMappingPresetHandler => new DeleteMappingPresetHandler(
                    self::get($c, DeleteMappingPresetUseCaseInterface::class),
                    self::get($c, ResponseFactoryInterface::class),
                ),
            )
            ->set(
                MappingPresetNotFoundExceptionHandler::class,
                static fn (ContainerInterface $c): MappingPresetNotFoundExceptionHandler => new MappingPresetNotFoundExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                InvalidMappingDefinitionExceptionHandler::class,
                static fn (ContainerInterface $c): InvalidMappingDefinitionExceptionHandler => new InvalidMappingDefinitionExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                MappingPresetRouteRegistrar::class,
                static fn (ContainerInterface $c): MappingPresetRouteRegistrar => new MappingPresetRouteRegistrar(
                    self::get($c, ListMappingPresetsHandler::class),
                    self::get($c, GetMappingPresetByIdHandler::class),
                    self::get($c, CreateMappingPresetHandler::class),
                    self::get($c, UpdateMappingPresetHandler::class),
                    self::get($c, DeleteMappingPresetHandler::class),
                ),
            );
    }

    private static function presetRepo(ContainerInterface $c): MappingPresetRepositoryInterface
    {
        return self::get($c, MappingPresetRepositoryInterface::class);
    }

    private static function versionRepo(ContainerInterface $c): MappingPresetVersionRepositoryInterface
    {
        return self::get($c, MappingPresetVersionRepositoryInterface::class);
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
     * @return Closure(DatabaseQueryExecutorInterface): MappingPresetRepositoryInterface
     */
    private static function presetsFactory(): Closure
    {
        return static fn (DatabaseQueryExecutorInterface $exec): MappingPresetRepositoryInterface
            => new PdoMappingPresetRepository($exec);
    }

    /**
     * @return Closure(DatabaseQueryExecutorInterface): MappingPresetVersionRepositoryInterface
     */
    private static function versionsFactory(): Closure
    {
        return static fn (DatabaseQueryExecutorInterface $exec): MappingPresetVersionRepositoryInterface
            => new PdoMappingPresetVersionRepository($exec);
    }

    private static function json(ContainerInterface $c): JsonResponseFactory
    {
        return self::get($c, JsonResponseFactory::class);
    }

    private static function problemDetails(ContainerInterface $c): ProblemDetailsResponseFactory
    {
        return self::get($c, ProblemDetailsResponseFactory::class);
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
