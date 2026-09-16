<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Str;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class GeneratePluginTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = <<<'MARKDOWN'
        Generate a new Laravilt plugin with specified features. Creates complete plugin structure with service provider, config, and optional features like migrations, views, assets, GitHub workflows, etc.
    MARKDOWN;

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $name = $request->string('name');
        $description = $request->string('description', '');
        $migrations = $request->boolean('migrations', false);
        $views = $request->boolean('views', false);
        $webRoutes = $request->boolean('webRoutes', false);
        $apiRoutes = $request->boolean('apiRoutes', false);
        $css = $request->boolean('css', false);
        $js = $request->boolean('js', false);
        $arts = $request->boolean('arts', true);
        $github = $request->boolean('github', true);
        $phpstan = $request->boolean('phpstan', true);

        $command = 'php '.base_path('artisan').' laravilt:plugin "'.$name.'" --no-interaction';

        exec($command, $output, $returnCode);

        if ($returnCode === 0) {
            $kebabName = Str::kebab($name);
            $pluginPath = base_path("packages/laravilt/{$kebabName}");

            $response = "✅ Plugin '{$name}' created successfully!\n\n";
            $response .= "📖 Location: {$pluginPath}\n\n";
            $response .= "📦 Next steps:\n";
            $response .= "1. Require the plugin in your composer.json\n";
            $response .= "2. Run: composer install\n";
            $response .= "3. Run: php artisan {$kebabName}:install\n";
            $response .= "4. Register the plugin in your Filament panel provider\n";

            return Response::text($response);
        } else {
            return Response::text('❌ Failed to create plugin: '.implode("\n", $output));
        }
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, JsonSchema>
     */
    public function schema(JsonSchema $schema): array
    {
        return [
            'name' => $schema->string()
                ->description('Plugin name in StudlyCase (e.g., "BlogExtensions")')
                ->required(),
            'description' => $schema->string()
                ->description('Plugin description'),
            'migrations' => $schema->boolean()
                ->description('Include database migrations')
                ->default(false),
            'views' => $schema->boolean()
                ->description('Include Blade views')
                ->default(false),
            'webRoutes' => $schema->boolean()
                ->description('Include web routes')
                ->default(false),
            'apiRoutes' => $schema->boolean()
                ->description('Include API routes')
                ->default(false),
            'css' => $schema->boolean()
                ->description('Include CSS assets (Tailwind v4)')
                ->default(false),
            'js' => $schema->boolean()
                ->description('Include JavaScript assets (Vue.js)')
                ->default(false),
            'arts' => $schema->boolean()
                ->description('Include arts folder with cover photo')
                ->default(true),
            'github' => $schema->boolean()
                ->description('Include GitHub workflows and templates')
                ->default(true),
            'phpstan' => $schema->boolean()
                ->description('Include PHPStan configuration')
                ->default(true),
        ];
    }
}
