<?php

declare(strict_types=1);

namespace NeneProfile\Http;

use LogicException;
use Nene2\Auth\GuardedJwtSecretResolver;
use Nene2\Auth\LocalBearerTokenVerifier;
use Nene2\Auth\TokenIssuerInterface;
use Nene2\Auth\TokenVerifierInterface;
use Nene2\Config\AppConfig;
use Nene2\Config\ConfigLoader;
use Nene2\Database\DatabaseConnectionFactoryInterface;
use Nene2\Database\DatabaseQueryExecutorInterface;
use Nene2\Database\DatabaseTransactionManagerInterface;
use Nene2\Database\PdoConnectionFactory;
use Nene2\Database\PdoDatabaseQueryExecutor;
use Nene2\Database\PdoDatabaseTransactionManager;
use Nene2\DependencyInjection\ContainerBuilder;
use Nene2\DependencyInjection\ServiceProviderInterface;
use Nene2\Error\DomainExceptionHandlerInterface;
use Nene2\Error\ProblemDetailsResponseFactory;
use Nene2\Http\ClockInterface;
use Nene2\Http\JsonResponseFactory;
use Nene2\Http\RequestScopedHolder;
use Nene2\Http\ResponseEmitter;
use Nene2\Http\RuntimeApplicationFactory;
use Nene2\Http\UtcClock;
use Nene2\Log\MonologLoggerFactory;
use Nene2\Log\RequestIdHolder;
use Nene2\Middleware\InMemoryRateLimitStorage;
use Nene2\Middleware\RateLimitStorageInterface;
use Nene2\Middleware\ThrottleMiddleware;
use NeneProfile\ApplicationServiceProvider;
use NeneProfile\Auth\AdminApiAuthMiddleware;
use NeneProfile\Auth\CapabilityMiddleware;
use NeneProfile\Health\DatabaseHealthCheck;
use NeneProfile\Organization\OrganizationRepositoryInterface;
use NeneProfile\Organization\Resolution\EnvResolutionStrategy;
use NeneProfile\Organization\Resolution\OrgResolverMiddleware;
use NeneProfile\Organization\Resolution\PathPrefixResolutionStrategy;
use NeneProfile\Organization\Resolution\SubdomainResolutionStrategy;
use NeneProfile\Support\Env;
use Nyholm\Psr7\Factory\Psr17Factory;
use Psr\Container\ContainerInterface;
use Psr\Http\Message\ResponseFactoryInterface;
use Psr\Http\Message\StreamFactoryInterface;
use Psr\Http\Server\RequestHandlerInterface;
use Psr\Log\LoggerInterface;

