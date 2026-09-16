<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\File;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class PluginInfoTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = 'Get detailed information about a specific plugin including its structure, features, and configuration';

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $plugin = $request->string('plugin');
        $pluginPath = base_path("packages/laravilt/{$plugin}");

        if (! File::isDirectory($pluginPath)) {
            return Response::text("Plugin '{$plugin}' not found at {$pluginPath}");
        }

        $info = [];

        // Composer info
        $composerJsonPath = $pluginPath.'/composer.json';
        if (File::exists($composerJsonPath)) {
            $composerData = json_decode(File::get($composerJsonPath), true);
            $info['composer'] = $composerData;
        }

        // Directory structure
        $info['structure'] = $this->getDirectoryStructure($pluginPath);

        // Features
        $info['features'] = [
            'migrations' => File::isDirectory($pluginPath.'/database/migrations'),
            'models' => File::isDirectory($pluginPath.'/src/Models'),
            'controllers' => File::isDirectory($pluginPath.'/src/Http/Controllers'),
            'views' => File::isDirectory($pluginPath.'/resources/views'),
            'routes' => File::isDirectory($pluginPath.'/routes'),
            'css' => File::isDirectory($pluginPath.'/resources/css'),
            'js' => File::isDirectory($pluginPath.'/resources/js'),
            'tests' => File::isDirectory($pluginPath.'/tests'),
            'github' => File::isDirectory($pluginPath.'/.github'),
            'arts' => File::isDirectory($pluginPath.'/arts'),
        ];

        $output = "Plugin: {$plugin}\n\n";
        $output .= "📦 Package Information:\n";
        $output .= "   Name: {$info['composer']['name']}\n";
        $output .= "   Description: {$info['composer']['description']}\n";
        $output .= "   Version: {$info['composer']['version']}\n\n";

        $output .= "📁 Structure:\n";
        foreach ($info['structure'] as $item) {
            $output .= "   {$item}\n";
        }

        $output .= "\n✨ Features:\n";
        foreach ($info['features'] as $feature => $exists) {
            $status = $exists ? '✅' : '❌';
            $output .= "   {$status} ".ucfirst($feature)."\n";
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
        return [
            'plugin' => $schema->string()
                ->description('The plugin name (kebab-case, e.g., "blog-extensions")')
                ->required(),
        ];
    }

    protected function getDirectoryStructure(string $path): array
    {
        $structure = [];
        $directories = File::directories($path);

        foreach ($directories as $dir) {
            $structure[] = basename($dir);
        }

        return $structure;
    }
}
