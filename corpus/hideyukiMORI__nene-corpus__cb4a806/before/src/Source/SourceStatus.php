<?php

declare(strict_types=1);

namespace NeneCorpus\Source;

enum SourceStatus: string
{
    case Pending = 'pending';
    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';
}
