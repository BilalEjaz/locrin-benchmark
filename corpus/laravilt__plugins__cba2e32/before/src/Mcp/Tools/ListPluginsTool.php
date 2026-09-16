<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\File;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class ListPluginsTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = 'List all installed Laravilt plugins in the packages directory';

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $pluginsPath = base_path('packages/laravilt');

        if (! File::isDirectory($pluginsPath)) {
            return Response::text('No plugins directory found.');
        }

        $plugins = [];
        $directories = File::directories($pluginsPath);

        foreach ($directories as $dir) {
            $composerJsonPath = $dir.'/composer.json';
            if (File::exists($composerJsonPath)) {
                $composerData = json_decode(File::get($composerJsonPath), true);
                $plugins[] = [
                    'name' => basename($dir),
                    'package' => $composerData['name'] ?? 'N/A',
                    'description' => $composerData['description'] ?? 'N/A',
                    'version' => $composerData['version'] ?? 'N/A',
                    'path' => $dir,
                ];
            }
        }

        if (empty($plugins)) {
            return Response::text('No plugins found in packages/laravilt directory.');
        }

        $output = 'Found '.count($plugins)." plugin(s):\n\n";
        foreach ($plugins as $plugin) {
            $output .= "📦 {$plugin['name']}\n";
            $output .= "   Package: {$plugin['package']}\n";
            $output .= "   Version: {$plugin['version']}\n";
            $output .= "   Description: {$plugin['description']}\n";
            $output .= "   Path: {$plugin['path']}\n\n";
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
