<?php

namespace Laravilt\Plugins;

use Filament\Panel;
use Laravilt\Plugins\Concerns\HasAssets;
use Laravilt\Plugins\Concerns\HasCommands;
use Laravilt\Plugins\Concerns\HasComponents;
use Laravilt\Plugins\Concerns\HasMigrations;
use Laravilt\Plugins\Concerns\HasTranslations;
use Laravilt\Plugins\Concerns\HasViews;
use Laravilt\Plugins\Contracts\Plugin;
use Spatie\LaravelPackageTools\Package;
use Spatie\LaravelPackageTools\PackageServiceProvider;

abstract class BasePlugin extends PackageServiceProvider implements Plugin
{
    use HasAssets;
    use HasCommands;
    use HasComponents;
    use HasMigrations;
    use HasTranslations;
    use HasViews;

    /**
     * The plugin ID.
     */
    protected static string $id;

    /**
     * The plugin name.
     */
    protected static string $name;

    /**
     * The plugin version.
     */
    protected static string $version = '1.0.0';

    /**
     * The plugin description.
     */
    protected static string $description = '';

    /**
     * The plugin author.
     */
    protected static string $author = '';

    /**
     * Plugin dependencies.
     *
     * @var array<string>
     */
    protected static array $dependencies = [];

    /**
     * Whether the plugin is enabled.
     */
    protected bool $enabled = true;

    /**
     * Get the plugin ID.
     */
    public function getId(): string
    {
        return static::$id ?? static::$name;
    }

    /**
     * Get the plugin name.
     */
    public function getName(): string
    {
        return static::$name;
    }

    /**
     * Get the plugin version.
     */
    public function getVersion(): string
    {
        return static::$version;
    }

    /**
     * Get the plugin description.
     */
    public function getDescription(): string
    {
        return static::$description;
    }

    /**
     * Get the plugin author.
     */
    public function getAuthor(): string
    {
        return static::$author;
    }

    /**
     * Get plugin dependencies.
     */
    public function getDependencies(): array
    {
        return static::$dependencies;
    }

    /**
     * Check if dependencies are satisfied.
     */
    public function dependenciesSatisfied(): bool
    {
        $manager = app('laravilt.plugins');

        foreach ($this->getDependencies() as $dependency) {
            if (! $manager->has($dependency)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Check if the plugin is enabled.
     */
    public function isEnabled(): bool
    {
        return $this->enabled;
    }

    /**
     * Enable the plugin.
     */
    public function enable(): static
    {
        $this->enabled = true;

        return $this;
    }

    /**
     * Disable the plugin.
     */
    public function disable(): static
    {
        $this->enabled = false;

        return $this;
    }

    /**
     * Register the plugin with a panel.
     */
    abstract public function register(Panel $panel): void;

    /**
     * Boot the plugin for a panel.
     */
    public function boot(Panel $panel): void
    {
        // Can be overridden by plugin implementations
    }

    /**
     * Create a new instance of the plugin.
     */
    public static function make(): static
    {
        return app(static::class);
    }

    /**
     * Get the default instance of the plugin.
     */
    public static function get(): static
    {
        return filament(static::$id ?? static::$name);
    }

    /**
     * Configure the package.
     */
    abstract public function configurePackage(Package $package): void;
}
