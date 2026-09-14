<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Reads WooCommerce product categories directly from the WordPress DB
 * (source of truth).
 */
class CategoryService
{
    private const JEWELRY_PARENT_ID = 93;
    private const GOLD_JEWELRY_PARENT_ID = 329;
    private const EXCLUDED_PARENT_IDS = [self::JEWELRY_PARENT_ID, self::GOLD_JEWELRY_PARENT_ID];
    private const CACHE_TTL = 900; // 15 minutes — WP changes don't need to be instant here.

    /**
     * The 40 top-level non-jewelry category IDs that make up the "Big Items"
     * bucket — used both by the mega-menu and by the /shop archive itself,
     * so "All Items" really shows the same set, not literally every product
     * (which would also pull in jewelry).
     */
    public function bigItemsCategoryIds(): array
    {
        return Cache::remember('categories.big-items-ids', self::CACHE_TTL, function () {
            return $this->termsByParent(0, self::EXCLUDED_PARENT_IDS)->pluck('term_id')->all();
        });
    }

/**
     * True for silver-jewelry (93) itself or any of its children — used to
     * decide whether a category/product page should use the white "Jewelry"
     * theme instead of the site's usual dark background.
     */
    public function isJewelryCategory(int $termId): bool
    {
        return in_array($termId, $this->jewelryCategoryIds(), true);
    }

    private function jewelryCategoryIds(): array
    {
        return Cache::remember('categories.jewelry-ids', self::CACHE_TTL, function () {
            $childIds = $this->termsByParent(self::JEWELRY_PARENT_ID)->pluck('term_id')->all();
            return [self::JEWELRY_PARENT_ID, ...$childIds];
        });
    }

    /**
     * The 2-item "Shop" mega-menu structure (desktop hover + mobile drill-down):
     * Big Items (all 40 top-level non-jewelry categories) and Jewelry (Silver)
     * (term 93's children). "Brass" from the Figma mock has no backing data
     * anywhere in WooCommerce (no category/tag/attribute) — dropped per
     * client direction until real brass products/categories exist.
     */
    public function megaMenuGroups(): array
    {
        return Cache::remember('categories.mega-menu', self::CACHE_TTL, function () {
            $bigItemsCategories = $this->termsByParent(0, self::EXCLUDED_PARENT_IDS);
            $jewelryCategories = $this->termsByParent(self::JEWELRY_PARENT_ID);

            $bigItemsIds = $bigItemsCategories->pluck('term_id')->all();
            $jewelryIds = $jewelryCategories->pluck('term_id')->all();

            return [
                [
                    'key' => 'big-items',
                    'name' => 'Big Items',
                    'description' => 'Our premium silverware is perfect for gifts and decorative purposes.',
                    'url' => url('/shop'),
                    'image' => $this->representativeProductAcrossCategories($bigItemsIds, 'popular')['image'] ?? null,
                    'categories' => $bigItemsCategories->map(fn ($t) => ['term_id' => $t->term_id, 'name' => $t->name, 'slug' => $t->slug])->all(),
                    'popular_product' => $this->representativeProductAcrossCategories($bigItemsIds, 'popular'),
                    'new_product' => $this->representativeProductAcrossCategories($bigItemsIds, 'new'),
                ],
                [
                    'key' => 'jewelry-silver',
                    'name' => 'Jewelry (Silver)',
                    'description' => 'Premium Silverware for gifts and decorations.',
                    'url' => url('/product-category/silver-jewelry'),
                    'image' => $this->representativeProductAcrossCategories($jewelryIds, 'popular')['image'] ?? null,
                    'categories' => $jewelryCategories->map(fn ($t) => ['term_id' => $t->term_id, 'name' => $t->name, 'slug' => $t->slug])->all(),
                    'popular_product' => $this->representativeProductAcrossCategories($jewelryIds, 'popular'),
                    'new_product' => $this->representativeProductAcrossCategories($jewelryIds, 'new'),
                ],
            ];
        });
    }

    /**
     * Full nested category tree (parent=0 top level, one level of children),
     * used by the /shop ("Big Items") sidebar. Both jewelry parents —
     * silver-jewelry (93) and gold-jewelry (329) — are excluded, matching
     * /shop's own product scope (the "Big Items" bucket); jewelry has its
     * own dedicated section via the mega-menu instead.
     */
    public function sidebarTree(): array
    {
        return Cache::remember('categories.sidebar', self::CACHE_TTL, function () {
            $topLevel = $this->termsByParent(0, self::EXCLUDED_PARENT_IDS);
            $termIds = $topLevel->pluck('term_id')->all();
            $childrenMap = $this->childrenGroupedByParent($termIds);

            return $topLevel->map(fn ($term) => [
                'term_id' => $term->term_id,
                'name' => $term->name,
                'slug' => $term->slug,
                'children' => $childrenMap[$term->term_id] ?? [],
            ])->all();
        });
    }

