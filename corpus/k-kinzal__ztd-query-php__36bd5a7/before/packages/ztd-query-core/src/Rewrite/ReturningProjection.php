<?php

declare(strict_types=1);

namespace ZtdQuery\Rewrite;

use ZtdQuery\Exception\InvalidDefinitionException;
use ZtdQuery\Schema\TableDefinition;

/**
 * A dialect-neutral projection of mutation rows returned to the client.
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class ReturningProjection
{
    /**
     * Binds a projection to the items it was written as.
     *
     * @param list<array{source: string|null, output: string|null}> $items
     */
    public function __construct(private readonly array $items)
    {
    }

    /**
     * @param list<array{source: string|null, output: string|null}> $items
     *
     * @throws InvalidDefinitionException When the items do not describe a projection anything could read back
     */
    public static function fromItems(array $items): self
    {
        if ($items === []) {
            throw new InvalidDefinitionException('Returning projection requires at least one item.');
        }
        foreach ($items as $item) {
            if ($item['source'] === null && $item['output'] !== null) {
                throw new InvalidDefinitionException('Wildcard returning projections cannot have an output name.');
            }
            if ($item['source'] === '' || $item['output'] === '') {
                throw new InvalidDefinitionException('Returning projection names must not be empty.');
            }
        }

        return new self($items);
    }

    /**
     * @param list<Row> $rows
     * @return list<Row>
     */
    public function project(array $rows): array
    {
        $projectedRows = [];
        foreach ($rows as $row) {
            $projected = [];
            foreach ($this->items as $item) {
                if ($item['source'] === null) {
                    $projected = array_merge($projected, $row);
                    continue;
                }
                $output = $item['output'] ?? $item['source'];
                $projected[$output] = $row[$item['source']] ?? null;
            }
            $projectedRows[] = $projected;
        }

        return $projectedRows;
    }

    /**
     * @return list<array{source: string|null, output: string|null}>
     */
    public function items(): array
    {
        return $this->items;
    }
}