final readonly class RuntimeServiceProvider implements ServiceProviderInterface
{
    public const PROJECT_ROOT = 'nene-profile.project_root';

    /**
     * Development-only fallback secret, injected into
     * {@see GuardedJwtSecretResolver} as the product's development secret. It is
     * used **only** off-production, and only when the operator opts in via
     * `NENE2_ALLOW_DEV_SECRET=1` and `NENE2_LOCAL_JWT_SECRET` is unset. This
     * constant is public in the OSS repository, so signing real tokens with it
     * would be a full auth bypass — production always fails closed instead.
     */
    private const DEFAULT_DEV_SECRET = 'nene-profile-dev-secret';

    public function register(ContainerBuilder $builder): void
    {
        $builder->addProvider(new ApplicationServiceProvider());

        $builder
            ->set(
                ConfigLoader::class,
                static function (ContainerInterface $c): ConfigLoader {
                    $projectRoot = $c->get(self::PROJECT_ROOT);

                    if (!is_string($projectRoot) || $projectRoot === '') {
                        throw new LogicException('Project root service is invalid.');
                    }

                    return new ConfigLoader($projectRoot);
                },
            )
            ->set(
                AppConfig::class,
                static function (ContainerInterface $c): AppConfig {
                    $loader = $c->get(ConfigLoader::class);

                    if (!$loader instanceof ConfigLoader) {
                        throw new LogicException('Config loader service is invalid.');
                    }

                    return $loader->load();
                },
            )
            ->set(
                DatabaseConnectionFactoryInterface::class,
                static function (ContainerInterface $c): DatabaseConnectionFactoryInterface {
                    $config = $c->get(AppConfig::class);

                    if (!$config instanceof AppConfig) {
                        throw new LogicException('Application config service is invalid.');
                    }

                    return new PdoConnectionFactory($config->database);
                },
            )
            ->set(
                DatabaseQueryExecutorInterface::class,
                static function (ContainerInterface $c): DatabaseQueryExecutorInterface {
                    $factory = $c->get(DatabaseConnectionFactoryInterface::class);

                    if (!$factory instanceof DatabaseConnectionFactoryInterface) {
                        throw new LogicException('Database connection factory service is invalid.');
                    }

                    return new PdoDatabaseQueryExecutor($factory);
                },
            )
            ->set(
                DatabaseTransactionManagerInterface::class,
                static function (ContainerInterface $c): DatabaseTransactionManagerInterface {
                    $factory = $c->get(DatabaseConnectionFactoryInterface::class);

                    if (!$factory instanceof DatabaseConnectionFactoryInterface) {
                        throw new LogicException('Database connection factory service is invalid.');
                    }

                    return new PdoDatabaseTransactionManager($factory);
                },
            )
            ->set(ClockInterface::class, static fn (ContainerInterface $c): ClockInterface => new UtcClock())
            ->set(Psr17Factory::class, static fn (): Psr17Factory => new Psr17Factory())
            ->set(
                ResponseFactoryInterface::class,
                static function (ContainerInterface $c): ResponseFactoryInterface {
                    $f = $c->get(Psr17Factory::class);

                    if (!$f instanceof ResponseFactoryInterface) {
                        throw new LogicException('PSR-17 response factory service is invalid.');
                    }

                    return $f;
                },
            )
            ->set(
                StreamFactoryInterface::class,
                static function (ContainerInterface $c): StreamFactoryInterface {
                    $f = $c->get(Psr17Factory::class);

                    if (!$f instanceof StreamFactoryInterface) {
                        throw new LogicException('PSR-17 stream factory service is invalid.');
                    }

                    return $f;
                },
            )
            ->set(
                JsonResponseFactory::class,
                static function (ContainerInterface $c): JsonResponseFactory {
                    $rf = $c->get(ResponseFactoryInterface::class);
                    $sf = $c->get(StreamFactoryInterface::class);

                    if (!$rf instanceof ResponseFactoryInterface) {
                        throw new LogicException('Response factory service is invalid.');
                    }

                    if (!$sf instanceof StreamFactoryInterface) {
                        throw new LogicException('Stream factory service is invalid.');
                    }

                    return new JsonResponseFactory($rf, $sf);
                },
            )
            ->set(
                ProblemDetailsResponseFactory::class,
                static function (ContainerInterface $c): ProblemDetailsResponseFactory {
                    $rf     = $c->get(ResponseFactoryInterface::class);
                    $sf     = $c->get(StreamFactoryInterface::class);
                    $config = $c->get(AppConfig::class);

                    if (!$rf instanceof ResponseFactoryInterface) {
                        throw new LogicException('Response factory service is invalid.');
                    }

                    if (!$sf instanceof StreamFactoryInterface) {
                        throw new LogicException('Stream factory service is invalid.');
                    }

                    if (!$config instanceof AppConfig) {
                        throw new LogicException('Application config service is invalid.');
                    }

                    return new ProblemDetailsResponseFactory($rf, $sf, $config->problemDetailsBaseUrl);
                },
            )
            ->set(RequestIdHolder::class, static fn (): RequestIdHolder => new RequestIdHolder())
            ->set(
                LocalBearerTokenVerifier::class,
                static function (ContainerInterface $c): LocalBearerTokenVerifier {
                    $config = $c->get(AppConfig::class);

                    if (!$config instanceof AppConfig) {
                        throw new LogicException('Application config service is invalid.');
                    }

                    return new LocalBearerTokenVerifier(
                        GuardedJwtSecretResolver::fromConfig($config, self::DEFAULT_DEV_SECRET),
                    );
                },
            )
            ->set(
                TokenVerifierInterface::class,
                static function (ContainerInterface $c): TokenVerifierInterface {
                    $v = $c->get(LocalBearerTokenVerifier::class);

                    if (!$v instanceof TokenVerifierInterface) {
                        throw new LogicException('LocalBearerTokenVerifier service is invalid.');
                    }

                    return $v;
                },
            )
            ->set(
                TokenIssuerInterface::class,
                static function (ContainerInterface $c): TokenIssuerInterface {
                    $v = $c->get(LocalBearerTokenVerifier::class);

                    if (!$v instanceof TokenIssuerInterface) {
                        throw new LogicException('LocalBearerTokenVerifier service is invalid.');
                    }

                    return $v;
                },
            )
            ->set(
                'nene-profile.token_issuer',
                static fn (ContainerInterface $c): TokenIssuerInterface => $c->get(TokenIssuerInterface::class),
            )
            ->set(
                LoggerInterface::class,
                static function (ContainerInterface $c): LoggerInterface {
                    $config = $c->get(AppConfig::class);
                    $debug  = $config instanceof AppConfig && $config->debug;
                    $holder = $c->get(RequestIdHolder::class);

                    return (new MonologLoggerFactory())->create(
                        'nene-profile',
                        $debug,
                        $holder instanceof RequestIdHolder ? $holder : null,
                    );
                },
            )
            ->set(
                DatabaseHealthCheck::class,
                static function (ContainerInterface $c): DatabaseHealthCheck {
                    $factory = $c->get(DatabaseConnectionFactoryInterface::class);

                    if (!$factory instanceof DatabaseConnectionFactoryInterface) {
                        throw new LogicException('Database connection factory service is invalid.');
                    }

                    return new DatabaseHealthCheck($factory);
                },
            )
            ->set(
                RateLimitStorageInterface::class,
                static fn (ContainerInterface $c): RateLimitStorageInterface => new InMemoryRateLimitStorage(),
            )
            ->set(
                ThrottleMiddleware::class,
                static function (ContainerInterface $c): ThrottleMiddleware {
                    $problemDetails = $c->get(ProblemDetailsResponseFactory::class);
                    $storage        = $c->get(RateLimitStorageInterface::class);

                    if (!$problemDetails instanceof ProblemDetailsResponseFactory) {
                        throw new LogicException('ProblemDetailsResponseFactory service is invalid.');
                    }

                    if (!$storage instanceof RateLimitStorageInterface) {
                        throw new LogicException('Rate limit storage service is invalid.');
                    }

                    // 120 requests per minute per IP for the authenticated admin API.
                    // The bundled in-memory storage does not share state across PHP-FPM
                    // workers; production must inject a shared (Redis/DB) storage via
                    // RateLimitStorageInterface so the limit is enforced fleet-wide.
                    return new ThrottleMiddleware(
                        $problemDetails,
                        $storage,
                        limit: 120,
                        windowSeconds: 60,
                    );
                },
            )
            ->set(
                RuntimeApplicationFactory::class,
                static function (ContainerInterface $c): RuntimeApplicationFactory {
                    $rf               = $c->get(ResponseFactoryInterface::class);
                    $sf               = $c->get(StreamFactoryInterface::class);
                    $logger           = $c->get(LoggerInterface::class);
                    $config           = $c->get(AppConfig::class);
                    $exceptionHandlers = $c->get(ApplicationServiceProvider::EXCEPTION_HANDLERS);
                    $routeRegistrars  = $c->get(ApplicationServiceProvider::ROUTE_REGISTRARS);
                    $requestIdHolder  = $c->get(RequestIdHolder::class);
                    $problemDetails   = $c->get(ProblemDetailsResponseFactory::class);
                    $tokenVerifier    = $c->get(TokenVerifierInterface::class);
                    $orgRepo          = $c->get(OrganizationRepositoryInterface::class);
                    $orgIdHolder      = $c->get(ApplicationServiceProvider::ORG_ID_HOLDER);
                    $dbHealthCheck    = $c->get(DatabaseHealthCheck::class);
                    $throttle         = $c->get(ThrottleMiddleware::class);

                    if (!$rf instanceof ResponseFactoryInterface) {
                        throw new LogicException('Response factory service is invalid.');
                    }

                    if (!$sf instanceof StreamFactoryInterface) {
                        throw new LogicException('Stream factory service is invalid.');
                    }

                    if (!$logger instanceof LoggerInterface) {
                        throw new LogicException('Logger service is invalid.');
                    }

                    if (!$config instanceof AppConfig) {
                        throw new LogicException('Application config service is invalid.');
                    }

                    if (!is_array($exceptionHandlers) || !array_is_list($exceptionHandlers)) {
                        throw new LogicException('Exception handlers service is invalid.');
                    }

                    if (!is_array($routeRegistrars) || !array_is_list($routeRegistrars)) {
                        throw new LogicException('Route registrars service is invalid.');
                    }

                    if (!$requestIdHolder instanceof RequestIdHolder) {
                        throw new LogicException('RequestIdHolder service is invalid.');
                    }

                    if (!$problemDetails instanceof ProblemDetailsResponseFactory) {
                        throw new LogicException('ProblemDetailsResponseFactory service is invalid.');
                    }

                    if (!$tokenVerifier instanceof TokenVerifierInterface) {
                        throw new LogicException('TokenVerifierInterface service is invalid.');
                    }

                    if (!$orgRepo instanceof OrganizationRepositoryInterface) {
                        throw new LogicException('OrganizationRepositoryInterface service is invalid.');
                    }

                    if (!$orgIdHolder instanceof RequestScopedHolder) {
                        throw new LogicException('Org ID holder service is invalid.');
                    }

                    if (!$dbHealthCheck instanceof DatabaseHealthCheck) {
                        throw new LogicException('DatabaseHealthCheck service is invalid.');
                    }

                    if (!$throttle instanceof ThrottleMiddleware) {
                        throw new LogicException('ThrottleMiddleware service is invalid.');
                    }

                    /** @var RequestScopedHolder<int> $orgIdHolder */
                    /** @var list<DomainExceptionHandlerInterface> $exceptionHandlers */
                    /** @var list<callable(\Nene2\Routing\Router): void> $routeRegistrars */

                    $resolutionMode = Env::get('TENANT_RESOLUTION', 'single') ?: 'single';
                    $orgSlug        = Env::get('ORG_SLUG');
                    $baseDomain     = Env::get('BASE_DOMAIN', 'localhost') ?: 'localhost';

                    $strategy = match ($resolutionMode) {
                        'subdomain' => new SubdomainResolutionStrategy($baseDomain),
                        'path'      => new PathPrefixResolutionStrategy(),
                        default     => new EnvResolutionStrategy($orgSlug),
                    };

                    $authMiddleware = [
                        new OrgResolverMiddleware($orgIdHolder, $orgRepo, $problemDetails, $strategy),
                        new AdminApiAuthMiddleware($problemDetails, $tokenVerifier),
                        new CapabilityMiddleware($problemDetails),
                    ];

                    return new RuntimeApplicationFactory(
                        responseFactory:       $rf,
                        streamFactory:         $sf,
                        logger:                $logger,
                        machineApiKey:         $config->machineApiKey,
                        domainExceptionHandlers: $exceptionHandlers,
                        requestIdHolder:       $requestIdHolder,
                        routeRegistrars:       $routeRegistrars,
                        authMiddleware:        $authMiddleware,
                        healthChecks:          [$dbHealthCheck],
                        throttleMiddleware:    $throttle,
                        debug:                 $config->debug,
                        requestMaxBodyBytes:   10 * 1024 * 1024, // 10 MiB for CSV uploads
                        // Opt-in の X-Authorization フォールバック受け口（NENE2 #1558・ADR 0019）。
                        // 前段 proxy が標準 Authorization を剥がす共有ホスティング（HETEML 型 Tier A）で、
                        // nene2-js v1.1.0 が全リクエストに付与する `X-Authorization: Bearer` ミラーを
                        // Authorization 不在/空のときのみ採用する。標準ヘッダが届く環境ではバイト不変。
                        enableAuthorizationHeaderFallback: true,
                    );
                },
            )
            ->set(
                RequestHandlerInterface::class,
                static function (ContainerInterface $c): RequestHandlerInterface {
                    $factory = $c->get(RuntimeApplicationFactory::class);

                    if (!$factory instanceof RuntimeApplicationFactory) {
                        throw new LogicException('Runtime application factory service is invalid.');
                    }

                    return $factory->create();
                },
            )
            ->set(ResponseEmitter::class, static fn (): ResponseEmitter => new ResponseEmitter());
    }
}
