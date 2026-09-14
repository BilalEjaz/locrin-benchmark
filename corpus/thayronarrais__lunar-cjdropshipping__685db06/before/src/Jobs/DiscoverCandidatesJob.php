<?php

declare(strict_types=1);

namespace Thayron\LunarCjDropshipping\Jobs;

use DateTimeInterface;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Thayron\CjDropshipping\Exceptions\QuotaExceededException;
use Thayron\LunarCjDropshipping\Actions\DiscoverCandidates;
use Thayron\LunarCjDropshipping\Models\ImportRule;
use Thayron\LunarCjDropshipping\Support\QuotaDelay;

final class DiscoverCandidatesJob implements ShouldBeUnique, ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $maxExceptions = 3;

    public int $timeout = 3600;

    public int $uniqueFor = 90000;

    /** @var list<int> */
    public array $backoff = [60, 300, 900];

    public function __construct(public ImportRule $rule)
    {
        $this->onQueue((string) config('lunar-cjdropshipping.queue'));
    }

    public function uniqueId(): string
    {
        return 'cj-discover-'.$this->rule->id;
    }

    /**
     * Quota releases do not consume attempts; only real exceptions are capped by $maxExceptions.
     */
    public function retryUntil(): DateTimeInterface
    {
        return now()->addHours(48);
    }

    public function handle(DiscoverCandidates $discover): void
    {
        try {
            $discover->handle($this->rule);
        } catch (QuotaExceededException) {
            $this->release(QuotaDelay::seconds());
        }
    }
}
