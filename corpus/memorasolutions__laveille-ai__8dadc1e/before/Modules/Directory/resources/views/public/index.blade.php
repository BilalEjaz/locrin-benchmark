<!-- Author: MEMORA solutions, https://memora.solutions ; info@memora.ca -->
@extends(fronttheme_layout())

@section('title', __('Répertoire techno') . ' - ' . config('app.name'))
@section('meta_description', __('Les meilleurs outils techno sélectionnés pour vous. ChatGPT, Claude, Midjourney, Perplexity et plus.'))

@section('breadcrumb')
    @include('fronttheme::partials.breadcrumb', ['breadcrumbTitle' => __('Répertoire techno')])
@endsection

@php
    // 2026-07-23 — Regroupement visuel par écosystème (badge "Éditeur · N produits" sur les cartes).
    // $ecosystemCounts (EcosystemCountService, mise en cache) et $ecosystemLabels (config
    // ecosystems.labels) sont préparés par PublicDirectoryController::index() et reçus ici tels
    // quels — jamais recalculés en vue. Matchés en mémoire dans la boucle ci-dessous : jamais de
    // requête par carte (anti N+1) sur les 433+ outils.
    // 2026-08-28 - seuil d'affichage du compteur de vues "propre" (voir plus bas, clicksCount) :
    // calculé une seule fois hors boucle, même réglage que _highlight_card.blade.php (DRY sur la
    // clé de config, pas sur l'appel - clé Settings identique aux deux endroits).
    $viewsVerifiedMinDisplay = \Modules\Settings\Facades\Settings::get('directory.views_verified_min_display', 10);
    // Ticket #1868 - Cloudflare Turnstile sur le wizard "Proposer un outil" (étape 2 plus bas).
    // null tant que les clés Cloudflare sont absentes (état de ce projet au 2026-08-31) OU que
    // le coupe-circuit directory.turnstile.enabled est à false : le formulaire reste alors
    // identique à avant ce chantier, sans script Cloudflare chargé (zéro appel réseau ajouté).
    // isEnabled() (clé SECRÈTE, vérifiée côté PublicDirectoryController::storeSubmission) est
    // volontairement AUSSI exigé ici, en plus de siteKey() (clé PUBLIQUE) : sans ce garde-fou,
    // poser la clé de site sans poser la clé secrète afficherait un widget que le serveur ne
    // vérifie jamais (revue adversariale Hermes/deepseek-v4-flash, 2026-08-31) - défi inutile
    // pour le visiteur, protection nulle malgré l'apparence contraire.
    $turnstileSiteKey = (
        config('directory.turnstile.enabled', true)
        && class_exists(\Modules\Authors\Services\TurnstileVerificationService::class)
        && app(\Modules\Authors\Services\TurnstileVerificationService::class)->isEnabled()
    )
        ? \Modules\Authors\Services\TurnstileVerificationService::siteKey()
        : null;
    $toolsJson = $tools->map(function($tool) use ($pricingOptions, $ecosystemCounts, $ecosystemLabels, $viewsVerifiedMinDisplay) {
        $host = $tool->url ? parse_url($tool->url, PHP_URL_HOST) : '';
        $ecoTag = $tool->ecosystem_tag ?? null;
        $ecoCount = $ecoTag ? ($ecosystemCounts[$ecoTag] ?? 0) : 0;
        $ecoLabel = $ecoTag ? ($ecosystemLabels[$ecoTag] ?? ucfirst($ecoTag)) : null;
        // Sous le seuil, la valeur RÉELLE de clicks_count_verified n'est transmise nulle part au
        // client (même principe que _highlight_card.blade.php, qui ne calcule le nombre formaté
        // que dans la branche @if) : les deux clés clicksCount/clicksCountFormatted retombent à 0.
        $displayedClicksCount = (($tool->clicks_count_verified ?? 0) >= $viewsVerifiedMinDisplay)
            ? (int) $tool->clicks_count_verified
            : 0;
        return [
            'id' => $tool->id,
            'name' => $tool->name,
            'slug' => $tool->slug,
            'shortDesc' => $tool->short_description ?? '',
            'url' => $tool->url,
            'pricing' => $tool->pricing,
            'pricingLabel' => $pricingOptions[$tool->pricing] ?? ucfirst($tool->pricing),
            'isFeatured' => (bool) $tool->is_featured,
            'categories' => $tool->categories->pluck('name')->toArray(),
            'categorySlugs' => $tool->categories->pluck('slug')->toArray(),
            'favicon' => $host ? "https://www.google.com/s2/favicons?domain={$host}&sz=64" : '',
            'screenshot' => $tool->screenshot ? (str_starts_with($tool->screenshot, 'http') ? $tool->screenshot : asset($tool->screenshot).'?v='.$tool->updated_at->timestamp) : '',
            'showUrl' => $tool->getPublicUrl(),
            'websiteType' => $tool->website_type ?? 'website',
            'launchYear' => $tool->launch_year ?? 0,
            'createdTs' => $tool->created_at ? $tool->created_at->timestamp : 0,
            'avgRating' => round($tool->averageRating(), 1),
            // Couleurs assombries pour contraste AAA (7:1+) avec le texte blanc superposé (WCAG 1.4.6) : audit 2026-07-03
            'gradientFrom' => ['#0B7285','#1a365d','#8E44AD','#854914','#176638','#9F3429','#205D86','#794E09'][crc32($tool->name) % 8 < 0 ? (crc32($tool->name) % 8) + 8 : crc32($tool->name) % 8],
            'gradientTo' => ['#1a365d','#0B7285','#2C3E50','#983C00','#0E6352','#8E44AD','#1E5D87','#983C00'][crc32($tool->name) % 8 < 0 ? (crc32($tool->name) % 8) + 8 : crc32($tool->name) % 8],
            'hasEduPricing' => (bool) $tool->has_education_pricing,
            'tutorialsCount' => $tool->tutorials_count ?? 0,
            // S142 2026-08-28 : compteur de vues sur la carte principale, même champ et même
            // format que le badge déjà affiché sur les cartes "Ajoutés récemment"/"Les plus
            // populaires" (_highlight_card.blade.php) - formaté côté serveur (comme l'original)
            // pour éviter toute divergence de séparateur de milliers avec le JS.
            // Corrigé 2026-08-28 : source basculée sur clicks_count_verified (compteur "propre",
            // filtré anti-robot + dédupliqué - clicks_count porte un historique pollué par les
            // robots, voir migration 2026_08_28_100000_...). Sous le seuil, $displayedClicksCount
            // vaut 0 : réutilise TEL QUEL le garde-fou x-if="tool.clicksCount > 0" déjà présent
            // dans le gabarit Alpine plus bas, sans dupliquer le seuil côté JS.
            'clicksCount' => $displayedClicksCount,
            'clicksCountFormatted' => number_format($displayedClicksCount, 0, ',', ' '),
            'lifecycleStatus' => $tool->lifecycle_status ?? 'active',
            'lifecycleLabel' => $tool->lifecycle_label ?? '',
            'lifecycleColor' => $tool->lifecycle_color ?? '#374151',
            'lifecycleIconFa' => (function ($icon) {
                $map = ['fa-circle-check'=>'fa-check-circle','fa-flask'=>'fa-flask','fa-pause-circle'=>'fa-pause-circle','fa-tag'=>'fa-tag','fa-shuffle'=>'fa-random','fa-handshake'=>'fa-handshake-o','fa-circle-xmark'=>'fa-times-circle','fa-triangle-exclamation'=>'fa-exclamation-triangle'];
                return $map[$icon] ?? $icon;
            })($tool->lifecycle_icon ?? 'fa-circle-check'),
            'isLifecycleActive' => (bool) $tool->is_lifecycle_active,
            'isLifecycleDown' => (bool) $tool->is_lifecycle_down,
            'lifecycleBannerMsg' => $tool->lifecycle_banner_message ?? '',
            'ecosystemTag' => $ecoTag,
            // Badge pré-formaté côté serveur (évite la pluralisation en JS) : "OpenAI · 6 produits".
            'ecosystemBadge' => ($ecoTag && $ecoCount > 0) ? ($ecoLabel . ' · ' . $ecoCount . ' ' . ($ecoCount > 1 ? __('produits') : __('produit'))) : null,
        ];
    })->values();

    $pricingEmojis = \Modules\Directory\Support\PricingCategories::emojis();
    $catCount = $categories->count();

    // S90 #43 Phase 2 — map slug → name pour bouton alerte réactif (filtre catégorie client-side)
    $categoryNamesBySlug = $categories->pluck('name', 'slug')->toArray();
@endphp

