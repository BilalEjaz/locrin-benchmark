<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class ListComponentTypesTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = 'List all available component types that can be generated within a plugin';

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $types = [
            'migration' => 'Database Migration - Creates a new database migration',
            'model' => 'Eloquent Model - Creates a new model class',
            'controller' => 'Controller - Creates a new controller',
            'command' => 'Artisan Command - Creates a new console command',
            'job' => 'Job - Creates a new queueable job',
            'event' => 'Event - Creates a new event class',
            'listener' => 'Event Listener - Creates a new event listener',
            'notification' => 'Notification - Creates a new notification',
            'seeder' => 'Database Seeder - Creates a new database seeder',
            'factory' => 'Model Factory - Creates a new model factory',
            'test' => 'Test - Creates a new feature test',
            'lang' => 'Language File - Creates a new language file',
            'route' => 'Route - Creates a new route file',
        ];

        $output = "Available Component Types:\n\n";
        foreach ($types as $type => $description) {
            $output .= "📝 {$type}\n   {$description}\n\n";
        }

        return Response::text($output);
    }

    /**
     * Get the tool's input schema.
     *
     * @return array<string, JsonSchema>
     */
    public function schema(JsonSchema $schema): array
    {
        return [];
    }
}
