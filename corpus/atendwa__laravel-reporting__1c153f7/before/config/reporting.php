<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Generator Namespaces
    |--------------------------------------------------------------------------
    |
    | Namespaces to scan for report generator implementations.
    |
    */
    'generator_namespaces' => [
        'App\\Reports\\Generators',
    ],

    /*
    |--------------------------------------------------------------------------
    | Generator Paths
    |--------------------------------------------------------------------------
    |
    | Directories to scan for report generator class files.
    |
    */
    'generator_paths' => [
        app_path('Reports/Generators'),
    ],

    /*
    |--------------------------------------------------------------------------
    | Storage Disk
    |--------------------------------------------------------------------------
    |
    | The filesystem disk to store generated report files.
    |
    */
    'disk' => env('REPORTING_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Storage Directory
    |--------------------------------------------------------------------------
    |
    | The directory within the disk for report files.
    |
    */
    'directory' => 'reports',

    /*
    |--------------------------------------------------------------------------
    | Default Cooldown Minutes
    |--------------------------------------------------------------------------
    |
    | Default cooldown period in minutes for heavy reports. If a completed
    | report exists within this window, cached results are served instead.
    |
    */
    'default_cooldown_minutes' => 30,

    /*
    |--------------------------------------------------------------------------
    | PDF Engine
    |--------------------------------------------------------------------------
    |
    | The PDF engine to use for report generation.
    | Supported: "dompdf" (chunked DomPDF + FPDI merge), "mpdf" (incremental mPDF)
    |
    */
    'pdf_engine' => env('REPORTING_PDF_ENGINE', 'mpdf'),

    /*
    |--------------------------------------------------------------------------
    | Chunk Size
    |--------------------------------------------------------------------------
    |
    | Number of rows to process per chunk during CSV file generation.
    |
    */
    'chunk_size' => 1000,

    /*
    |--------------------------------------------------------------------------
    | PDF Chunk Size
    |--------------------------------------------------------------------------
    |
    | Number of rows per chunk when generating PDFs. Smaller values use
    | less memory but produce more intermediate files (DomPDF) or more
    | WriteHTML calls (mPDF).
    |
    */
    'pdf_chunk_size' => 500,

    /*
    |--------------------------------------------------------------------------
    | Logo Path
    |--------------------------------------------------------------------------
    |
    | Absolute path to the logo image file included in PDF report headers.
    |
    */
    'logo_path' => env('REPORTING_LOGO_PATH'),

    /*
    |--------------------------------------------------------------------------
    | Queue
    |--------------------------------------------------------------------------
    |
    | Queue name for report generation jobs.
    |
    */
    'queue' => env('REPORTING_QUEUE') ?? env('QUEUE_CONNECTION'),

    /*
    |--------------------------------------------------------------------------
    | Cleanup Days
    |--------------------------------------------------------------------------
    |
    | Default number of days to retain report history.
    |
    */
    'cleanup_days' => 90,

    /*
    |--------------------------------------------------------------------------
    | Team Model
    |--------------------------------------------------------------------------
    |
    | Fully-qualified class name of the tenant/team model, required only when
    | a generator uses the Reporting\Generator\Concerns\IsTenantAware trait.
    | The model must expose an `is_default` column and, on the user model,
    | a `teams()` relation.
    |
    */
    'team_model' => env('REPORTING_TEAM_MODEL'),
];
