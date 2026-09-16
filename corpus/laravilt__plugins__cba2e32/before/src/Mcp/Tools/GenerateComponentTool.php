<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class GenerateComponentTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = 'Generate a Laravel component within a plugin. Supports: migration, model, controller, command, job, event, listener, notification, seeder, factory, test, lang, route';

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $plugin = $request->string('plugin');
        $type = $request->string('type');
        $name = $request->string('name');

        $validTypes = ['migration', 'model', 'controller', 'command', 'job', 'event', 'listener', 'notification', 'seeder', 'factory', 'test', 'lang', 'route'];

        if (! in_array($type, $validTypes)) {
            return Response::text('❌ Invalid component type. Valid types: '.implode(', ', $validTypes));
        }

        $command = 'php '.base_path('artisan')." laravilt:make {$plugin} {$type} {$name}";

        exec($command, $output, $returnCode);

        if ($returnCode === 0) {
            return Response::text("✅ Component created successfully!\n\n".implode("\n", $output));
        } else {
            return Response::text('❌ Failed to create component: '.implode("\n", $output));
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
            'plugin' => $schema->string()
                ->description('Plugin name (kebab-case)')
                ->required(),
            'type' => $schema->string()
                ->description('Component type (migration, model, controller, command, job, event, listener, notification, seeder, factory, test, lang, route)')
                ->enum(['migration', 'model', 'controller', 'command', 'job', 'event', 'listener', 'notification', 'seeder', 'factory', 'test', 'lang', 'route'])
                ->required(),
            'name' => $schema->string()
                ->description('Component name (e.g., "Post", "CreatePostsTable", "PostController")')
                ->required(),
        ];
    }
}