    /**
     * Sidebar tree for jewelry pages — jewelry's own subcategories (Necklaces,
     * Bracelets, Rings, etc.) instead of the unrelated "Big Items" top-level
     * categories that sidebarTree() returns.
     */
    public function jewelrySidebarTree(): array
    {
        return Cache::remember('categories.sidebar.jewelry', self::CACHE_TTL, function () {
            $children = $this->termsByParent(self::JEWELRY_PARENT_ID);

            return $children->map(fn ($term) => [
                'term_id' => $term->term_id,
                'name' => $term->name,
                'slug' => $term->slug,
                'children' => [],
            ])->all();
        });
    }

    public function findBySlug(string $slug): ?array
    {
        return Cache::remember("categories.slug.{$slug}", self::CACHE_TTL, function () use ($slug) {
            $term = DB::connection('wordpress')
                ->table('terms as t')
                ->join('term_taxonomy as tt', 't.term_id', '=', 'tt.term_id')
                ->where('tt.taxonomy', 'product_cat')
                ->where('t.slug', $slug)
                ->select('t.term_id', 't.name', 't.slug', 'tt.description', 'tt.parent', 'tt.count')
                ->first();

            if (!$term) {
                return null;
            }

            return [
                'term_id' => $term->term_id,
                'name' => $term->name,
                'slug' => $term->slug,
                'description' => $term->description,
                'parent' => (int) $term->parent,
                'count' => (int) $term->count,
            ];
        });
    }

    /**
     * Direct children of a category, with images — used to render the
     * "category index" tile grid for parent categories (e.g. Jewelry)
     * that have no products of their own, only subcategories.
     */
    public function children(int $termId): array
    {
        return Cache::remember("categories.children.{$termId}", self::CACHE_TTL, function () use ($termId) {
            $children = $this->termsByParent($termId);

            return $children->map(fn ($term) => [
                'term_id' => $term->term_id,
                'name' => $term->name,
                'slug' => $term->slug,
                'description' => $term->description,
                'image' => $this->categoryImage($term->term_id, $term->slug),
            ])->all();
        });
    }

    /**
     * All top-level "Big Items" categories with images — used for the
     * search page's Big Items/Jewelry category directory (side by side).
     */
    public function bigItemsCategoriesWithImages(): array
    {
        return Cache::remember('categories.big-items-with-images', self::CACHE_TTL, function () {
            return $this->termsByParent(0, self::EXCLUDED_PARENT_IDS)
                ->map(fn ($term) => [
                    'term_id' => $term->term_id,
                    'name' => $term->name,
                    'slug' => $term->slug,
                    'image' => $this->categoryImage($term->term_id, $term->slug),
                ])->all();
        });
    }

    /** Jewelry's own subcategories with images — the search page's Jewelry column. */
    public function jewelryCategoriesWithImages(): array
    {
        return $this->children(self::JEWELRY_PARENT_ID);
    }

    /**
     * Breadcrumb chain from root to this category (excluding the category itself).
     */
    public function ancestors(int $termId): array
    {
        $chain = [];
        $current = $termId;
        $guard = 0;

        while ($current && $guard++ < 10) {
            $term = DB::connection('wordpress')
                ->table('terms as t')
                ->join('term_taxonomy as tt', 't.term_id', '=', 'tt.term_id')
                ->where('tt.taxonomy', 'product_cat')
                ->where('t.term_id', $current)
                ->select('t.term_id', 't.name', 't.slug', 'tt.parent')
                ->first();

            if (!$term || (int) $term->parent === 0) {
                break;
            }

            $parent = DB::connection('wordpress')
                ->table('terms as t')
                ->join('term_taxonomy as tt', 't.term_id', '=', 'tt.term_id')
                ->where('tt.taxonomy', 'product_cat')
                ->where('t.term_id', $term->parent)
                ->select('t.term_id', 't.name', 't.slug')
                ->first();

            if (!$parent) {
                break;
            }

            array_unshift($chain, ['term_id' => $parent->term_id, 'name' => $parent->name, 'slug' => $parent->slug]);
            $current = $parent->term_id;
        }

        return $chain;
    }

    private function termsByParent(int $parentId, array $exclude = [])
    {
        $query = DB::connection('wordpress')
            ->table('terms as t')
            ->join('term_taxonomy as tt', 't.term_id', '=', 'tt.term_id')
            ->where('tt.taxonomy', 'product_cat')
            ->where('tt.parent', $parentId)
            ->select('t.term_id', 't.name', 't.slug', 'tt.description', 'tt.count')
            ->orderBy('t.name');

        if (!empty($exclude)) {
            $query->whereNotIn('t.term_id', $exclude);
        }

        return $query->get();
    }

