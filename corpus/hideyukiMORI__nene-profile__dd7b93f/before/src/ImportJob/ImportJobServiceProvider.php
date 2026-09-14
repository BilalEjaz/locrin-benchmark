<?php

declare(strict_types=1);

namespace NeneProfile\ImportJob;

use Closure;
use LogicException;
use Nene2\Audit\AuditRecorderFactoryInterface;
use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Database\DatabaseTransactionManagerInterface;
use Nene2\DependencyInjection\ContainerBuilder;
use Nene2\DependencyInjection\ServiceProviderInterface;
use Nene2\Error\ProblemDetailsResponseFactory;
use Nene2\Http\JsonResponseFactory;
use NeneProfile\OrgSettings\OrganizationSettingsRepositoryInterface;
use NeneProfile\Preset\MappingPresetRepositoryInterface;
use NeneProfile\Preset\MappingPresetVersionRepositoryInterface;
use NeneProfile\Support\Env;
use NeneProfile\Transformer\TransformerRegistry;
use Psr\Container\ContainerInterface;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\StreamFactoryInterface;

final readonly class ImportJobServiceProvider implements ServiceProviderInterface
{
    public function register(ContainerBuilder $builder): void
    {
        $builder
            ->set(
                ImportJobRepositoryInterface::class,
                static function (ContainerInterface $c): ImportJobRepositoryInterface {
                    $query = $c->get(DatabaseQueryExecutorInterface::class);

                    if (!$query instanceof DatabaseQueryExecutorInterface) {
                        throw new LogicException('Database query executor service is invalid.');
                    }

                    return new PdoImportJobRepository($query);
                },
            )
            ->set(
                FileStorageInterface::class,
                static function (ContainerInterface $c): FileStorageInterface {
                    $base = Env::get('NENE_PROFILE_STORAGE_PATH');
                    if ($base === '') {
                        $base = dirname(__DIR__, 2) . '/storage/uploads';
                    }

                    return new LocalFileStorage($base);
                },
            )
            ->set(CsvParser::class, static fn (ContainerInterface $c): CsvParser => new CsvParser())
            ->set(
                NormalizationRunner::class,
                static fn (ContainerInterface $c): NormalizationRunner => new NormalizationRunner(new TransformerRegistry()),
            )
            ->set(
                CreateImportJobUseCaseInterface::class,
                static fn (ContainerInterface $c): CreateImportJobUseCaseInterface => new CreateImportJobUseCase(
                    self::get($c, ImportJobRepositoryInterface::class),
                    self::get($c, MappingPresetRepositoryInterface::class),
                    self::get($c, MappingPresetVersionRepositoryInterface::class),
                    self::get($c, FileStorageInterface::class),
                    self::get($c, CsvParser::class),
                    self::get($c, NormalizationRunner::class),
                    self::get($c, DatabaseTransactionManagerInterface::class),
                    self::jobsFactory(),
                    self::get($c, AuditRecorderFactoryInterface::class),
                    self::get($c, OrganizationSettingsRepositoryInterface::class),
                ),
            )
            ->set(
                ListImportJobsUseCaseInterface::class,
                static fn (ContainerInterface $c): ListImportJobsUseCaseInterface => new ListImportJobsUseCase(
                    self::get($c, ImportJobRepositoryInterface::class),
                ),
            )
            ->set(
                GetImportJobUseCaseInterface::class,
                static fn (ContainerInterface $c): GetImportJobUseCaseInterface => new GetImportJobUseCase(
                    self::get($c, ImportJobRepositoryInterface::class),
                ),
            )
            ->set(
                ListImportJobErrorsUseCaseInterface::class,
                static fn (ContainerInterface $c): ListImportJobErrorsUseCaseInterface => new ListImportJobErrorsUseCase(
                    self::get($c, ImportJobRepositoryInterface::class),
                ),
            )
            ->set(
                ExportImportJobUseCaseInterface::class,
                static fn (ContainerInterface $c): ExportImportJobUseCaseInterface => new ExportImportJobUseCase(
                    self::get($c, ImportJobRepositoryInterface::class),
                ),
            )
            ->set(
                CreateImportJobHandler::class,
                static fn (ContainerInterface $c): CreateImportJobHandler => new CreateImportJobHandler(
                    self::get($c, CreateImportJobUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                ListImportJobsHandler::class,
                static fn (ContainerInterface $c): ListImportJobsHandler => new ListImportJobsHandler(
                    self::get($c, ListImportJobsUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                GetImportJobHandler::class,
                static fn (ContainerInterface $c): GetImportJobHandler => new GetImportJobHandler(
                    self::get($c, GetImportJobUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                ListImportJobErrorsHandler::class,
                static fn (ContainerInterface $c): ListImportJobErrorsHandler => new ListImportJobErrorsHandler(
                    self::get($c, ListImportJobErrorsUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                ExportImportJobJsonHandler::class,
                static fn (ContainerInterface $c): ExportImportJobJsonHandler => new ExportImportJobJsonHandler(
                    self::get($c, ExportImportJobUseCaseInterface::class),
                    self::json($c),
                ),
            )
            ->set(
                ExportImportJobCsvHandler::class,
                static fn (ContainerInterface $c): ExportImportJobCsvHandler => new ExportImportJobCsvHandler(
                    self::get($c, ExportImportJobUseCaseInterface::class),
                    self::get($c, ResponseFactoryInterface::class),
                    self::get($c, StreamFactoryInterface::class),
                ),
            )
            ->set(
                ImportJobNotFoundExceptionHandler::class,
                static fn (ContainerInterface $c): ImportJobNotFoundExceptionHandler => new ImportJobNotFoundExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                ImportFileTooLargeExceptionHandler::class,
                static fn (ContainerInterface $c): ImportFileTooLargeExceptionHandler => new ImportFileTooLargeExceptionHandler(
                    self::problemDetails($c),
                ),
            )
            ->set(
                ImportJobRouteRegistrar::class,
                static fn (ContainerInterface $c): ImportJobRouteRegistrar => new ImportJobRouteRegistrar(
                    self::get($c, ListImportJobsHandler::class),
                    self::get($c, GetImportJobHandler::class),
                    self::get($c, CreateImportJobHandler::class),
                    self::get($c, ListImportJobErrorsHandler::class),
                    self::get($c, ExportImportJobJsonHandler::class),
                    self::get($c, ExportImportJobCsvHandler::class),
                ),
            );
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
     * @return Closure(DatabaseQueryExecutorInterface): ImportJobRepositoryInterface
     */
    private static function jobsFactory(): Closure
    {
        return static fn (DatabaseQueryExecutorInterface $exec): ImportJobRepositoryInterface
            => new PdoImportJobRepository($exec);
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
