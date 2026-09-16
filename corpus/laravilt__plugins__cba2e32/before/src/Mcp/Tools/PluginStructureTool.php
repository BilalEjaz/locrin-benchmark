<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\File;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class PluginStructureTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = 'Get the complete directory structure of a plugin';

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

        $structure = $this->getDirectoryTree($pluginPath);

        $output = "Plugin Structure: {$plugin}\n\n";
        $output .= $structure;

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
                ->description('Plugin name (kebab-case)')
                ->required(),
        ];
    }

    protected function getDirectoryTree(string $path, string $prefix = ''): string
    {
        $tree = '';
        $ignoredPatterns = $this->getIgnoredPatterns($path);

        // Create a custom recursive directory iterator that skips ignored paths
        $directory = new \RecursiveDirectoryIterator($path, \RecursiveDirectoryIterator::SKIP_DOTS);
        $filter = new class($directory, $ignoredPatterns, $path) extends \RecursiveFilterIterator
        {
            private array $ignoredPatterns;

            private string $basePath;

            public function __construct(\RecursiveDirectoryIterator $iterator, array $ignoredPatterns, string $basePath)
            {
                parent::__construct($iterator);
                $this->ignoredPatterns = $ignoredPatterns;
                $this->basePath = rtrim($basePath, '/');
            }

            public function accept(): bool
            {
                $item = $this->current();
                $relativePath = str_replace($this->basePath.'/', '', $item->getPathname());

                // If this is a directory and it matches an ignore pattern, skip it entirely
                if ($item->isDir() && $this->shouldIgnore($relativePath)) {
                    return false;
                }

                // For files, check if their path matches an ignore pattern
                return ! $this->shouldIgnore($relativePath);
            }

            public function getChildren(): ?\RecursiveFilterIterator
            {
                return new self($this->getInnerIterator()->getChildren(), $this->ignoredPatterns, $this->basePath);
            }

            private function shouldIgnore(string $path): bool
            {
                foreach ($this->ignoredPatterns as $pattern) {
                    // Remove leading slash for comparison
                    $pattern = ltrim($pattern, '/');

                    // Handle directory patterns (ending with /)
                    if (str_ends_with($pattern, '/')) {
                        $pattern = rtrim($pattern, '/');
                        if (str_starts_with($path, $pattern.'/') || $path === $pattern) {
                            return true;
                        }
                    }
                    // Handle wildcard patterns
                    elseif (str_contains($pattern, '*')) {
                        // Convert glob pattern to regex
                        $regex = '/^'.str_replace(['\*'], ['.*'], preg_quote($pattern, '/')).'$/';
                        if (preg_match($regex, $path)) {
                            return true;
                        }
                    }
                    // Handle exact match or prefix match
                    else {
                        if ($path === $pattern || str_starts_with($path, $pattern.'/')) {
                            return true;
                        }
                    }
                }

                return false;
            }
        };

        $iterator = new \RecursiveIteratorIterator($filter, \RecursiveIteratorIterator::SELF_FIRST);

        foreach ($iterator as $item) {
            // Only include files, not directories
            if ($item->isFile()) {
                $relativePath = str_replace($path.'/', '', $item->getPathname());
                $tree .= $prefix.$relativePath."\n";
            }
        }

        return $tree;
    }

    /**
     * Get ignored patterns from .gitignore file.
     */
    protected function getIgnoredPatterns(string $path): array
    {
        $patterns = [
            'vendor/',
            'node_modules/',
        ];

        $gitignorePath = $path.'/.gitignore';
        if (File::exists($gitignorePath)) {
            $gitignoreContent = File::get($gitignorePath);
            $lines = explode("\n", $gitignoreContent);

            foreach ($lines as $line) {
                $line = trim($line);
                // Skip empty lines and comments
                if (empty($line) || str_starts_with($line, '#')) {
                    continue;
                }
                $patterns[] = $line;
            }
        }

        return $patterns;
    }
}
