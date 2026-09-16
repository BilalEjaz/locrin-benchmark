<?php

declare(strict_types=1);

namespace ZtdQuery\Shadow\Mutation;

use ZtdQuery\Schema\TableDefinition;

/**
 * Carries the key a row had, alongside the key it has.
 *
 * An UPDATE may change the very columns that identify a row, and once it has,
 * nothing in the result says which row each new one used to be. The rewritten
 * statement therefore selects the old key as well, under a name no table would
 * use, and this is what puts that name on and takes it off again.
 *
 * @phpstan-import-type Row from TableDefinition
 */
final class MutationRowIdentity
{
    private const PREFIX = '__ztd_original_';

    /**
     * Answers the name the old value of a key column is carried under.
     *
     * @param string $primaryKey Key column
     *
     * @return string Name no table would use for it
     */
    public function column(string $primaryKey): string
    {
        return self::PREFIX . $primaryKey;
    }

    /**
     * Takes the carried names back off a row.
     *
     * @param Row $row Row as the rewritten statement read it back
     *
     * @return Row The row as the caller should see it
     */
    public function strip(array $row): array
    {
        foreach (array_keys($row) as $column) {
            if (str_starts_with($column, self::PREFIX)) {
                unset($row[$column]);
            }
        }

        return $row;
    }

    /**
     * Takes the carried names back off every one of these rows.
     *
     * @param list<Row> $rows Rows as the rewritten statement read them back
     *
     * @return list<Row> The rows as the caller should see them
     */
    public function stripAll(array $rows): array
    {
        return array_map($this->strip(...), $rows);
    }

    /**
     * Splits a row into the row itself and the key it used to have.
     *
     * A key column the statement did not change carries no old value, so its
     * current one is the old one too.
     *
     * @param Row $row Row as the rewritten statement read it back
     * @param list<string> $primaryKeys Columns that identify one row
     *
     * @return array{row: Row, identity: Row} The row, and the key it used to have
     */
    public function extract(array $row, array $primaryKeys): array
    {
        $identity = [];
        foreach ($primaryKeys as $primaryKey) {
            $metadataColumn = $this->column($primaryKey);
            if (array_key_exists($metadataColumn, $row)) {
                $identity[$primaryKey] = $row[$metadataColumn];
                unset($row[$metadataColumn]);
                continue;
            }
            if (array_key_exists($primaryKey, $row)) {
                $identity[$primaryKey] = $row[$primaryKey];
            }
        }

        return ['row' => $row, 'identity' => $identity];
    }
}
