<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('cj_import_rules', function (Blueprint $table): void {
            $table->string('ship_to_country', 2)->nullable()->after('country_code');
            $table->decimal('max_shipping_percent', 8, 2)->nullable()->after('ship_to_country');
            $table->unsignedSmallInteger('max_quotes_per_run')->default(50)->after('max_shipping_percent');
        });

        Schema::table('cj_candidates', function (Blueprint $table): void {
            $table->decimal('shipping_usd', 12, 2)->nullable()->after('cost_usd');
            $table->timestamp('shipping_checked_at')->nullable()->after('shipping_usd');
        });
    }

    public function down(): void
    {
        Schema::table('cj_candidates', function (Blueprint $table): void {
            $table->dropColumn(['shipping_usd', 'shipping_checked_at']);
        });

        Schema::table('cj_import_rules', function (Blueprint $table): void {
            $table->dropColumn(['ship_to_country', 'max_shipping_percent', 'max_quotes_per_run']);
        });
    }
};
