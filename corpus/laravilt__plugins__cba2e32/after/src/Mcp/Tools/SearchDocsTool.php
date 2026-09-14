<?php

namespace Laravilt\Plugins\Mcp\Tools;

use Illuminate\Contracts\JsonSchema\JsonSchema;
use Illuminate\Support\Facades\File;
use Laravel\Mcp\Request;
use Laravel\Mcp\Response;
use Laravel\Mcp\Server\Tool;

class SearchDocsTool extends Tool
{
    /**
     * The tool's description.
     */
    protected string $description = 'Search the Laravilt Plugins documentation to understand features, architecture, and usage';

    /**
     * Handle the tool request.
     */
    public function handle(Request $request): Response
    {
        $query = $request->string('query');
        $pluginsPath = base_path('packages/laravilt/plugins');

        // Collect all documentation files
        $docFiles = $this->getDocumentationFiles($pluginsPath);

        // Search through documentation
        $results = $this->searchDocumentation($docFiles, $query);

        if (empty($results)) {
            return Response::text("No documentation found matching '{$query}'.");
        }

        // Format results
        $output = "Documentation Search Results for: {$query}\n\n";
        $output .= 'Found '.count($results)." relevant section(s):\n\n";

        foreach ($results as $result) {
            $output .= "📄 {$result['file']}\n";
            $output .= str_repeat('=', 60)."\n\n";
            $output .= $result['content']."\n\n";
            $output .= str_repeat('-', 60)."\n\n";
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
            'query' => $schema->string()
                ->description('Search query (e.g., "plugin generation", "MCP tools", "factory pattern", "component types")')
                ->required(),
        ];
    }

    /**
     * Get all documentation files.
     */
    protected function getDocumentationFiles(string $path): array
    {
        $files = [];

        // README.md - Main documentation
        if (File::exists($path.'/README.md')) {
            $files[] = [
                'path' => $path.'/README.md',
                'name' => 'README.md',
                'content' => File::get($path.'/README.md'),
            ];
        }

        // All docs/ files
        $docsPath = $path.'/docs';
        if (File::isDirectory($docsPath)) {
            foreach (File::allFiles($docsPath) as $file) {
                if ($file->getExtension() === 'md') {
                    $relativePath = str_replace($path.'/', '', $file->getPathname());
                    $files[] = [
                        'path' => $file->getPathname(),
                        'name' => $relativePath,
                        'content' => File::get($file->getPathname()),
                    ];
                }
            }
        }

        return $files;
    }

    /**
     * Search documentation files for relevant content.
     */
    protected function searchDocumentation(array $files, string $query): array
    {
        $results = [];
        $queryLower = strtolower($query);
        $keywords = explode(' ', $queryLower);

        foreach ($files as $file) {
            $content = $file['content'];
            $contentLower = strtolower($content);

            // Check if any keyword matches
            $matchCount = 0;
            foreach ($keywords as $keyword) {
                if (stripos($contentLower, $keyword) !== false) {
                    $matchCount++;
                }
            }

            // If matches found, extract relevant sections
            if ($matchCount > 0) {
                $sections = $this->extractRelevantSections($content, $query, $keywords);

                foreach ($sections as $section) {
                    $results[] = [
                        'file' => $file['name'],
                        'content' => $section,
                        'relevance' => $matchCount,
                    ];
                }
            }
        }

        // Sort by relevance (highest first)
        usort($results, fn ($a, $b) => $b['relevance'] <=> $a['relevance']);

        // Limit to top 5 most relevant results
        return array_slice($results, 0, 5);
    }

    /**
     * Extract relevant sections from content based on query.
     */
    protected function extractRelevantSections(string $content, string $query, array $keywords): array
    {
        $sections = [];
        $lines = explode("\n", $content);

        // Split by markdown headers to get sections
        $currentSection = '';
        $currentHeader = '';
        $inRelevantSection = false;

        foreach ($lines as $line) {
            // Check if line is a header
            if (preg_match('/^#+\s+(.+)$/', $line, $matches)) {
                // Save previous section if it was relevant
                if ($inRelevantSection && ! empty(trim($currentSection))) {
                    $sections[] = trim($currentHeader."\n\n".$currentSection);
                }

                // Start new section
                $currentHeader = $line;
                $currentSection = '';

                // Check if header is relevant
                $headerLower = strtolower($matches[1]);
                $inRelevantSection = false;
                foreach ($keywords as $keyword) {
                    if (stripos($headerLower, $keyword) !== false) {
                        $inRelevantSection = true;
                        break;
                    }
                }
            } else {
                // Add to current section
                $currentSection .= $line."\n";

                // Check if content line is relevant
                if (! $inRelevantSection) {
                    $lineLower = strtolower($line);
                    foreach ($keywords as $keyword) {
                        if (stripos($lineLower, $keyword) !== false) {
                            $inRelevantSection = true;
                            break;
                        }
                    }
                }
            }
        }

        // Save last section if relevant
        if ($inRelevantSection && ! empty(trim($currentSection))) {
            $sections[] = trim($currentHeader."\n\n".$currentSection);
        }

        // If no sections found, return intro (first 50 lines that match)
        if (empty($sections)) {
            $matchingLines = [];
            foreach ($lines as $line) {
                $lineLower = strtolower($line);
                foreach ($keywords as $keyword) {
                    if (stripos($lineLower, $keyword) !== false) {
                        $matchingLines[] = $line;
                        if (count($matchingLines) >= 50) {
                            break 2;
                        }
                        break;
                    }
                }
            }

            if (! empty($matchingLines)) {
                $sections[] = implode("\n", $matchingLines);
            }
        }

        return $sections;
    }
}
