<?php

namespace Shieldforce\CheckoutPayment\Services\Permissions;

use Illuminate\Support\Facades\Gate;

trait CanPageTrait
{
    public static function canAccess(): bool
    {

        $slug = self::$slug;

        return Gate::allows(
            "filament.admin.pages.{$slug}.create"
        );

    }
}