@push('styles')
<style>
    .rt-hero { background: linear-gradient(135deg, #fff 0%, #F0F4F8 100%); padding: 40px 0 30px; border-bottom: 1px solid #E5E7EB; }
    .rt-hero h1 { font-family: var(--f-heading); font-weight: 800; color: var(--c-dark); margin-bottom: 10px; }
    .rt-search { position: relative; max-width: 600px; margin: 0 auto; }
    .rt-search-input { width: 100%; padding: 14px 20px 14px 48px; border-radius: var(--r-btn); border: 2px solid #E5E7EB; font-size: 17px; box-shadow: 0 4px 15px rgba(0,0,0,0.04); outline: none; background: #fff; }
    .rt-search-input:focus { border-color: var(--c-primary); box-shadow: 0 4px 15px rgba(11,114,133,0.1); }
    .rt-search-icon { position: absolute; left: 18px; top: 50%; transform: translateY(-50%); color: #374151; width: 20px; height: 20px; }

    .rt-pill { display: inline-flex; align-items: center; gap: 4px; padding: 7px 16px; min-height: 44px; border-radius: var(--r-btn); background: #F3F4F6; color: var(--c-dark); font-weight: 600; font-size: 14px; border: none; cursor: pointer; transition: background-color 0.2s, color 0.2s; }
    .rt-pill:hover { background: #E5E7EB; }
    .rt-pill.active { background: var(--c-primary); color: #fff; }
    /* S134 a11y : base CSS du toggle de vue (teal sur blanc) = contraste AAA garanti même avant l'init Alpine / sans JS (évite l'héritage du gris #777 de Bloggar). L'état actif (fond teal/texte blanc) est appliqué par le :style Alpine. */
    .rt-view-toggle button { background: #fff; color: var(--c-primary, #064E5A); transition: background-color 0.15s, color 0.15s, border-color 0.15s; }

    .rt-sort-bar { display: flex; border-bottom: 1px solid #E5E7EB; margin-bottom: 20px; }
    .rt-sort-tab { padding: 10px 16px; min-height: 44px; display: inline-flex; align-items: center; font-weight: 600; font-size: 0.9rem; color: #374151; cursor: pointer; border-bottom: 3px solid transparent; transition: all 0.2s; background: none; border-top: none; border-left: none; border-right: none; }
    .rt-sort-tab:hover { color: var(--c-dark); }
    .rt-sort-active { color: var(--c-primary) !important; border-bottom-color: var(--c-primary) !important; }

    .rt-card { background: #fff; border-radius: var(--r-base); padding: 24px; height: 100%; display: flex; flex-direction: column; border: 1px solid #E5E7EB; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: transform 0.25s, box-shadow 0.25s; position: relative; }
    .rt-card:hover { transform: translateY(-4px); box-shadow: 0 12px 25px -5px rgba(0,0,0,0.1); }
    .rt-logo { width: 48px; height: 48px; border-radius: 12px; background: #f9fafb; padding: 3px; border: 1px solid #e5e7eb; flex-shrink: 0; }
    .rt-card-name { font-family: var(--f-heading); font-size: 1.1rem; font-weight: 700; color: var(--c-dark); margin: 0 0 4px; }
    .rt-card-name a { color: inherit; text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; padding: 2px 4px; }
    .rt-card-name a:hover { color: var(--c-primary); }
    .rt-badge { padding: 3px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-free { background: #D1FAE5; color: #065F46; }
    .badge-freemium { background: #DBEAFE; color: #1E40AF; }
    .badge-paid { background: #FEF3C7; color: #92400E; }
    .badge-open_source { background: #CCFBF1; color: #115E59; }
    .badge-enterprise { background: #EDE9FE; color: #5B21B6; }
    .rt-desc { color: #4B5563; font-size: 14px; line-height: 1.6; margin-bottom: 14px; flex-grow: 1; }
    .rt-tag { font-size: 12px; color: #636b77; background: #f3f4f6; padding: 2px 8px; border-radius: 4px; }
    .rt-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 14px; border-top: 1px solid #F3F4F6; align-items: center; }
    .rt-btn-visit { background: var(--c-accent); color: #fff !important; border: none; padding: 7px 16px; min-height: 44px; display: inline-flex; align-items: center; border-radius: var(--r-btn); font-weight: 600; text-decoration: none !important; font-size: 13px; transition: opacity 0.2s; }
    .rt-btn-visit:hover { opacity: 0.9; color: #fff; }
    .rt-btn-details { color: var(--c-dark); font-weight: 600; font-size: 13px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; min-width: 44px; padding: 2px 6px; }
    .rt-btn-details:hover { color: var(--c-primary); }
    .rt-featured { position: absolute; top: 12px; right: 12px; background: #0B7285; color: #fff; font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 12px; z-index: 2; letter-spacing: 0.3px; }
    .rt-stars { color: #F59E0B; font-size: 13px; font-weight: 700; }

    .row-flex { display: flex; flex-wrap: wrap; }
    .row-flex > [class*='col-'] { display: flex; flex-direction: column; margin-bottom: 24px; }
    .rt-empty { text-align: center; padding: 60px 20px; background: #F9FAFB; border-radius: var(--r-base); }
    [x-cloak] { display: none !important; }

    /* Focus visible - WCAG 2.2 AAA (contrast 5.7:1 sur fond blanc) */
    .rt-card a:focus-visible,
    .rt-card-name a:focus-visible,
    .rt-btn-visit:focus-visible,
    .rt-btn-details:focus-visible,
    .rt-pill:focus-visible,
    .rt-sort-tab:focus-visible,
    .rt-pricing-dropdown button:focus-visible {
        outline: 3px solid #0B7285;
        outline-offset: 2px;
        border-radius: 4px;
    }
    .rt-search-input:focus-visible,
    .rt-hl-card:focus-visible,
    .rt-hl-arrow:focus-visible {
        outline: 3px solid #0B7285;
        outline-offset: 2px;
    }

    /* S84 #38 — Card "down" state (lifecycle closed/scam) : bandeau pleine largeur + grayscale */
    .rt-card.is-down { padding-top: 44px; overflow: hidden; }
    .rt-card.is-down > *:not(.rt-card-down-banner) {
        filter: grayscale(0.75);
        opacity: 0.65;
        transition: filter 0.2s, opacity 0.2s;
    }
    .rt-card.is-down:hover > *:not(.rt-card-down-banner) {
        filter: grayscale(0.4);
        opacity: 0.85;
    }
    .rt-card-down-banner {
        position: absolute; top: 0; left: 0; right: 0; z-index: 5;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        padding: 10px 14px; min-height: 36px;
        background: var(--c-text-secondary, #4a4f5c);
        color: #fff; font-weight: 700; font-size: 13px;
        letter-spacing: 0.2px; line-height: 1.3; text-align: center;
        border-radius: var(--r-base) var(--r-base) 0 0;
        box-shadow: 0 2px 6px rgba(0,0,0,0.12);
    }
    .rt-card-down-banner.is-scam { background: var(--c-accent, #9A2A06); }
    .rt-card-down-banner i { font-size: 14px; }
    @media (prefers-reduced-motion: reduce) {
        .rt-card.is-down > *:not(.rt-card-down-banner) { transition: none; }
    }

    /* Highlights section - slider */
    .rt-highlights { padding: 30px 0 10px; }
    .rt-hl-section { margin-bottom: 8px; }
    .rt-hl-title { font-family: var(--f-heading); font-size: 1.15rem; font-weight: 700; color: var(--c-dark); margin: 0 0 14px; display: flex; align-items: center; gap: 8px; }
    .rt-hl-slider { position: relative; display: flex; align-items: center; }
    .rt-hl-track { display: flex; gap: 16px; overflow-x: auto; scroll-behavior: smooth; scrollbar-width: none; -ms-overflow-style: none; flex: 1; padding: 4px 0; }
    .rt-hl-track::-webkit-scrollbar { display: none; }
    .rt-hl-card { display: block; flex: 0 0 196px; background: #fff; border-radius: var(--r-base); border: 1px solid #E5E7EB; overflow: hidden; text-decoration: none; transition: transform 0.2s, box-shadow 0.2s; }
    .rt-hl-card:hover { transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.08); text-decoration: none; }
    .rt-hl-img { height: 100px; overflow: hidden; position: relative; display: flex; align-items: center; justify-content: center; }
    .rt-hl-img img { width: 100%; height: 100%; object-fit: cover; }
    .rt-hl-img-text { color: #fff; font-weight: 700; font-size: 14px; text-shadow: 0 1px 3px rgba(0,0,0,0.3); }
    .rt-hl-body { padding: 10px 12px; }
    .rt-hl-name { font-weight: 700; font-size: 13px; color: var(--c-dark); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
    .rt-hl-arrow { flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.15); display: flex; align-items: center; justify-content: center; cursor: pointer; border: none; color: var(--c-dark); font-size: 14px; margin: 0 4px; }
    .rt-hl-arrow:hover { background: var(--c-primary); color: #fff; }

    /* Filter bar + pricing dropdown */
    .rt-filter-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .rt-filter-count { color: #374151; font-size: 0.85rem; margin-left: auto; }
    .rt-pricing-dropdown { position: absolute; top: 100%; left: 0; z-index: 50; background: #fff; border: 1px solid #E5E7EB; border-radius: var(--r-base); box-shadow: 0 8px 25px rgba(0,0,0,0.1); padding: 6px; min-width: 180px; margin-top: 4px; }
    .rt-pricing-dropdown button { display: flex; align-items: center; width: 100%; text-align: left; padding: 8px 12px; min-height: 44px; border: none; background: none; cursor: pointer; font-size: 14px; border-radius: 4px; color: var(--c-dark); }
    .rt-pricing-dropdown button:hover { background: #F3F4F6; }
    .rt-pricing-dropdown button.active { background: var(--c-primary); color: #fff; }

    /* Category slider styles: voir partials/_category_slider.blade.php */

    /* ─────────── S135 2026-07-23 : badge écosystème (regroupement par éditeur) ─────────── */
    /* Contraste vérifié AAA (wcag-mcp) : #3730A3 sur #EEF2FF = 8.88:1 */
    .rt-badge-eco {
        display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; min-height: 22px;
        border-radius: 4px; font-size: 10.5px; font-weight: 700; background: #EEF2FF; color: #3730A3;
        text-decoration: none; letter-spacing: 0.1px; transition: background-color 0.15s;
    }
    .rt-badge-eco:hover { background: #E0E7FF; color: #3730A3; text-decoration: none; }
    .rt-pill-eco-active { background: #3730A3 !important; color: #fff !important; }

    /* ─────────── S135 : dropdown "Trier par" (remplace la rangée de tabs, desktop) ─────────── */
    .rt-sort-dropdown-btn {
        display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 8px 16px;
        border-radius: var(--r-btn); background: #F3F4F6; color: var(--c-dark); font-weight: 600;
        font-size: 14px; border: none; cursor: pointer; transition: background-color 0.2s;
    }
    .rt-sort-dropdown-btn:hover { background: #E5E7EB; }
    .rt-sort-dropdown-btn.active { background: var(--c-primary); color: #fff; }
    .rt-sort-dropdown-menu {
        position: absolute; top: 100%; left: 0; z-index: 50; background: #fff; border: 1px solid #E5E7EB;
        border-radius: var(--r-base); box-shadow: 0 8px 25px rgba(0,0,0,0.1); padding: 6px; min-width: 220px; margin-top: 4px;
    }
    .rt-sort-dropdown-menu button {
        display: flex; align-items: center; width: 100%; text-align: left; padding: 8px 12px; min-height: 44px;
        border: none; background: none; cursor: pointer; font-size: 14px; border-radius: 4px; color: var(--c-dark);
    }
    .rt-sort-dropdown-menu button:hover { background: #F3F4F6; }
    .rt-sort-dropdown-menu button.active { background: var(--c-primary); color: #fff; }

    /* ─────────── S135 : bouton "Filtres/Tri" mobile + tiroir bottom-sheet ─────────── */
    .rt-mobile-filter-trigger { display: none; margin-bottom: 16px; }
    .rt-mobile-filter-btn {
        display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 10px 20px;
        border-radius: var(--r-btn); background: #fff; border: 1.5px solid var(--c-primary); color: var(--c-primary);
        font-weight: 700; font-size: 14px; cursor: pointer; width: 100%; justify-content: center;
    }
    .rt-mobile-filter-btn.has-active { background: var(--c-primary); color: #fff; }
    .rt-sheet-overlay {
        position: fixed; inset: 0; z-index: 9998; background: rgba(17,20,23,0.5);
        display: flex; align-items: flex-end; justify-content: center;
    }
    .rt-sheet {
        background: #fff; width: 100%; max-height: 85vh; overflow-y: auto; border-radius: 16px 16px 0 0;
        padding: 14px 20px calc(20px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -8px 30px rgba(0,0,0,0.2);
    }
    .rt-sheet-handle { width: 40px; height: 4px; background: #E5E7EB; border-radius: 2px; margin: 0 auto 14px; }
    .rt-sheet-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .rt-sheet-header h2 { font-family: var(--f-heading); font-size: 1.05rem; font-weight: 700; color: var(--c-dark); margin: 0; }
    .rt-sheet-close { min-width: 44px; min-height: 44px; background: none; border: none; font-size: 20px; color: #374151; cursor: pointer; border-radius: 8px; }
    .rt-sheet-close:hover { background: #F3F4F6; }
    .rt-sheet-section-title { font-weight: 700; color: var(--c-dark); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; margin: 18px 0 8px; }
    .rt-sheet-row-btn {
        display: flex; align-items: center; width: 100%; text-align: left; min-height: 44px; padding: 10px 14px;
        border-radius: 10px; border: 1.5px solid #E5E7EB; background: #fff; font-size: 14px; font-weight: 600;
        color: var(--c-dark); cursor: pointer; margin-bottom: 8px;
    }
    .rt-sheet-row-btn.active { background: var(--c-primary); color: #fff; border-color: var(--c-primary); }
    .rt-sheet-cats { display: flex; flex-wrap: wrap; gap: 8px; }
    .rt-sheet-cat-chip {
        flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; min-height: 44px; padding: 8px 14px;
        border-radius: 20px; background: #F3F4F6; color: var(--c-dark); font-weight: 600; font-size: 13px;
        border: none; cursor: pointer;
    }
    .rt-sheet-cat-chip.active { background: var(--c-primary); color: #fff; }
    .rt-sheet-active-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-bottom: 4px; }
    .rt-sheet-chip {
        display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 6px 14px;
        border-radius: 20px; background: #F0F4F8; color: var(--c-dark); font-weight: 600; font-size: 13px;
        border: none; cursor: pointer;
    }
    .rt-sheet-clear-all {
        background: none; border: 1.5px solid var(--c-accent); color: var(--c-accent); min-height: 44px;
        padding: 6px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; cursor: pointer;
    }

    @media (max-width: 767px) {
        .rt-desktop-only-filters { display: none !important; }
        .rt-mobile-filter-trigger { display: block; }
    }

    .rt-sort-dropdown-btn:focus-visible,
    .rt-mobile-filter-btn:focus-visible,
    .rt-sheet-close:focus-visible,
    .rt-sheet-row-btn:focus-visible,
    .rt-sheet-cat-chip:focus-visible,
    .rt-sheet-chip:focus-visible,
    .rt-sheet-clear-all:focus-visible,
    .rt-badge-eco:focus-visible,
    .rt-sort-dropdown-menu button:focus-visible {
        outline: 3px solid #0B7285;
        outline-offset: 2px;
        border-radius: 4px;
    }
</style>
@endpush

@section('content')
<div x-data="{
    search: '',
    activePricing: '',
    activeCategory: '',
    // S135 2026-07-23 : filtre \u00e9cosyst\u00e8me (badge \u00e9diteur sur carte). Pr\u00e9-rempli depuis ?ecosystem=
    // pour un lien partageable/deep-link (ex. depuis la fiche outil, page recharg\u00e9e s\u00e9par\u00e9ment).
    activeEcosystem: (typeof window !== 'undefined' ? (new URLSearchParams(window.location.search)).get('ecosystem') : null) || '',
    eduFilter: false,
    sortBy: 'all',
    tools: {{ $toolsJson->toJson() }},
    displayCount: 30,
    _lastFilterKey: '',

    // Donn\u00e9es pour l'affichage des chips actives (tiroir mobile) \u2014 \u00e9vite la r\u00e9p\u00e9tition PHP inline.
    categoryNamesBySlug: @js($categoryNamesBySlug),
    pricingLabelsMap: @js($pricingOptions),
    ecosystemLabelsMap: @js($ecosystemLabels),

    // S135 : tiroir mobile Filtres/Tri
    mobileFiltersOpen: false,
    sortLabels: {
        all: '{{ __('Tous') }}',
        rating: '\u2b50 {{ __('Populaires') }}',
        newest: '\ud83c\udd95 {{ __('R\u00e9cents') }}',
        free: '\ud83c\udd93 {{ __('Gratuits') }}',
        edu: '\ud83c\udf93 {{ __('\u00c9ducation') }}',
    },
    get sortDropdownKey() {
        if (this.eduFilter) return 'edu';
        if (this.activePricing === 'free') return 'free';
        if (this.sortBy === 'rating') return 'rating';
        if (this.sortBy === 'newest') return 'newest';
        return 'all';
    },
    get activeFilterCount() {
        let n = 0;
        if (this.activeCategory) n++;
        if (this.activePricing) n++;
        if (this.activeEcosystem) n++;
        if (this.eduFilter) n++;
        if (this.sortBy !== 'all') n++;
        return n;
    },
    // Trap clavier basique du tiroir mobile (Tab boucle entre 1er et dernier \u00e9l\u00e9ment focusable).
    trapSheetTab(e) {
        const root = this.$refs.mobileSheet;
        if (!root) return;
        const focusables = root.querySelectorAll('button, a[href], input, select, textarea, [tabindex]');
        if (focusables.length === 0) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    },

    get filterKey() { return this.search + '|' + this.activePricing + '|' + this.activeCategory + '|' + this.activeEcosystem + '|' + this.eduFilter + '|' + this.sortBy; },

    get filteredTools() {
        const key = this.filterKey;
        if (key !== this._lastFilterKey) { this.displayCount = 30; this._lastFilterKey = key; }
        const norm = v => (v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const s = norm(this.search);
        let t = this.tools.filter(t => {
            const matchSearch = !s || norm(t.name).includes(s) || norm(t.shortDesc).includes(s);
            const matchPricing = !this.activePricing || (this.activePricing === 'education' ? t.hasEduPricing : t.pricing === this.activePricing);
            const matchCat = !this.activeCategory || t.categorySlugs.includes(this.activeCategory);
            const matchEco = !this.activeEcosystem || t.ecosystemTag === this.activeEcosystem;
            const matchEdu = !this.eduFilter || t.hasEduPricing;
            return matchSearch && matchPricing && matchCat && matchEco && matchEdu;
        });
        if (this.sortBy === 'rating') return [...t].sort((a,b) => b.avgRating - a.avgRating);
        if (this.sortBy === 'newest') return [...t].sort((a,b) => b.createdTs - a.createdTs);
        return t;
    },

    get visibleTools() { return this.filteredTools.slice(0, this.displayCount); },
    get hasMore() { return this.displayCount < this.filteredTools.length; },
    loadMore() { if (this.hasMore) this.displayCount += 30; },

    get isEducationContext() {
        return this.eduFilter || this.activePricing === 'education' || (new URLSearchParams(window.location.search)).get('pricing') === 'education';
    },

    togglePricing(p) { this.activePricing = this.activePricing === p ? '' : p; },
    toggleCategory(c) { this.activeCategory = this.activeCategory === c ? '' : c; },
    toggleEcosystem(tag) { this.activeEcosystem = this.activeEcosystem === tag ? '' : tag; },
    setSort(s) {
        if (s === 'free') { this.activePricing = 'free'; this.sortBy = 'all'; }
        else { this.sortBy = s; if (this.activePricing === 'free') this.activePricing = ''; }
    },
    resetAll() { this.search = ''; this.activePricing = ''; this.activeCategory = ''; this.activeEcosystem = ''; this.eduFilter = false; this.sortBy = 'all'; },

    // S84 #27 – Toggle vue cards/list + persistance localStorage
    viewMode: (typeof window !== 'undefined' && localStorage.getItem('directory_view_mode')) || 'cards',
    listSortField: 'name', listSortDir: 'asc',
    setViewMode(m) {
        this.viewMode = m;
        try { localStorage.setItem('directory_view_mode', m); } catch(e) {}
        if (m === 'list') this.displayCount = Math.max(this.displayCount, 100);
    },
    listSort(field) {
        if (this.listSortField === field) { this.listSortDir = this.listSortDir === 'asc' ? 'desc' : 'asc'; }
        else { this.listSortField = field; this.listSortDir = 'asc'; }
    },
    get listTools() {
        const f = this.listSortField, d = this.listSortDir === 'asc' ? 1 : -1;
        const t = [...this.filteredTools];
        t.sort((a, b) => {
            let va = a[f], vb = b[f];
            if (f === 'name' || f === 'pricingLabel' || f === 'lifecycleLabel') { va = (va || '').toString().toLowerCase(); vb = (vb || '').toString().toLowerCase(); }
            if (va < vb) return -1 * d;
            if (va > vb) return 1 * d;
            return 0;
        });
        return t.slice(0, this.displayCount);
    }
}">

    {{-- Hero + wizard wrapper --}}
    <div x-data="{
        wStep: 0, submitted: false, submittedMessage: '', scraping: false, submitting: false,
        scrapeError: '', duplicates: [],
        toolUrl: '', toolName: '', toolDesc: '', toolShortDesc: '', toolPricing: '', screenshotUrl: '',
        hasEducationPricing: false, educationPricingType: '', educationPricingDetails: '', educationPricingUrl: '',
        selectedCollections: [], newCollectionName: '',
        collectionToastShow: false, collectionToastMessage: '',
        authEmail: '', authCode: '', authSending: false, authVerifying: false, authSent: false, authError: '',
        async analyzeUrl() {
            if (!this.toolUrl || this.scraping) return;
            this.scraping = true; this.scrapeError = ''; this.duplicates = [];
            try {
                const res = await fetch('{{ route('directory.scrape-detect') }}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content, 'Accept': 'application/json' },
                    body: JSON.stringify({ url: this.toolUrl })
                });
                if (!res.ok) { const e = await res.json(); throw new Error(e.error || '{{ __('Erreur lors de l analyse.') }}'); }
                const d = await res.json();
                this.toolName = d.translated_name || d.original_name || '';
                this.toolDesc = d.translated_description || d.original_description || '';
                this.toolShortDesc = (d.translated_description || '').substring(0, 200);
                this.screenshotUrl = d.screenshot || '';
                if (d.duplicates && d.duplicates.length > 0) { this.duplicates = d.duplicates; }
                else { this.wStep = 2; }
            } catch(e) { this.scrapeError = e.message; }
            finally { this.scraping = false; }
        },
        async submitTool() {
            if (!this.toolName || !this.toolPricing || this.submitting) return;
            this.submitting = true; this.scrapeError = '';
            try {
                const res = await fetch('{{ route('directory.submit') }}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content, 'Accept': 'application/json' },
                    body: JSON.stringify({ url: this.toolUrl, name: this.toolName, description: this.toolDesc, short_description: this.toolShortDesc, pricing: this.toolPricing, screenshot: this.screenshotUrl, has_education_pricing: this.hasEducationPricing, education_pricing_type: this.educationPricingType, education_pricing_details: this.educationPricingDetails, education_pricing_url: this.educationPricingUrl, collection_ids: this.selectedCollections, new_collection_name: this.newCollectionName, 'cf-turnstile-response': document.querySelector('[name=cf-turnstile-response]')?.value ?? '' })
                });
                const d = await res.json();
                if (d.auth_required) { this.wStep = 3; this.authError = ''; }
                else if (d.success) {
                    const hadNewCollection = this.newCollectionName && this.newCollectionName.trim().length > 0;
                    const hadSelectedCollections = this.selectedCollections && this.selectedCollections.length > 0;
                    if (hadNewCollection) { this.collectionToastMessage = '{{ __('Collection créée et outil proposé avec succès !') }}'; this.collectionToastShow = true; setTimeout(() => { this.collectionToastShow = false; }, 5000); }
                    else if (hadSelectedCollections) { this.collectionToastMessage = '{{ __('Outil ajouté à vos collections.') }}'; this.collectionToastShow = true; setTimeout(() => { this.collectionToastShow = false; }, 4000); }
                    this.submittedMessage = d.message || '{{ __('Soumission reçue.') }}';
                    this.submitted = true; this.wStep = 0;
                }
                else { this.scrapeError = d.message || '{{ __('Erreur lors de la soumission.') }}'; }
            } catch(e) { this.scrapeError = '{{ __('Erreur réseau.') }}'; }
            finally { this.submitting = false; }
        },
        async sendMagicLink() {
            if (!this.authEmail || this.authSending) return;
            this.authSending = true; this.authError = '';
            try {
                const res = await fetch('{{ route('magic-link.api.send') }}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content, 'Accept': 'application/json' },
                    body: JSON.stringify({ email: this.authEmail })
                });
                const d = await res.json();
                if (d.success) { this.authSent = true; }
                else { this.authError = d.message; }
            } catch(e) { this.authError = '{{ __('Erreur réseau.') }}'; }
            finally { this.authSending = false; }
        },
        async verifyCode() {
            if (!this.authCode || this.authCode.length !== 6 || this.authVerifying) return;
            this.authVerifying = true; this.authError = '';
            try {
                const res = await fetch('{{ route('magic-link.api.verify') }}', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]').content, 'Accept': 'application/json' },
                    body: JSON.stringify({ email: this.authEmail, token: this.authCode })
                });
                const d = await res.json();
                if (d.success) { this.submitTool(); }
                else { this.authError = d.message; }
            } catch(e) { this.authError = '{{ __('Erreur réseau.') }}'; }
            finally { this.authVerifying = false; }
        },
        resetWizard() { this.wStep = 0; this.toolUrl = ''; this.toolName = ''; this.toolDesc = ''; this.toolShortDesc = ''; this.toolPricing = ''; this.screenshotUrl = ''; this.duplicates = []; this.scrapeError = ''; this.selectedCollections = []; this.newCollectionName = ''; this.authEmail = ''; this.authCode = ''; this.authSent = false; this.authError = ''; }
    }" x-init="$watch('wStep', v => { $nextTick(() => { if (v === 1) document.querySelector('input[x-model=\'toolUrl\']')?.focus(); else if (v === 2) document.querySelector('input[x-model=\'toolName\']')?.focus(); else if (v === 3) { if (!authSent) document.querySelector('input[x-model=\'authEmail\']')?.focus(); else document.querySelector('input[x-model=\'authCode\']')?.focus(); } }) })">
    <div x-show="collectionToastShow" x-cloak x-transition.duration.300ms
         role="status" aria-live="polite"
         style="position: fixed; bottom: 24px; right: 24px; z-index: 9999; background: #fff; border-left: 4px solid var(--c-primary, #064E5A); box-shadow: 0 10px 25px rgba(0,0,0,0.15); border-radius: 8px; padding: 14px 18px; display: flex; align-items: center; gap: 10px; max-width: 360px; font-size: 14px; color: #111827;">
        <span style="font-size: 20px;">✅</span>
        <div style="flex: 1;">
            <div style="font-weight: 700; margin-bottom: 2px;" x-text="collectionToastMessage"></div>
            @auth
            @if(Route::has('collections.my'))
            <a href="{{ route('collections.my') }}" style="font-size: 12px; color: var(--c-primary, #064E5A); text-decoration: none; font-weight: 600;">{{ __('Voir mes collections') }} →</a>
            @endif
            @endauth
        </div>
        <button type="button" @click="collectionToastShow = false" aria-label="{{ __('Fermer') }}" style="background: none; border: none; cursor: pointer; font-size: 18px; color: #374151; line-height: 1; padding: 0;">×</button>
    </div>
    <div class="rt-hero">
        <div class="container text-center">
            <h1>{{ __('Répertoire techno') }}</h1>
            <p style="color: #374151; font-size: 1.1rem; margin-bottom: 16px;">
                <strong x-text="tools.length" style="color: var(--c-primary);"></strong> {{ __('outils sélectionnés pour vous.') }}
            </p>

            {{-- 2026-05-05 #137 : toggle outils archives (cache par defaut, accessible via lien) --}}
            @if(($archivedCount ?? 0) > 0)
                @if($showArchived ?? false)
                    <p style="color:#374151;font-size:0.85rem;margin-bottom:12px;">
                        <span style="display:inline-block;background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:4px;font-weight:600;font-size:0.75rem;">{{ __('Affichage archivés activé') }}</span>
                        <a href="{{ route('directory.index') }}" style="color:var(--c-primary);text-decoration:underline;margin-left:8px;">{{ __('Cacher les archivés') }}</a>
                    </p>
                @else
                    <p style="color:#6b7280;font-size:0.8rem;margin-bottom:12px;">
                        <a href="{{ route('directory.index') }}?show_archived=1" style="color:#6b7280;text-decoration:underline;" title="{{ __('Outils archivés en avril 2026 – contenu HN/blog/vidéo crawlé à tort, pas de vrais outils SaaS') }}">
                            🗄️ {{ __('Voir les') }} {{ $archivedCount }} {{ __('outils archivés') }}
                        </a>
                    </p>
                @endif
            @endif

            {{-- Bouton proposer (visible etape 0) — auth requise --}}
            <div x-show="wStep === 0 && !submitted" style="margin-bottom: 20px;">
                @auth
                <button type="button" @click="wStep = 1"
                    style="background: var(--c-primary); color: #fff; font-weight: 600; padding: 10px 24px; border-radius: var(--r-btn); border: none; cursor: pointer; font-size: 14px; transition: all 0.2s;"
                    onmouseover="this.style.background='var(--c-dark)'" onmouseout="this.style.background='var(--c-primary)'">
                    + {{ __('Proposer un outil') }}
                </button>
                @else
                <a href="{{ route('login') }}" @click.prevent="$dispatch('open-auth-modal', { message: '{{ __('Connectez-vous pour proposer un outil') }}' })"
                    style="display: inline-block; background: var(--c-primary); color: #fff; font-weight: 600; padding: 10px 24px; border-radius: var(--r-btn); cursor: pointer; font-size: 14px; text-decoration: none; transition: all 0.2s;"
                    onmouseover="this.style.background='var(--c-dark)'" onmouseout="this.style.background='var(--c-primary)'">
                    + {{ __('Proposer un outil') }}
                </a>
                @endauth
            </div>

            {{-- Succes --}}
            <div x-show="submitted" x-cloak x-transition style="margin-bottom: 20px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
                <span style="background: #D1FAE5; color: #065F46; padding: 10px 24px; border-radius: var(--r-btn); font-size: 14px; font-weight: 600;">
                    ✓ <span x-text="submittedMessage"></span>
                </span>
                <button type="button" @click="submitted=false;wStep=1;toolUrl='';toolName='';toolDesc='';toolShortDesc='';toolPricing='';screenshotUrl='';scrapeError='';duplicates=[]" style="padding:8px 20px;background:#fff;color:var(--c-primary);border:2px solid var(--c-primary);border-radius:var(--r-btn);font-weight:600;cursor:pointer;font-size:13px;">{{ __('Soumettre un autre outil') }}</button>
            </div>

            {{-- Etape 1 : URL --}}
            <div x-show="wStep === 1" x-cloak x-transition.duration.300ms
                 style="margin-bottom: 20px; background: rgba(11,114,133,0.08); border: 2px solid var(--c-primary); border-radius: var(--r-base); padding: 24px; max-width: 600px; margin-left: auto; margin-right: auto;">
                <div style="font-size: 11px; color: #374151; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 1px;">{{ __('Étape 1 sur 2 – URL du site') }}</div>
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                    <input type="url" x-model="toolUrl" autocomplete="url" placeholder="https://chatgpt.com" aria-label="{{ __('URL du site a proposer') }}"
                        style="flex: 1; min-width: 240px; height: 44px; padding: 0 14px; border: 2px solid #E5E7EB; border-radius: var(--r-base); font-size: 15px; background: #fff; color: var(--c-dark); outline: none;"
                        @keydown.enter="analyzeUrl()">
                    <button type="button" @click="analyzeUrl()" :disabled="scraping || !toolUrl"
                        :style="'height:44px;padding:0 20px;background:var(--c-primary);color:#fff;font-weight:700;border:none;border-radius:var(--r-btn);cursor:pointer;font-size:14px;white-space:nowrap;transition:all 0.2s;display:inline-flex;align-items:center;justify-content:center;line-height:1;' + (scraping || !toolUrl ? 'opacity:0.5;cursor:not-allowed;' : '')">
                        <span x-show="!scraping">{{ __('Analyser') }} →</span>
                        <span x-show="scraping" x-data="{dots:''}" x-init="setInterval(()=>{dots=dots.length>=3?'':dots+'.'},400)" style="display:inline-flex;align-items:center;gap:10px;line-height:1"><span style="width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;display:inline-block;animation:wsp .6s linear infinite;flex-shrink:0"></span><span>{{ __('Analyse en cours') }}<span x-text="dots" style="display:inline-block;width:1.2em;text-align:left"></span></span></span>
                        <style>@keyframes wsp{to{transform:rotate(360deg)}}</style>
                    </button>
                </div>

                {{-- Doublons detectes --}}
                <template x-if="duplicates.length > 0">
                    <div style="margin-top: 14px; background: #FEF3C7; border: 1px solid #F59E0B; border-radius: var(--r-base); padding: 14px; text-align: left;">
                        <strong style="color: #92400E;">⚠️ {{ __('Cet outil semble déjà dans notre répertoire :') }}</strong>
                        <template x-for="dup in duplicates" :key="dup.id">
                            <div style="margin-top: 6px;">
                                <a :href="'/annuaire/' + dup.slug" target="_blank" style="color: #92400E; font-weight: 600;" x-text="dup.name"></a>
                                <span style="font-size: 12px; color: #B45309;" x-text="'(' + dup.confidence + ')'"></span>
                            </div>
                        </template>
                        <button type="button" @click="duplicates = []; wStep = 2;" style="margin-top: 10px; background: #F59E0B; color: #fff; border: none; padding: 6px 16px; border-radius: var(--r-btn); font-weight: 600; font-size: 13px; cursor: pointer;">
                            {{ __('Proposer quand même') }}
                        </button>
                    </div>
                </template>

                {{-- Erreur --}}
                <div x-show="scrapeError && duplicates.length === 0" x-cloak role="alert" aria-live="assertive" style="margin-top: 10px; color: #DC2626; font-size: 13px;" x-text="scrapeError"></div>

                <div style="text-align: right; margin-top: 8px;">
                    <button type="button" @click="resetWizard()" style="background: none; border: none; color: #134e4a; cursor: pointer; font-size: 12px; text-decoration: underline;">{{ __('Annuler') }}</button>
                </div>
            </div>

            <div class="rt-search" x-show="wStep === 0">
                <svg class="rt-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                {{-- 2026-07-09 : debounce 200ms — évite de recalculer filteredTools (~391 outils, filtre + x-for + images)
                     à CHAQUE frappe. La saisie native du champ n'est jamais affectée (le navigateur affiche le texte
                     immédiatement) ; seul le filtrage réactif est différé, ce qui élimine le jank ressenti comme un
                     "rechargement" de la page sur les gros catalogues. --}}
                <input type="text" class="rt-search-input" x-model.debounce.200ms="search"
                       placeholder="{{ __('Rechercher un outil, une catégorie...') }}"
                       aria-label="{{ __('Rechercher un outil') }}">
            </div>
        </div>
    </div>

    {{-- Etape 2 : Details (card blanche sous hero) --}}
    <div x-show="wStep === 2" x-cloak x-transition.duration.400ms
         style="background: #fff; border: 2px solid #E5E7EB; border-radius: var(--r-base); padding: 28px; max-width: 800px; margin: -10px auto 24px; box-shadow: 0 4px 15px rgba(0,0,0,0.06);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div>
                <span style="font-size: 11px; color: #374151; text-transform: uppercase; letter-spacing: 1px;">{{ __('Étape 2 sur 2 – Détails') }}</span>
                <h2 style="font-family: var(--f-heading); color: var(--c-dark); margin: 4px 0 0; font-size: 16px;">
                    {{ __('Complétez les informations pour') }} <strong x-text="toolName" style="color: var(--c-primary);"></strong>
                </h2>
            </div>
            <button type="button" @click="wStep = 1" style="background: none; border: none; color: var(--c-primary); cursor: pointer; font-size: 13px; font-weight: 600;">← {{ __('Retour') }}</button>
        </div>

        <div class="row">
            <div class="col-md-8">
                <div style="margin-bottom: 14px;">
                    <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Nom de l\'outil') }} <span style="color: #B91C1C;">*</span></label>
                    <input type="text" x-model="toolName" required aria-required="true" aria-label="{{ __('Nom de l\'outil') }}"
                        style="width: 100%; height: 40px; padding: 0 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; outline: none; color: var(--c-dark);">
                </div>
                <div style="margin-bottom: 14px;">
                    <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Description courte') }}</label>
                    <input type="text" x-model="toolShortDesc" maxlength="255" aria-label="{{ __('Description courte') }}"
                        style="width: 100%; height: 40px; padding: 0 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; outline: none; color: var(--c-dark);">
                </div>
                <div style="margin-bottom: 14px;">
                    <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Description') }}</label>
                    <textarea x-model="toolDesc" rows="4" aria-label="{{ __('Description complete') }}"
                        style="width: 100%; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; outline: none; resize: vertical; color: var(--c-dark);"></textarea>
                </div>
                <div style="margin-bottom: 14px;">
                    <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Modèle économique') }} <span style="color: #B91C1C;">*</span></label>
                    <select x-model="toolPricing" required aria-required="true" aria-label="{{ __('Modèle économique') }}"
                        style="width: 100%; height: 40px; padding: 0 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; background: #fff; color: var(--c-dark);">
                        <option value="">{{ __('Choisir...') }}</option>
                        <option value="free">🆓 {{ __('Gratuit') }}</option>
                        <option value="freemium">💎 {{ __('Freemium') }}</option>
                        <option value="paid">💰 {{ __('Payant') }}</option>
                        <option value="open_source">🔓 {{ __('Open source') }}</option>
                        <option value="enterprise">🏢 {{ __('Entreprise') }}</option>
                    </select>
                </div>

                {{-- Tarif éducation enseignants (optionnel) --}}
                <div style="margin-bottom: 14px;">
                    <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 4px;">
                        <input type="checkbox" x-model="hasEducationPricing" id="education-pricing-toggle" style="margin-top: 2px; accent-color: var(--c-primary); cursor: pointer;">
                        <label for="education-pricing-toggle" style="font-weight: 600; color: var(--c-dark); font-size: 13px; cursor: pointer; line-height: 1.4;">
                            🎓 {{ __('Cet outil offre un tarif spécial ou gratuit pour enseignants/étudiants') }}
                        </label>
                    </div>
                    <p style="font-size: 12px; color: #374151; margin: 0 0 10px 0; line-height: 1.4;">
                        💡 {{ __('Coche cette case si l\'outil propose un programme éducation (tarif réduit, gratuit avec courriel @.edu, etc.)') }}
                    </p>

                    <template x-if="hasEducationPricing">
                        <div style="border: 1px solid #E5E7EB; border-radius: var(--r-base); padding: 14px; background: #F9FAFB; margin-top: 6px;">
                            <div style="margin-bottom: 14px;">
                                <label for="education-pricing-type" style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Type de tarif éducation') }}</label>
                                <select id="education-pricing-type" x-model="educationPricingType" style="width: 100%; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; outline: none; color: var(--c-dark); background: #fff; cursor: pointer;">
                                    <option value="">{{ __('Choisir...') }}</option>
                                    <option value="free">{{ __('Gratuit pour enseignants') }}</option>
                                    <option value="discount">{{ __('Tarif réduit / Programme éducation') }}</option>
                                </select>
                            </div>
                            <div style="margin-bottom: 14px;">
                                <label for="education-pricing-details" style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Détails du programme éducation') }}</label>
                                <textarea id="education-pricing-details" x-model="educationPricingDetails" rows="2" placeholder="{{ __('Ex: 50% de réduction avec courriel @.edu | Gratuit jusqu\'à 30 élèves | Plan Plus offert aux étudiants') }}" style="width: 100%; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; outline: none; color: var(--c-dark); resize: vertical;"></textarea>
                            </div>
                            <div>
                                <label for="education-pricing-url" style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Lien vers la page éducation (optionnel)') }}</label>
                                <input type="url" id="education-pricing-url" x-model="educationPricingUrl" placeholder="https://exemple.com/education" style="width: 100%; padding: 10px 12px; border: 1px solid #E5E7EB; border-radius: var(--r-base); font-size: 14px; outline: none; color: var(--c-dark);">
                            </div>
                        </div>
                    </template>
                </div>

                {{-- Ajouter à mes collections (optionnel) --}}
                <div style="margin-top: 6px; margin-bottom: 14px;">
                    <label style="display: block; font-weight: 600; color: var(--c-dark); font-size: 13px; margin-bottom: 4px;">
                        📂 {{ __('Ajouter à mes collections') }}
                        <span style="font-weight: 400; font-size: 12px; color: #374151;">({{ __('optionnel') }})</span>
                    </label>
                    <p style="font-size: 12px; color: #374151; margin: 0 0 10px 0; line-height: 1.4;">
                        {{ __('Classe cet outil dans une ou plusieurs de tes collections (privées par défaut).') }}
                    </p>
                    @auth
                        @if(isset($userCollections) && $userCollections->count() > 0)
                            <div style="max-height: 110px; overflow-y: auto; border: 1px solid #E5E7EB; border-radius: var(--r-base); padding: 8px 10px; background: #fff; margin-bottom: 10px;">
                                @foreach($userCollections as $collection)
                                    <label
                                        style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; margin: 3px 4px 3px 0; border-radius: 9999px; font-size: 12px; cursor: pointer; user-select: none; transition: all .15s;"
                                        :style="selectedCollections.includes({{ $collection->id }})
                                            ? 'background: rgba(11,114,133,0.12); border: 1px solid var(--c-primary); color: var(--c-primary); font-weight: 600;'
                                            : 'background: #F9FAFB; border: 1px solid #E5E7EB; color: #374151; font-weight: 400;'"
                                    >
                                        <input type="checkbox" value="{{ $collection->id }}" x-model.number="selectedCollections" style="display: none;">
                                        <span x-show="selectedCollections.includes({{ $collection->id }})" style="color: var(--c-primary); font-size: 13px;">✓</span>
                                        <span>{{ $collection->name }}</span>
                                        <span style="font-size: 10px; color: #374151; margin-left: 2px;" title="{{ $collection->is_public ? __('Publique') : __('Privée') }}">{{ $collection->is_public ? '🌐' : '🔒' }}</span>
                                    </label>
                                @endforeach
                            </div>
                        @endif
                    @endauth
                    <input type="text" x-model="newCollectionName" maxlength="100"
                        placeholder="{{ __('Ou créer une nouvelle collection privée...') }}"
                        aria-label="{{ __('Nom de la nouvelle collection') }}"
                        style="width: 100%; height: 38px; background: #fff; border: 1px solid #E5E7EB; padding: 0 12px; border-radius: var(--r-base); font-size: 13px; color: var(--c-dark); outline: none;">
                </div>
            </div>
            <div class="col-md-4 text-center">
                <template x-if="screenshotUrl">
                    <div style="margin-bottom: 14px;">
                        <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Apercu') }}</label>
                        <img :src="screenshotUrl" :alt="toolName" loading="lazy" style="max-width: 100%; max-height: 200px; object-fit: cover; border-radius: var(--r-base); border: 1px solid #E5E7EB;">
                    </div>
                </template>
                <div style="font-size: 12px; color: #374151; margin-top: 8px;">
                    <span x-text="toolUrl" style="word-break: break-all;"></span>
                </div>
            </div>
        </div>

        {{-- Erreur --}}
        <div x-show="scrapeError" x-cloak role="alert" aria-live="assertive" style="margin-top: 10px; color: #DC2626; font-size: 13px;" x-text="scrapeError"></div>

        {{-- Ticket #1868 - Turnstile invisible (aucun défi visuel, conforme WCAG 2.2 AAA
             3.3.9), même mode que Modules/Authors/resources/views/components/newsletter-optin
             .blade.php. Rendu UNIQUEMENT si les clés Cloudflare existent ET le coupe-circuit
             directory.turnstile.enabled est actif - $turnstileSiteKey vaut null sinon (voir
             le bloc PHP en tête de fichier), donc rien n'est ajouté au DOM tant que ce n'est
             pas configuré côté Cloudflare. --}}
        @if($turnstileSiteKey)
        <div class="cf-turnstile" data-sitekey="{{ $turnstileSiteKey }}" data-size="invisible" data-action="directory-submit"></div>
        @endif

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
            <button type="button" @click="resetWizard()" style="background: #F3F4F6; color: var(--c-dark); border: none; padding: 10px 20px; border-radius: var(--r-btn); font-weight: 600; font-size: 14px; cursor: pointer;">
                {{ __('Annuler') }}
            </button>
            <button type="button" @click="submitTool()" :disabled="!toolName || !toolPricing || submitting"
                :style="'padding:10px 24px;background:var(--c-primary);color:#fff;font-weight:700;border:none;border-radius:var(--r-btn);cursor:pointer;font-size:14px;transition:all 0.2s;' + (!toolName || !toolPricing || submitting ? 'opacity:0.5;cursor:not-allowed;' : '')">
                <span x-show="!submitting">{{ __('Soumettre la proposition') }}</span>
                <span x-show="submitting" x-data="{dots:''}" x-init="setInterval(()=>{dots=dots.length>=3?'':dots+'.'},400)" style="display:inline-flex;align-items:center;gap:6px"><span style="width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;display:inline-block;animation:wsp .6s linear infinite"></span><span>{{ __('Soumission en cours') }}<span x-text="dots" style="display:inline-block;width:1.2em;text-align:left"></span></span></span>
            </button>
        </div>
    </div>

    {{-- Etape 3 : Auth inline (expand) --}}
    <div x-show="wStep === 3" x-cloak x-transition.duration.400ms
         style="background: #fff; border: 2px solid var(--c-primary); border-radius: var(--r-base); padding: 28px; max-width: 500px; margin: -10px auto 24px; box-shadow: 0 4px 15px rgba(11,114,133,0.1);">
        <div style="text-align: center; margin-bottom: 16px;">
            <div style="font-size: 28px; margin-bottom: 8px;">🔐</div>
            <h3 style="font-family: var(--f-heading); color: var(--c-dark); margin: 0 0 4px; font-size: 16px;">{{ __('Connexion requise') }}</h3>
            <p style="color: #374151; font-size: 13px; margin: 0;">{{ __('Connectez-vous pour soumettre votre proposition. Votre formulaire est sauvegardé.') }}</p>
        </div>

        {{-- Email input --}}
        <div x-show="!authSent" style="margin-bottom: 14px;">
            <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Adresse courriel') }}</label>
            <div style="display: flex; gap: 8px;">
                <input type="email" x-model="authEmail" autocomplete="email" placeholder="vous@exemple.com" aria-label="{{ __('Adresse courriel') }}"
                    @keydown.enter="sendMagicLink()"
                    style="flex: 1; height: 42px; padding: 0 14px; border: 2px solid #E5E7EB; border-radius: var(--r-base); font-size: 15px; outline: none; color: var(--c-dark);">
                <button type="button" @click="sendMagicLink()" :disabled="authSending || !authEmail"
                    :style="'height:42px;padding:0 20px;background:var(--c-primary);color:#fff;font-weight:700;border:none;border-radius:var(--r-btn);cursor:pointer;font-size:14px;white-space:nowrap;' + (authSending || !authEmail ? 'opacity:0.5;cursor:not-allowed;' : '')">
                    <span x-show="!authSending">{{ __('Envoyer le code') }}</span>
                    <span x-show="authSending">⏳</span>
                </button>
            </div>
        </div>

        {{-- OTP code input --}}
        <div x-show="authSent" x-transition>
            <div style="background: #D1FAE5; color: #065F46; padding: 10px 14px; border-radius: var(--r-base); font-size: 13px; margin-bottom: 14px;">
                ✓ {{ __('Code envoyé à') }} <strong x-text="authEmail"></strong>. {{ __('Vérifiez vos courriels.') }}
            </div>
            <label style="display: block; font-weight: 600; color: var(--c-dark); margin-bottom: 4px; font-size: 13px;">{{ __('Code à 6 chiffres') }}</label>
            <div style="display: flex; gap: 8px;">
                <input type="text" x-model="authCode" maxlength="6" placeholder="000000" aria-label="{{ __('Code de connexion') }}" autocomplete="one-time-code" inputmode="numeric"
                    @keydown.enter="verifyCode()" @input="if(authCode.length === 6) verifyCode()"
                    style="flex: 1; height: 42px; padding: 0 14px; border: 2px solid #E5E7EB; border-radius: var(--r-base); font-size: 20px; font-weight: 700; letter-spacing: 8px; text-align: center; outline: none; color: var(--c-dark);">
                <button type="button" @click="verifyCode()" :disabled="authVerifying || authCode.length !== 6"
                    :style="'height:42px;padding:0 20px;background:var(--c-primary);color:#fff;font-weight:700;border:none;border-radius:var(--r-btn);cursor:pointer;font-size:14px;white-space:nowrap;' + (authVerifying || authCode.length !== 6 ? 'opacity:0.5;cursor:not-allowed;' : '')">
                    <span x-show="!authVerifying">{{ __('Valider') }}</span>
                    <span x-show="authVerifying">⏳</span>
                </button>
            </div>
            <button type="button" @click="authSent = false; authCode = ''" style="background: none; border: none; color: var(--c-primary); cursor: pointer; font-size: 12px; margin-top: 8px;">{{ __('Renvoyer le code') }}</button>
        </div>

        {{-- Error --}}
        <div x-show="authError" x-cloak role="alert" aria-live="assertive" style="margin-top: 10px; color: #DC2626; font-size: 13px;" x-text="authError"></div>

        <div style="text-align: center; margin-top: 14px;">
            <button type="button" @click="wStep = 2; authError = ''" style="background: none; border: none; color: #374151; cursor: pointer; font-size: 12px;">← {{ __('Retour au formulaire') }}</button>
        </div>
    </div>
    </div>

    {{-- Highlights : recents + populaires (masqué quand recherche active) --}}
    <div class="container" x-show="!search" x-transition>
        @include('directory::public.partials._highlights')
    </div>

    <div class="container" style="padding-top: 30px; padding-bottom: 40px;">

        {{-- Filters bar : Tous + dropdown pricing + badge écosystème actif + compteur --}}
        <div class="rt-filter-bar">
            <button type="button" class="rt-pill" :class="{ active: !activePricing && !activeCategory && !activeEcosystem }" @click="resetAll()">{{ __('Tous') }}</button>

            <div x-data="{ open: false }" @keydown.escape="open = false; $refs.toggle.focus()" style="position: relative; display: inline-block;">
                <button type="button" class="rt-pill" :class="{ active: activePricing !== '' }" @click="open = !open"
                        x-ref="toggle"
                        aria-haspopup="true"
                        :aria-expanded="open.toString()"
                        aria-controls="rt-pricing-menu">
                    <span x-show="!activePricing">💰 Tarification <i class="ti-angle-down"></i></span>
                    <span x-show="activePricing" x-cloak x-text="({free:'🆓 Gratuit',freemium:'💎 Freemium',paid:'💰 Payant',open_source:'🔓 Open source',enterprise:'🏢 Enterprise',education:'🎓 Tarif éducation'})[activePricing]"></span>
                </button>
                <div x-show="open" @click.outside="open = false" x-cloak
                     id="rt-pricing-menu"
                     role="menu"
                     class="rt-pricing-dropdown">
                    @foreach($pricingOptions as $key => $label)
                        <button type="button" role="menuitem"
                                @click="togglePricing('{{ $key }}'); open = false; $refs.toggle.focus()"
                                :class="{ 'active': activePricing === '{{ $key }}' }">
                            {{ $pricingEmojis[$key] ?? '' }} {{ $label }}
                        </button>
                    @endforeach
                    <button type="button" role="menuitem"
                            @click="activePricing = ''; open = false; $refs.toggle.focus()" x-show="activePricing">
                        <i class="ti-close"></i> {{ __('Effacer') }}
                    </button>
                </div>
            </div>

            {{-- S135 : badge écosystème actif (visible seulement si un clic sur un badge carte / lien ?ecosystem= l'a défini) --}}
            <button type="button" class="rt-pill rt-pill-eco-active" x-show="activeEcosystem" x-cloak
                    @click="activeEcosystem = ''"
                    :aria-label="'{{ __('Retirer le filtre éditeur') }} : ' + (ecosystemLabelsMap[activeEcosystem] || activeEcosystem)">
                <span x-text="ecosystemLabelsMap[activeEcosystem] || activeEcosystem"></span> <i class="ti-close" aria-hidden="true" style="font-size:10px;margin-left:4px;"></i>
            </button>

            <span class="rt-filter-count"><strong x-text="filteredTools.length" style="color: var(--c-primary);"></strong> {{ __('outils') }}</span>
        </div>

        {{-- S135 2026-07-23 : dropdown "Trier par" + carrousel catégories — masqués sur mobile derrière le bouton "Filtres/Tri" ci-dessous --}}
        <div class="rt-desktop-only-filters">
            {{-- Category slider (partial réutilisable) --}}
            @include('directory::public.partials._category_slider', [
                'categories' => $categories,
                'currentRoute' => 'index',
                'activeSlug' => null,
            ])
        </div>

        {{-- S135 : bouton "Filtres/Tri (N)" — mobile uniquement, ouvre le tiroir bottom-sheet --}}
        <div class="rt-mobile-filter-trigger">
            <button type="button" class="rt-mobile-filter-btn" :class="{ 'has-active': activeFilterCount > 0 }"
                    @click="mobileFiltersOpen = true"
                    x-ref="mobileFilterTrigger"
                    aria-haspopup="dialog"
                    :aria-expanded="mobileFiltersOpen.toString()"
                    aria-controls="rt-mobile-filters-sheet">
                🔧 {{ __('Filtres/Tri') }} <span x-show="activeFilterCount > 0" x-text="'(' + activeFilterCount + ')'"></span>
            </button>
        </div>

        {{-- S135 : tiroir bottom-sheet mobile — regroupe tri + catégories + chips actifs --}}
        <div x-show="mobileFiltersOpen" x-cloak
             class="rt-sheet-overlay"
             @click.self="mobileFiltersOpen = false"
             @keydown.escape.window="mobileFiltersOpen = false"
             x-transition.opacity>
            <div class="rt-sheet"
                 id="rt-mobile-filters-sheet"
                 x-ref="mobileSheet"
                 role="dialog"
                 aria-modal="true"
                 aria-labelledby="rt-mobile-filters-title"
                 @keydown.tab="trapSheetTab($event)"
                 x-init="$watch('mobileFiltersOpen', v => { if (v) { $nextTick(() => $refs.mobileSheetClose && $refs.mobileSheetClose.focus()) } else { $refs.mobileFilterTrigger && $refs.mobileFilterTrigger.focus() } })">
                <div class="rt-sheet-handle" aria-hidden="true"></div>
                <div class="rt-sheet-header">
                    <h2 id="rt-mobile-filters-title">{{ __('Filtres et tri') }}</h2>
                    <button type="button" class="rt-sheet-close" x-ref="mobileSheetClose" @click="mobileFiltersOpen = false" aria-label="{{ __('Fermer') }}">✕</button>
                </div>

                {{-- Chips actives + tout effacer --}}
                <div class="rt-sheet-active-chips" x-show="activeFilterCount > 0">
                    <template x-if="activeCategory">
                        <button type="button" class="rt-sheet-chip" @click="toggleCategory(activeCategory)">
                            <span x-text="categoryNamesBySlug[activeCategory] || activeCategory"></span> ✕
                        </button>
                    </template>
                    <template x-if="activePricing">
                        <button type="button" class="rt-sheet-chip" @click="togglePricing(activePricing)">
                            <span x-text="pricingLabelsMap[activePricing] || activePricing"></span> ✕
                        </button>
                    </template>
                    <template x-if="activeEcosystem">
                        <button type="button" class="rt-sheet-chip" @click="toggleEcosystem(activeEcosystem)">
                            <span x-text="ecosystemLabelsMap[activeEcosystem] || activeEcosystem"></span> ✕
                        </button>
                    </template>
                    <template x-if="eduFilter">
                        <button type="button" class="rt-sheet-chip" @click="eduFilter = false">🎓 {{ __('Éducation') }} ✕</button>
                    </template>
                    <template x-if="sortBy === 'rating'">
                        <button type="button" class="rt-sheet-chip" @click="setSort('all')">⭐ {{ __('Populaires') }} ✕</button>
                    </template>
                    <template x-if="sortBy === 'newest'">
                        <button type="button" class="rt-sheet-chip" @click="setSort('all')">🆕 {{ __('Récents') }} ✕</button>
                    </template>
                    <button type="button" class="rt-sheet-clear-all" @click="resetAll()">{{ __('Tout effacer') }}</button>
                </div>

                <h3 class="rt-sheet-section-title">{{ __('Trier par') }}</h3>
                <button type="button" class="rt-sheet-row-btn" :class="{ active: sortDropdownKey === 'all' }" @click="setSort('all')">{{ __('Tous') }}</button>
                <button type="button" class="rt-sheet-row-btn" :class="{ active: sortDropdownKey === 'rating' }" @click="setSort('rating')">⭐ {{ __('Populaires') }}</button>
                <button type="button" class="rt-sheet-row-btn" :class="{ active: sortDropdownKey === 'newest' }" @click="setSort('newest')">🆕 {{ __('Récents') }}</button>
                <button type="button" class="rt-sheet-row-btn" :class="{ active: sortDropdownKey === 'free' }" @click="setSort('free')">🆓 {{ __('Gratuits') }}</button>
                <button type="button" class="rt-sheet-row-btn" :class="{ active: eduFilter }" @click="eduFilter = !eduFilter">🎓 {{ __('Éducation') }}</button>

                @if($categories->isNotEmpty())
                <h3 class="rt-sheet-section-title">{{ __('Catégories') }}</h3>
                <div class="rt-sheet-cats">
                    @foreach($categories as $cat)
                        <button type="button" class="rt-sheet-cat-chip"
                                :class="{ active: activeCategory === '{{ $cat->slug }}' }"
                                @click="toggleCategory('{{ $cat->slug }}')">
                            {{ $cat->icon ?? '' }} {{ $cat->name }}
                        </button>
                    @endforeach
                </div>
                @endif
            </div>
        </div>

        {{-- S90 #43 Phase 2 — Bouton alerte catégorie réactif (apparaît uniquement quand une catégorie est filtrée).
             Désactivé tant que Phase 3 (cron weekly digest + email Brevo) n'est pas livrée.
             Réactiver via DIRECTORY_CATEGORY_ALERTS_ENABLED=true dans .env. --}}
        @if(config('directory.category_alerts.enabled', false))
        <div
            x-data="{
                catNames: @js($categoryNamesBySlug),
                loading: false,
                authenticated: false,
                subscribed: false,
                message: '',
                error: '',
                loginUrl: @js(route('login')),
                async refreshStatus() {
                    if (!this.activeCategory) { this.subscribed = false; this.error = ''; this.message = ''; return; }
                    this.loading = true; this.error = '';
                    try {
                        const res = await fetch('/annuaire/categorie/' + encodeURIComponent(this.activeCategory) + '/alerte/statut', { headers: { 'Accept': 'application/json' } });
                        const data = await res.json();
                        this.authenticated = !!data.authenticated;
                        this.subscribed = !!data.subscribed;
                    } catch (e) {
                        this.error = '{{ __('Statut indisponible.') }}';
                    } finally {
                        this.loading = false;
                    }
                },
                async toggleAlert() {
                    if (!this.activeCategory) return;
                    if (!this.authenticated) {
                        window.location.href = this.loginUrl + '?redirect_to=' + encodeURIComponent(window.location.href);
                        return;
                    }
                    this.loading = true; this.message = ''; this.error = '';
                    try {
                        const res = await fetch('/annuaire/categorie/' + encodeURIComponent(this.activeCategory) + '/alerte', {
                            method: 'POST',
                            headers: {
                                'Accept': 'application/json',
                                'Content-Type': 'application/json',
                                'X-CSRF-TOKEN': document.querySelector('meta[name=csrf-token]')?.content || '',
                                'X-Requested-With': 'XMLHttpRequest',
                            },
                            credentials: 'same-origin',
                        });
                        const data = await res.json();
                        if (data.success) {
                            this.subscribed = !!data.subscribed;
                            this.message = data.message || '';
                            setTimeout(() => { this.message = ''; }, 3500);
                        } else {
                            this.error = data.message || '{{ __('Erreur') }}';
                            if (data.login_url) window.location.href = data.login_url + '?redirect_to=' + encodeURIComponent(window.location.href);
                        }
                    } catch (e) {
                        this.error = '{{ __('Erreur réseau') }}';
                    } finally {
                        this.loading = false;
                    }
                }
            }"
            x-init="$watch('activeCategory', () => refreshStatus()); refreshStatus()"
            x-show="activeCategory"
            x-cloak
            x-transition.opacity
            role="region"
            aria-live="polite"
            style="display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 14px 18px; margin-bottom: 16px; background: linear-gradient(135deg, rgba(6,78,90,0.04) 0%, rgba(154,42,6,0.03) 100%); border: 1px solid rgba(6,78,90,0.18); border-radius: var(--r-base);"
        >
            <span style="font-size: 14px; color: var(--c-dark); font-weight: 600;">
                🔔 <span x-text="subscribed ? '{{ __('Vous êtes alerté pour') }} : ' : '{{ __('Recevoir un récap hebdo des nouveautés de cette catégorie ?') }}'"></span>
                <strong x-text="catNames[activeCategory] || activeCategory" style="color: var(--c-primary, #064E5A);"></strong>
            </span>
            <button
                type="button"
                @click="toggleAlert()"
                :disabled="loading"
                :aria-pressed="subscribed"
                x-bind:title="subscribed ? '{{ __('Désactiver les alertes') }}' : '{{ __('Activer les alertes hebdomadaires') }}'"
                style="display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 18px; border-radius: 999px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; border: 1.5px solid; margin-left: auto;"
                :style="subscribed
                    ? 'background: var(--c-primary, #064E5A); color: #fff; border-color: var(--c-primary, #064E5A);'
                    : 'background: #fff; color: var(--c-primary, #064E5A); border-color: var(--c-primary, #064E5A);'"
            >
                <span x-show="!loading && !subscribed" aria-hidden="true">🔔</span>
                <span x-show="!loading && subscribed" aria-hidden="true">✓</span>
                <span x-show="loading" aria-hidden="true">⏳</span>
                <span x-show="!loading && !authenticated">{{ __("Recevoir les alertes") }}</span>
                <span x-show="!loading && authenticated && !subscribed">{{ __("M'alerter") }}</span>
                <span x-show="!loading && authenticated && subscribed">{{ __('Alertes actives') }}</span>
                <span x-show="loading">{{ __('Chargement…') }}</span>
            </button>
            <span x-show="message" x-cloak x-transition style="font-size: 13px; color: #14532d; font-weight: 600; flex-basis: 100%;" role="status" aria-live="polite" x-text="message"></span>
            <span x-show="error" x-cloak style="font-size: 13px; color: #991b1b; font-weight: 600; flex-basis: 100%;" role="alert" x-text="error"></span>
        </div>
        @endif

        {{-- Bandeau résultats de recherche (visible seulement quand recherche active) --}}
        <div x-show="search" x-cloak x-transition style="background: var(--c-primary-light); border: 1px solid var(--c-primary); border-radius: var(--r-base); padding: 12px 20px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
            <div>
                <span style="font-size: 15px; color: var(--c-dark);">
                    <strong x-text="filteredTools.length" style="color: var(--c-primary); font-size: 20px;"></strong>
                    <span x-text="filteredTools.length === 1 ? 'résultat pour' : 'résultats pour'"></span>
                    « <strong x-text="search" style="color: var(--c-primary);"></strong> »
                </span>
            </div>
            <button type="button" @click="search = ''" style="background: none; border: 1px solid var(--c-primary); color: var(--c-primary); padding: 4px 12px; border-radius: var(--r-btn); font-size: 13px; font-weight: 600; cursor: pointer;">
                <i class="ti-close" style="font-size: 10px;"></i> {{ __('Effacer') }}
            </button>
        </div>

        {{-- S135 : "Trier par" — dropdown compact (remplace la rangée de 5 onglets), desktop uniquement --}}
        <div class="rt-sort-bar rt-desktop-only-filters">
            <div x-data="{ open: false }" @keydown.escape="open = false; $refs.sortToggle.focus()" style="position: relative; display: inline-block;">
                <button type="button" class="rt-sort-dropdown-btn" :class="{ active: sortDropdownKey !== 'all' }" @click="open = !open"
                        x-ref="sortToggle"
                        aria-haspopup="true"
                        :aria-expanded="open.toString()"
                        aria-controls="rt-sort-menu">
                    {{ __('Trier par') }} : <span x-text="sortLabels[sortDropdownKey]"></span> <i class="ti-angle-down" aria-hidden="true"></i>
                </button>
                <div x-show="open" @click.outside="open = false" x-cloak
                     id="rt-sort-menu"
                     role="menu"
                     class="rt-sort-dropdown-menu">
                    <button type="button" role="menuitem" :class="{ active: sortDropdownKey === 'all' }" @click="setSort('all'); open = false; $refs.sortToggle.focus()">{{ __('Tous') }}</button>
                    <button type="button" role="menuitem" :class="{ active: sortDropdownKey === 'rating' }" @click="setSort('rating'); open = false; $refs.sortToggle.focus()">⭐ {{ __('Populaires') }}</button>
                    <button type="button" role="menuitem" :class="{ active: sortDropdownKey === 'newest' }" @click="setSort('newest'); open = false; $refs.sortToggle.focus()">🆕 {{ __('Récents') }}</button>
                    <button type="button" role="menuitem" :class="{ active: sortDropdownKey === 'free' }" @click="setSort('free'); open = false; $refs.sortToggle.focus()">🆓 {{ __('Gratuits') }}</button>
                    <button type="button" role="menuitem" :class="{ active: sortDropdownKey === 'edu' }" @click="eduFilter = !eduFilter; open = false; $refs.sortToggle.focus()">🎓 {{ __('Éducation') }}</button>
                </div>
            </div>
        </div>

        {{-- Mode sélection + comparer : reste visible desktop ET mobile (fonctionnalité distincte du tri/filtrage) --}}
        <div class="rt-sort-bar" style="border-bottom:none;margin-bottom:16px;">
            <button type="button"
                    class="rt-sort-tab"
                    x-data
                    @click="$store.compare.toggleMode()"
                    :class="$store.compare.selectionMode && 'rt-sort-active'"
                    :style="$store.compare.selectionMode ? 'background:rgba(6,78,90,0.08);color:var(--c-primary, #064E5A);border-color:var(--c-primary, #064E5A);' : ''"
                    :aria-pressed="$store.compare.selectionMode ? 'true' : 'false'"
                    >🎯 <span x-text="$store.compare.selectionMode ? '{{ __('Sélection active') }}' : '{{ __('Mode sélection') }}'"></span></button>
            @if($categories->isNotEmpty())
                <a x-show="$store.compare.count >= 2"
                   x-cloak
                   x-transition.opacity
                   :href="$store.compare.compareUrl"
                   class="rt-sort-tab"
                   style="text-decoration:none!important;background:var(--c-primary,#064E5A);color:#fff;border-radius:8px;padding:8px 16px;font-weight:700;margin-left:auto;">📊 {{ __('Comparer') }}<span x-text="' (' + $store.compare.count + ')'"></span></a>
            @endif
        </div>

        {{-- Bandeau d'aide visible UNIQUEMENT en mode sélection --}}
        <div class="lv-selection-help"
             x-data
             x-show="$store.compare.selectionMode"
             x-cloak
             x-transition.opacity
             role="status"
             aria-live="polite">
            <div class="lv-selection-help-text">
                @if($categories->isNotEmpty())
                    <span x-show="$store.compare.count === 0">{{ __('🎯 Cochez 2 à 4 outils dans la liste, puis cliquez Comparer.') }}</span>
                    <span x-show="$store.compare.count === 1" x-cloak>{{ __('Encore 1 outil minimum à sélectionner.') }} <span class="count">(<span x-text="$store.compare.count"></span>/<span x-text="$store.compare.max"></span>)</span></span>
                    <span x-show="$store.compare.count >= 2" x-cloak><span class="count">(<span x-text="$store.compare.count"></span>/<span x-text="$store.compare.max"></span>)</span> {{ __('outils sélectionnés. Prêt à comparer ?') }}</span>
                @endif
            </div>
            <a :href="$store.compare.compareUrl"
               class="btn"
               :aria-disabled="$store.compare.canCompare ? 'false' : 'true'"
               @click="if (!$store.compare.canCompare) $event.preventDefault();">📊 {{ __('Comparer maintenant') }}</a>
            @if($categories->isNotEmpty())
                <button type="button"
                        class="btn btn-secondary"
                        x-show="$store.compare.count === 0"
                        x-cloak
                        @click="window.location.href = '{{ route('directory.compare', $categories->first()->slug) }}'"
                        title="{{ __('Pré-remplir avec les 4 outils les plus populaires de la première catégorie') }}">
                    + {{ __('Top 4 :cat', ['cat' => $categories->first()->name]) }}
                </button>
            @endif
        </div>

        {{-- Section mise de l'avant (masqué quand recherche active) --}}
        @if(isset($featuredTools) && $featuredTools->isNotEmpty())
        @php
            $hasFeaturedEdu = $featuredTools->contains(fn($t) => $t->has_education_pricing || $t->pricing === 'education');
        @endphp
        <div x-show="!search && (!isEducationContext || {{ $hasFeaturedEdu ? 'true' : 'false' }})" x-transition style="background:linear-gradient(135deg,#f0fafb 0%,#e0f4f7 100%);border:1px solid #b2e0e6;border-radius:14px;padding:20px;margin-bottom:24px;">
            <div style="display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:14px;">
                <h3 style="font-family:var(--f-heading);font-weight:700;font-size:1.1rem;color:var(--c-dark);margin:0;">{{ __('En vedette') }}</h3>
                <span style="font-size:12px;color:#0B7285;font-weight:600;">{{ __('Sponsorise') }}</span>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;">
                @foreach($featuredTools as $ft)
                @php $ftHost = $ft->url ? parse_url($ft->url, PHP_URL_HOST) : ''; @endphp
                <a href="{{ $ft->getPublicUrl() }}" x-show="!isEducationContext || {{ $ft->has_education_pricing || $ft->pricing === 'education' ? 'true' : 'false' }}" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-decoration:none!important;color:inherit;transition:transform .2s,box-shadow .2s;box-shadow:0 2px 8px rgba(0,0,0,0.04);position:relative;">
                    {{-- 2026-05-05 #135 : badge YouTube rouge avec count tutos (visible coin haut-droit) --}}
                    @if(($ft->tutorials_count ?? 0) > 0)
                        <span style="position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;gap:4px;background:#0B7285;color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:4px;line-height:1.3;box-shadow:0 1px 3px rgba(0,0,0,.15);" title="{{ $ft->tutorials_count }} {{ $ft->tutorials_count > 1 ? __('tutoriels disponibles') : __('tutoriel disponible') }}">
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                            <span>{{ $ft->tutorials_count }} {{ $ft->tutorials_count > 1 ? __('tutos') : __('tuto') }}</span>
                        </span>
                    @endif
                    <div style="display:flex!important;align-items:center!important;gap:10px;margin-bottom:10px;">
                        @if($ftHost)<img src="https://www.google.com/s2/favicons?domain={{ $ftHost }}&sz=32" alt="" width="24" height="24" loading="lazy" style="border-radius:4px;" onerror="this.style.display='none'">@endif
                        <span style="font-weight:700;font-size:15px;">{{ $ft->name }}</span>
                    </div>
                    <p style="font-size:12px;color:#374151;margin:0 0 8px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">{{ Str::limit($ft->short_description, 70) }}</p>
                    @if($ft->categories->isNotEmpty())
                        <span style="display:inline-block;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;">{{ $ft->categories->first()->name }}</span>
                    @endif
                </a>
                @endforeach
            </div>
        </div>
        @endif

        {{-- S89-L-DRY : section "Tendance / Les plus consultés" supprimée (duplication de "Les plus populaires" — même variable $popularTools, même tri clicks_count). Badge "👁 N vues" intégré au _highlight_card pour préserver l'insight GA4 #E (S84). --}}

        {{-- Section trending : plus votés (masqué quand recherche active) --}}
        @if(isset($topVoted) && $topVoted->count() >= 5)
        <div style="margin-bottom:32px;" x-show="!search" x-transition>

            {{-- Plus votés par la communauté (minimum 5 outils votés pour afficher) --}}
            @if(isset($topVoted) && $topVoted->count() >= 5)
            <div>
                <div style="display:flex!important;justify-content:space-between!important;align-items:center!important;margin-bottom:12px;">
                    <h3 style="font-family:var(--f-heading);font-weight:700;font-size:1.1rem;color:var(--c-dark);margin:0;">🔥 {{ __('Les plus votés') }}</h3>
                </div>
                <div style="display:flex!important;gap:14px;overflow-x:auto;padding-bottom:8px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;">
                    @foreach($topVoted as $tv)
                    @php $tvHost = $tv->url ? parse_url($tv->url, PHP_URL_HOST) : ''; @endphp
                    <a href="{{ $tv->getPublicUrl() }}" style="flex-shrink:0;width:200px;scroll-snap-align:start;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;text-decoration:none!important;color:inherit;transition:transform .2s,box-shadow .2s;position:relative;">
                        {{-- 2026-05-05 #135 : badge YouTube rouge tutos --}}
                        @if(($tv->tutorials_count ?? 0) > 0)
                            <span style="position:absolute;top:8px;right:8px;display:inline-flex;align-items:center;gap:3px;background:#0B7285;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;line-height:1.2;" title="{{ $tv->tutorials_count }} {{ $tv->tutorials_count > 1 ? __('tutoriels') : __('tutoriel') }}">
                                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                                <span>{{ $tv->tutorials_count }}</span>
                            </span>
                        @endif
                        <div style="display:flex!important;align-items:center!important;gap:8px;margin-bottom:8px;">
                            @if($tvHost)<img src="https://www.google.com/s2/favicons?domain={{ $tvHost }}&sz=32" alt="" width="20" height="20" loading="lazy" style="border-radius:4px;" onerror="this.style.display='none'">@endif
                            <span style="font-weight:700;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">{{ $tv->name }}</span>
                        </div>
                        <div style="display:flex!important;align-items:center!important;gap:4px;margin-bottom:6px;">
                            <span style="color:#ef4444;font-weight:700;font-size:13px;">👍 {{ $tv->community_votes_count }}</span>
                            <span style="color:#374151;font-size:11px;">{{ __('votes') }}</span>
                        </div>
                        <p style="font-size:12px;color:#374151;margin:0;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">{{ Str::limit($tv->short_description, 60) }}</p>
                    </a>
                    @endforeach
                </div>
            </div>
            @endif
        </div>
        @endif

        {{-- Ad: directory top --}}
        @if(class_exists(\Modules\Ads\Services\AdsRenderer::class))
            {!! app(\Modules\Ads\Services\AdsRenderer::class)->render('directory-top') !!}
        @endif

        {{-- S84 #27 — Toggle vue Cards/Liste --}}
        <div class="rt-view-toggle" role="group" aria-label="{{ __('Mode d\'affichage') }}" style="display:flex;justify-content:flex-end;gap:0.4rem;margin-bottom:1rem;">
            <button type="button" @click="setViewMode('cards')"
                :aria-pressed="viewMode === 'cards' ? 'true' : 'false'"
                :style="'display:inline-flex;align-items:center;gap:6px;padding:0.5rem 0.85rem;border-radius:8px;border:1.5px solid var(--c-primary, #064E5A);font-weight:600;font-size:0.85rem;cursor:pointer;transition:all 0.15s;' + (viewMode === 'cards' ? 'background:var(--c-primary, #064E5A);color:#fff;' : 'background:transparent;color:var(--c-primary, #064E5A);')">
                📇 {{ __('Cartes') }}
            </button>
            <button type="button" @click="setViewMode('list')"
                :aria-pressed="viewMode === 'list' ? 'true' : 'false'"
                :style="'display:inline-flex;align-items:center;gap:6px;padding:0.5rem 0.85rem;border-radius:8px;border:1.5px solid var(--c-primary, #064E5A);font-weight:600;font-size:0.85rem;cursor:pointer;transition:all 0.15s;' + (viewMode === 'list' ? 'background:var(--c-primary, #064E5A);color:#fff;' : 'background:transparent;color:var(--c-primary, #064E5A);')">
                📋 {{ __('Liste') }}
            </button>
        </div>

        {{-- S84 #27 — Vue Liste type Google Sheets --}}
        <div x-show="viewMode === 'list'" x-cloak style="overflow-x:auto;margin-bottom:2rem;border:1px solid #E5E7EB;border-radius:12px;background:#fff;">
            <table class="rt-list-table" style="width:100%;border-collapse:collapse;font-size:0.875rem;">
                <caption class="sr-only">{{ __('Liste des outils du répertoire – triable par colonne') }}</caption>
                <thead style="background:#F9FAFB;position:sticky;top:0;z-index:5;">
                    <tr>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-weight:700;color:var(--c-dark, #1A1D23);width:48px;">{{ __('Logo') }}</th>
                        <th scope="col" @click="listSort('name')" :aria-sort="listSortField === 'name' ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none'" style="padding:10px 12px;text-align:left;font-weight:700;color:var(--c-dark, #1A1D23);cursor:pointer;user-select:none;border-bottom:2px solid #E5E7EB;">
                            {{ __('Nom') }} <span x-text="listSortField === 'name' ? (listSortDir === 'asc' ? '↑' : '↓') : '↕'" style="opacity:0.6;font-size:0.75rem;"></span>
                        </th>
                        <th scope="col" style="padding:10px 12px;text-align:left;font-weight:700;color:var(--c-dark, #1A1D23);border-bottom:2px solid #E5E7EB;">{{ __('Description') }}</th>
                        <th scope="col" @click="listSort('pricingLabel')" :aria-sort="listSortField === 'pricingLabel' ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none'" style="padding:10px 12px;text-align:left;font-weight:700;color:var(--c-dark, #1A1D23);cursor:pointer;user-select:none;border-bottom:2px solid #E5E7EB;white-space:nowrap;">
                            {{ __('Tarif') }} <span x-text="listSortField === 'pricingLabel' ? (listSortDir === 'asc' ? '↑' : '↓') : '↕'" style="opacity:0.6;font-size:0.75rem;"></span>
                        </th>
                        <th scope="col" @click="listSort('lifecycleLabel')" :aria-sort="listSortField === 'lifecycleLabel' ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none'" style="padding:10px 12px;text-align:left;font-weight:700;color:var(--c-dark, #1A1D23);cursor:pointer;user-select:none;border-bottom:2px solid #E5E7EB;white-space:nowrap;">
                            {{ __('Statut') }} <span x-text="listSortField === 'lifecycleLabel' ? (listSortDir === 'asc' ? '↑' : '↓') : '↕'" style="opacity:0.6;font-size:0.75rem;"></span>
                        </th>
                        <th scope="col" @click="listSort('avgRating')" :aria-sort="listSortField === 'avgRating' ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none'" style="padding:10px 12px;text-align:left;font-weight:700;color:var(--c-dark, #1A1D23);cursor:pointer;user-select:none;border-bottom:2px solid #E5E7EB;white-space:nowrap;">
                            {{ __('Note') }} <span x-text="listSortField === 'avgRating' ? (listSortDir === 'asc' ? '↑' : '↓') : '↕'" style="opacity:0.6;font-size:0.75rem;"></span>
                        </th>
                        <th scope="col" style="padding:10px 12px;text-align:right;font-weight:700;color:var(--c-dark, #1A1D23);border-bottom:2px solid #E5E7EB;">{{ __('Actions') }}</th>
                    </tr>
                </thead>
                <tbody>
                    <template x-for="tool in listTools" :key="tool.id">
                        <tr :style="'border-bottom:1px solid #F3F4F6;transition:background 0.1s, opacity 0.2s, filter 0.2s;' + (tool.isLifecycleDown ? 'opacity:0.6;filter:grayscale(0.7);background:#F9FAFB;' : '')" onmouseover="this.style.background='#FAFBFC'" onmouseout="this.style.background= (this.dataset.down === '1' ? '#F9FAFB' : 'transparent')" :data-down="tool.isLifecycleDown ? '1' : '0'">
                            <td style="padding:8px 12px;">
                                <template x-if="tool.favicon"><img :src="tool.favicon" :alt="tool.name + ' logo'" loading="lazy" width="32" height="32" style="border-radius:6px;" onerror="this.style.display='none'"></template>
                            </td>
                            <td style="padding:8px 12px;font-weight:600;">
                                <a :href="tool.showUrl" x-text="tool.name" style="color:var(--c-primary, #064E5A);text-decoration:none;"></a>
                                <template x-if="tool.isFeatured"><span style="margin-left:6px;font-size:0.7rem;background:#FEF3C7;color:#92400E;padding:1px 6px;border-radius:4px;">★</span></template>
                            </td>
                            <td style="padding:8px 12px;color:var(--c-text-muted, #52586a);max-width:380px;">
                                <span x-text="tool.shortDesc" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;"></span>
                            </td>
                            <td style="padding:8px 12px;white-space:nowrap;">
                                <span class="rt-badge" :class="'badge-' + tool.pricing" x-text="tool.pricingLabel" style="font-size:0.7rem;"></span>
                            </td>
                            <td style="padding:8px 12px;white-space:nowrap;">
                                <template x-if="tool.isLifecycleActive">
                                    <span style="color:var(--sys-success, #047857);font-size:0.75rem;font-weight:600;">● {{ __('Actif') }}</span>
                                </template>
                                <template x-if="!tool.isLifecycleActive">
                                    <span :style="'color:' + tool.lifecycleColor + ';font-size:0.75rem;font-weight:600;'" x-text="'● ' + tool.lifecycleLabel"></span>
                                </template>
                            </td>
                            <td style="padding:8px 12px;white-space:nowrap;">
                                <template x-if="tool.avgRating > 0">
                                    <span style="color:#F59E0B;font-weight:700;">★ <span x-text="tool.avgRating"></span></span>
                                </template>
                                <template x-if="tool.avgRating === 0">
                                    <span style="color:var(--c-text-muted, #52586a);font-size:0.75rem;">–</span>
                                </template>
                            </td>
                            <td style="padding:8px 12px;text-align:right;white-space:nowrap;">
                                <button type="button"
                                        class="lv-cmp-toggle lv-cmp-toggle--card"
                                        :class="{ 'is-active': $store.compare.has(tool.id) }"
                                        :data-cmp-card-id="tool.id"
                                        @click.stop.prevent="$store.compare.toggle(tool.id, tool.name, tool.screenshot || tool.favicon); $store.compare.bounce(tool.id)"
                                        :aria-pressed="$store.compare.has(tool.id) ? 'true' : 'false'"
                                        style="margin-right:6px;font-size:11px;padding:4px 10px;min-height:28px;">
                                    <span x-show="!$store.compare.has(tool.id)">+ {{ __('Comparer') }}</span>
                                    <span x-show="$store.compare.has(tool.id)" x-cloak>✓</span>
                                </button>
                                <a :href="tool.showUrl" style="display:inline-block;padding:4px 10px;background:#F3F4F6;color:var(--c-dark, #1A1D23);font-size:0.75rem;font-weight:600;border-radius:6px;text-decoration:none;margin-right:4px;">{{ __('Détails') }}</a>
                                <template x-if="tool.url">
                                    <a :href="tool.url" target="_blank" rel="noopener noreferrer nofollow" style="display:inline-block;padding:4px 10px;background:var(--c-primary, #064E5A);color:#fff;font-size:0.75rem;font-weight:600;border-radius:6px;text-decoration:none;">{{ __('Visiter') }} ↗</a>
                                </template>
                            </td>
                        </tr>
                    </template>
                </tbody>
            </table>
        </div>

        {{-- Grid (Cards) --}}
        <div class="row row-flex" x-show="viewMode === 'cards'">
            <template x-for="(tool, idx) in visibleTools" :key="tool.id">
                <div class="col-lg-4 col-md-6 col-xs-12">
                    <article class="rt-card"
                             :class="{ 'is-down': tool.isLifecycleDown, 'is-selected': $store.compare.has(tool.id) }"
                             :aria-label="tool.isLifecycleDown ? tool.name + ' – ' + tool.lifecycleBannerMsg : tool.name">
                        {{-- S89 v1.3.0 : onboarding tooltip pulse 1ère card uniquement, 1ère visite --}}
                        <template x-if="idx === 0 && !$store.compare.onboardingShown && !$store.compare.has(tool.id) && $store.compare.count === 0">
                            <div class="lv-cmp-onboarding" role="status" aria-live="polite">
                                💡 {{ __('Sélectionne 2 outils ou plus pour les comparer côte à côte') }}
                                <div>
                                    <button type="button" class="lv-cmp-onboarding-dismiss" @click.stop="$store.compare.markOnboarded()">
                                        {{ __('Compris') }}
                                    </button>
                                </div>
                            </div>
                        </template>
                        <template x-if="tool.isLifecycleDown">
                            <div class="rt-card-down-banner" :class="{'is-scam': tool.lifecycleStatus === 'scam'}" role="status">
                                <i :class="'fa ' + tool.lifecycleIconFa" aria-hidden="true"></i>
                                <span x-text="tool.lifecycleBannerMsg"></span>
                            </div>
                        </template>

                        <template x-if="tool.isFeatured && !tool.isLifecycleDown"><span class="rt-featured">{{ __('En vedette') }}</span></template>

                        <template x-if="!tool.isLifecycleActive && !tool.isLifecycleDown">
                            <span :style="'position:absolute;top:12px;right:12px;z-index:4;display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:11px;font-weight:600;color:#fff;border-radius:999px;white-space:nowrap;line-height:1.3;box-shadow:0 2px 6px rgba(0,0,0,.25);background-color:' + tool.lifecycleColor + 'F2;'"
                                  :aria-label="'Statut : ' + tool.lifecycleLabel"
                                  :title="tool.lifecycleLabel">
                                <i :class="'fa ' + tool.lifecycleIconFa" aria-hidden="true" style="font-size:inherit"></i>
                                <span x-text="tool.lifecycleLabel"></span>
                            </span>
                        </template>
                        <a :href="tool.showUrl" aria-hidden="true" tabindex="-1" style="display: block; margin: -24px -24px 12px; overflow: hidden; border-radius: var(--r-base) var(--r-base) 0 0; height: 140px; border-bottom: 1px solid #E5E7EB; position: relative;">
                            <template x-if="tool.screenshot">
                                <div style="position: relative; height: 140px;">
                                    <img :src="tool.screenshot" :alt="tool.name" loading="lazy" style="width: 100%; height: 140px; object-fit: cover; display: block;"
                                         onerror="this.onerror=null; this.src='/images/directory-fallback.svg';">
                                    <div style="position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.55) 100%); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.08);"></div>
                                </div>
                            </template>
                            <template x-if="!tool.screenshot">
                                <div :style="'width:100%;height:140px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,' + tool.gradientFrom + ' 0%,' + tool.gradientTo + ' 100%);'">
                                    <div style="text-align: center; color: rgba(255,255,255,0.9);">
                                        <template x-if="tool.favicon"><img :src="tool.favicon" alt="" aria-hidden="true" style="width: 40px; height: 40px; border-radius: 10px; margin-bottom: 6px; background: rgba(255,255,255,0.2); padding: 4px;" loading="lazy" onerror="this.style.display='none'"></template>
                                        <div style="font-family: var(--f-heading); font-weight: 700; font-size: 1rem; text-shadow: 0 1px 3px rgba(0,0,0,0.3);" x-text="tool.name"></div>
                                    </div>
                                </div>
                            </template>
                        </a>

                        <div style="display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px;">
                            <template x-if="tool.favicon"><img :src="tool.favicon" alt="" aria-hidden="true" class="rt-logo" loading="lazy" width="48" height="48" onerror="this.style.display='none'"></template>
                            <div>
                                <h3 class="rt-card-name"><a :href="tool.showUrl" x-text="tool.name"></a></h3>
                                {{-- S135 2026-07-23 : badge écosystème discret (regroupement par éditeur, ex. "OpenAI · 6 produits").
                                     Silencieux si l'outil n'a pas d'ecosystem_tag. Comptes pré-agrégés côté serveur (voir @php en tête
                                     de fichier) : aucune requête par carte. Lien réel (fonctionne sans JS / ouverture nouvel onglet) qui
                                     bascule le filtre client-side existant (même mécanisme que les catégories/tri, pas de rechargement). --}}
                                <template x-if="tool.ecosystemBadge">
                                    <a :href="'{{ route('directory.index') }}?ecosystem=' + tool.ecosystemTag"
                                       class="rt-badge-eco"
                                       x-text="tool.ecosystemBadge"
                                       :aria-label="'{{ __('Voir tous les outils de cet éditeur') }} : ' + tool.ecosystemBadge"
                                       @click="if (!($event.metaKey || $event.ctrlKey || $event.shiftKey || $event.button === 1)) { $event.preventDefault(); toggleEcosystem(tool.ecosystemTag); }"></a>
                                </template>
                                <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px;">
                                    <span class="rt-badge" :class="'badge-' + tool.pricing" x-text="tool.pricingLabel"></span>
                                    <template x-if="tool.hasEduPricing"><span style="background:#ecfdf5;color:#065f46;font-size:10px;padding:2px 8px;border-radius:4px;font-weight:600;">🎓 {{ __('Éducation') }}</span></template>
                                    <template x-if="tool.launchYear > 0"><span style="color: #374151; font-size: 0.75rem;" x-text="'🚀 ' + tool.launchYear"></span></template>
                                    {{-- 2026-05-05 #135 : badge rouge YouTube branded - visibilite max, coherent avec featured/topVoted --}}
                                    <template x-if="tool.tutorialsCount > 0">
                                        <a :href="tool.showUrl + '#tutoriels'"
                                           :aria-label="tool.tutorialsCount + ' ' + (tool.tutorialsCount > 1 ? '{{ __('tutoriels disponibles') }}' : '{{ __('tutoriel disponible') }}')"
                                           :title="tool.tutorialsCount + ' ' + (tool.tutorialsCount > 1 ? '{{ __('tutoriels disponibles') }}' : '{{ __('tutoriel disponible') }}')"
                                           style="display:inline-flex;align-items:center;gap:4px;color:#fff;font-size:0.75rem;font-weight:700;text-decoration:none;background:#0B7285;padding:3px 8px;border-radius:4px;line-height:1.3;min-height:22px;box-shadow:0 1px 3px rgba(0,0,0,.15);"
                                           onmouseover="this.style.background='#064E5C';" onmouseout="this.style.background='#0B7285';">
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                                            <span x-text="tool.tutorialsCount + ' ' + (tool.tutorialsCount > 1 ? '{{ __('tutos') }}' : '{{ __('tuto') }}')"></span>
                                        </a>
                                    </template>
                                    {{-- S142 2026-08-28 : compteur de vues - reprise exacte du badge de _highlight_card.blade.php (même style inline, même icône, même format) --}}
                                    <template x-if="tool.clicksCount > 0">
                                        <span style="display:inline-flex;align-items:center;gap:3px;color:var(--c-text-muted, #52586a);font-size:11px;font-weight:600;" :title="tool.clicksCountFormatted + ' {{ __('vues') }}'">
                                            👁 <span x-text="tool.clicksCountFormatted"></span>
                                        </span>
                                    </template>
                                </div>
                            </div>
                        </div>

                        <p class="rt-desc" x-text="tool.shortDesc"></p>

                        <template x-if="tool.categories.length > 0">
                            <div style="margin-bottom: 12px;">
                                <template x-for="cat in tool.categories.slice(0,2)" :key="cat">
                                    <span class="rt-tag" x-text="'#' + cat"></span>
                                </template>
                            </div>
                        </template>

                        <div class="rt-actions">
                            <template x-if="tool.avgRating > 0"><span class="rt-stars">★ <span x-text="tool.avgRating"></span></span></template>
                            <a :href="tool.showUrl" class="rt-btn-details" :aria-label="'{{ __('Détails de') }} ' + tool.name">{{ __('Détails') }}</a>
                            <template x-if="tool.url"><a :href="tool.url" target="_blank" rel="noopener noreferrer nofollow" class="rt-btn-visit" style="margin-left: auto;">{{ __('Visiter') }} →</a></template>
                        </div>
                        {{-- v1.3.0 Option C : bouton textuel explicite (pattern Capterra 9.8/10) --}}
                        <button type="button"
                                class="lv-cmp-toggle lv-cmp-toggle--card"
                                :class="{ 'is-active': $store.compare.has(tool.id) }"
                                :data-cmp-card-id="tool.id"
                                @click.stop.prevent="$store.compare.toggle(tool.id, tool.name, tool.screenshot || tool.favicon); $store.compare.bounce(tool.id)"
                                :aria-pressed="$store.compare.has(tool.id) ? 'true' : 'false'"
                                style="width:100%;margin-top:10px;">
                            <span x-show="!$store.compare.has(tool.id)">+ {{ __('Ajouter au comparateur') }}</span>
                            <span x-show="$store.compare.has(tool.id)" x-cloak>✓ {{ __('Dans le comparateur') }}</span>
                        </button>
                    </article>
                </div>
            </template>
        </div>

        {{-- Ad: directory bottom --}}
        @if(class_exists(\Modules\Ads\Services\AdsRenderer::class))
            {!! app(\Modules\Ads\Services\AdsRenderer::class)->render('directory-bottom') !!}
        @endif

        {{-- Sentinel : charge plus au scroll --}}
        <div x-show="hasMore" x-intersect="loadMore()" class="text-center" style="padding: 24px 0;" role="status" aria-label="{{ __('Chargement en cours') }}">
            <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid #E5E7EB; border-top-color: var(--c-primary); border-radius: 50%; animation: spin 0.6s linear infinite;"></div>
        </div>

        {{-- Empty --}}
        <div x-show="filteredTools.length === 0" x-cloak>
            <div class="rt-empty">
                <template x-if="isEducationContext">
                    <div>
                        <div style="font-size: 40px; margin-bottom: 10px;">🎓</div>
                        <h3 style="font-family: var(--f-heading); color: var(--c-dark);">{{ __('Aucun outil éducation trouvé pour l\'instant') }}</h3>
                        <p>{{ __('Peu d\'outils ont une tarification éducation documentée. Vous en connaissez un ?') }}</p>
                        @auth
                            <button type="button" @click="resetAll(); wStep = 1;" class="btn" style="background: var(--c-primary); color: #fff; border-radius: var(--r-btn);">{{ __('Proposer un outil') }}</button>
                        @else
                            <a href="{{ route('login') }}" class="btn" style="background: var(--c-primary); color: #fff; border-radius: var(--r-btn); display: inline-block; text-decoration: none;">{{ __('Connectez-vous pour proposer') }}</a>
                        @endauth
                    </div>
                </template>
                <template x-if="!isEducationContext">
                    <div>
                        <div style="font-size: 40px; margin-bottom: 10px;">🔍</div>
                        <h3 style="font-family: var(--f-heading); color: var(--c-dark);">{{ __('Aucun outil trouvé') }}</h3>
                        <p>{{ __('Essayez de modifier vos filtres.') }}</p>
                        <button type="button" @click="resetAll()" class="btn" style="background: var(--c-primary); color: #fff; border-radius: var(--r-btn);">{{ __('Réinitialiser') }}</button>
                    </div>
                </template>
            </div>
        </div>
    </div>
</div>

{{-- S134 SEO : cluster bidirectionnel — le hub annuaire pointe vers les piliers thématiques (les 5). --}}
<div class="container" style="padding-bottom:40px;">
    @include('fronttheme::partials.pillars-related')
</div>

<x-directory::compare-bar />
@endsection

@push('scripts')
{{-- Ticket #1868 - chargé UNIQUEMENT si le widget Turnstile est rendu plus haut (voir
     $turnstileSiteKey) : aucun appel réseau ajouté tant que Cloudflare n'est pas configuré. --}}
@if($turnstileSiteKey)
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" defer></script>
@endif
<script type="application/ld+json">
{
    "@@context": "https://schema.org",
    "@@type": "CollectionPage",
    "name": "{{ __('Répertoire techno') }}",
    "description": "{{ __('Les meilleurs outils techno sélectionnés pour vous.') }}",
    "url": "{{ route('directory.index') }}"
}
</script>
@endpush
