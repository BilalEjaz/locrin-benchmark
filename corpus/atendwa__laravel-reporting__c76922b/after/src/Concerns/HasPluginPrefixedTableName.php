<?php

declare(strict_types=1);

namespace Reporting\Concerns;

trait HasPluginPrefixedTableName
{
    public function getTable(): string
    {
        $plugin = str($this->getPluginName())->replace('_', ' ')->initials();

        return str($plugin . '_' . class_basename($this))
            ->snake()->replace('-', '_')
            ->replace('__', '_')
            ->plural()->toString();
    }

    abstract protected function getPluginName(): string;
}
