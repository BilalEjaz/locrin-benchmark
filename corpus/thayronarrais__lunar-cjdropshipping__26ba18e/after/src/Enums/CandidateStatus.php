<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Enums;

enum CandidateStatus: string
{
    case Pending = 'pending';
    case Approved = 'approved';
    case Ignored = 'ignored';
    case Importing = 'importing';
    case Imported = 'imported';
    case Failed = 'failed';
    case Unavailable = 'unavailable';
    case ShippingTooHigh = 'shipping_too_high';
}