    private function childrenGroupedByParent(array $parentIds): array
    {
        if (empty($parentIds)) {
            return [];
        }

        $children = DB::connection('wordpress')
            ->table('terms as t')
            ->join('term_taxonomy as tt', 't.term_id', '=', 'tt.term_id')
            ->where('tt.taxonomy', 'product_cat')
            ->whereIn('tt.parent', $parentIds)
            ->select('t.term_id', 't.name', 't.slug', 'tt.parent')
            ->orderBy('t.name')
            ->get();

        return $children->groupBy('parent')->map(function ($group) {
            return $group->map(fn ($c) => ['term_id' => $c->term_id, 'name' => $c->name, 'slug' => $c->slug])->all();
        })->all();
    }

    /**
     * Jewelry subcategory tile images, sourced from the real production page
     * (html_version/Jewelry ... .html) — most of these terms have no
     * thumbnail_id set in the local dev DB, so this fills the gap with the
     * same images the live site actually uses.
     */
    private const JEWELRY_CATEGORY_IMAGES = [
        'necklaces' => 'https://unyilaysilver.com/wp-content/uploads/2021/09/New-Thh-247x296.png',
        'bracelets' => 'https://unyilaysilver.com/wp-content/uploads/2021/08/Bracelet-Thumbnail-247x296.png',
        'rings' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Ring-scaled-247x296.jpg',
        'bangles' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Bangle-scaled-247x296.jpg',
        'dangle-earrings' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Eardrop-scaled-247x296.jpg',
        'hoop-earrings' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Earhoop-scaled-247x296.jpg',
        'stud-earrings' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Earring-scaled-247x296.jpg',
        'cufflinks' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Cufflink-scaled-247x296.jpg',
        'pendants' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Pendent-scaled-247x296.jpg',
        'box-pendants' => 'https://unyilaysilver.com/wp-content/uploads/2021/08/kyoke-thumbnail-2-247x296.png',
        'anklets' => 'https://unyilaysilver.com/wp-content/uploads/2021/06/Footchain-scaled-247x296.jpg',
        'baby-silver' => 'https://unyilaysilver.com/wp-content/uploads/2021/08/Kalay-Thumbnail-247x296.png',
        'belts' => 'https://unyilaysilver.com/wp-content/uploads/2022/05/IMG_1474-247x296.jpg',
        'toerings' => 'https://unyilaysilver.com/wp-content/uploads/2022/05/IMG_1494-247x296.jpg',
        'amulets-asaawin' => 'https://unyilaysilver.com/wp-content/uploads/2022/06/286949362_476623100663325_6093239006876295650_n-247x296.jpg',
        'general' => 'https://unyilaysilver.com/wp-content/uploads/2022/06/285940305_712606039973477_7926842476250524608_n-247x296.jpg',
    ];

    private function categoryImage(int $termId, ?string $slug = null): ?string
    {
        $attachmentId = DB::connection('wordpress')
            ->table('termmeta')
            ->where('term_id', $termId)
            ->where('meta_key', 'thumbnail_id')
            ->value('meta_value');

        if (!$attachmentId) {
            return $slug ? (self::JEWELRY_CATEGORY_IMAGES[$slug] ?? null) : null;
        }

        return app(ProductImageResolver::class)->urlForAttachment((int) $attachmentId);
    }

    /**
     * Single best-matching product across a whole set of categories combined
     * (not one per category) — used for the mega-menu group's "Popular"/"New"
     * teaser, where the group spans many categories at once.
     */
    private function representativeProductAcrossCategories(array $termIds, string $mode): ?array
    {
        if (empty($termIds)) {
            return null;
        }

        $prefix = DB::connection('wordpress')->getTablePrefix();
        $orderColumn = $mode === 'popular' ? "{$prefix}sales.meta_value + 0" : "{$prefix}p.post_date";

        $row = DB::connection('wordpress')
            ->table('term_relationships as tr')
            ->join('term_taxonomy as tt', 'tr.term_taxonomy_id', '=', 'tt.term_taxonomy_id')
            ->join('posts as p', 'tr.object_id', '=', 'p.ID')
            ->when($mode === 'popular', function ($q) {
                $q->leftJoin('postmeta as sales', function ($j) {
                    $j->on('sales.post_id', '=', 'p.ID')->where('sales.meta_key', 'total_sales');
                });
            })
            ->whereIn('tt.term_id', $termIds)
            ->where('tt.taxonomy', 'product_cat')
            ->where('p.post_type', 'product')
            ->where('p.post_status', 'publish')
            ->select('p.ID as product_id', 'p.post_title', 'p.post_name')
            ->distinct()
            ->orderByDesc(DB::raw($orderColumn))
            ->first();

        if (!$row) {
            return null;
        }

        $image = app(ProductImageResolver::class)->urlsForProducts([$row->product_id])[$row->product_id] ?? null;

        return [
            'id' => $row->product_id,
            'name' => $row->post_title,
            'slug' => $row->post_name,
            'image' => $image,
        ];
    }
}
