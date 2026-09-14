<?php

declare(strict_types=1);

namespace Reporting\Concerns;

use Illuminate\Database\Eloquent\Model;
use Throwable;

trait ModelFactoryHelpers
{
    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws Throwable
     */
    public static function firstOrFactory(array $attributes = []): Model
    {
        $first = self::query()->first();

        if ($first instanceof Model) {
            return $first;
        }

        $model = self::factory($attributes)->create();

        throw_if(! $model instanceof Model, 'Factory did not return a model instance.');

        return $model;
    }
}
