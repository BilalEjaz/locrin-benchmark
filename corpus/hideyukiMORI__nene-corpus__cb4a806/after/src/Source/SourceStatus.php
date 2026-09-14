<?php

declare(strict_types=1);

namespace NeneCorpus\Source;

enum SourceStatus: string
{
    case Pending = 'pending';
    case Processing = 'processing';
    case Ready = 'ready';
    case Failed = 'failed';

    /**
     * The only status whose chunks may be read by search or pushed to an index (#394).
     *
     * Ingestion writes chunks **while the source is still `processing`** and only then
     * raises it to `ready`; on failure it sets `failed` and leaves the rows it already
     * committed behind (text/CSV run outside a transaction, and a reindex has already
     * cleared the previous chunks by then). So a source that is not `ready` may well
     * own rows in `chunks`, and those rows are a half-written corpus.
     *
     * This is an allow list rather than `<> 'failed'` on purpose: a status added later
     * is excluded until someone decides it is searchable, instead of silently joining
     * the results.
     */
    public const SEARCHABLE = self::Ready;

    /**
     * Join predicate shared by every query that reads chunks through their source.
     *
     * The alias is fixed to `s` because all three call sites already spell the join
     * that way; keeping the literal in one place is what stops the three from drifting
     * apart again — they drifted into agreement by copy-paste last time.
     */
    public const SEARCHABLE_SOURCE_SQL = "s.is_deleted = 0 AND s.status = '" . self::SEARCHABLE->value . "'";
}
