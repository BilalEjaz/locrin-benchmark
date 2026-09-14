<?php

namespace App\Http\Controllers;

use App\Services\CategoryService;
use App\Services\ProductService;
use Illuminate\Http\Request;

class ShopController extends Controller
{
    public function __construct(
        private CategoryService $categories,
        private ProductService $products,
    ) {
    }

    /**
     * GET /shop — the "Big Items" bucket (all 40 top-level non-jewelry
     * categories combined), matching the mega-menu's "Big Items" entry.
     * Not literally every product — that would also pull in jewelry.
     */
    public function index(Request $request)
    {
        $search = trim((string) $request->query('s', ''));
        $page = max(1, (int) $request->query('product-page', 1));

        // A search covers the whole catalog (including jewelry); without a
        // search term this stays the "Big Items" bucket as before.
        $listing = $search !== ''
            ? $this->products->paginate(null, $page, search: $search)
            : $this->products->paginate($this->categories->bigItemsCategoryIds(), $page);

        return view('shop.archive', [
            'categories' => $this->categories->megaMenuGroups(),
            'sidebar' => $this->categories->sidebarTree(),
            'breadcrumbs' => [],
            'title' => $search !== '' ? 'Search results for "' . $search . '"' : 'Big Items',
            'listing' => $listing,
            'baseUrl' => url('/shop') . ($search !== '' ? '?s=' . urlencode($search) : ''),
            'search' => $search,
        ]);
    }

    /** GET /search — live-search JSON for the header search dropdown. */
    public function search(Request $request)
    {
        $term = trim((string) $request->query('q', ''));
        $results = $term !== '' ? $this->products->search($term) : [];

        return response()->json([
            'results' => array_map(fn ($p) => [
                'name' => $p['name'],
                'url' => url('/product/' . $p['slug']),
                'image' => $p['image'],
                'price' => \App\Support\Money::range($p['price']),
            ], $results),
        ]);
    }

    /** GET /product-category/{slug} — either a subcategory tile grid or a product archive. */
    public function category(Request $request, string $slug)
    {
        $category = $this->categories->findBySlug($slug);
        abort_if(!$category, 404);

        $children = $this->categories->children($category['term_id']);
        $breadcrumbs = $this->categories->ancestors($category['term_id']);
        $menuCategories = $this->categories->megaMenuGroups();

        $isJewelry = $this->categories->isJewelryCategory($category['term_id']);

        // "Big Items" isn't a real WooCommerce category (it's the virtual
        // grouping of all top-level non-jewelry categories that /shop
        // represents), so it never shows up via ancestors() — prepend it
        // manually as a link back to /shop for non-jewelry breadcrumbs.
        if (!$isJewelry) {
            array_unshift($breadcrumbs, ['name' => 'Big Items', 'url' => url('/shop')]);
        }

        if (!empty($children)) {
            return view('shop.category-index', [
                'categories' => $menuCategories,
                'category' => $category,
                'children' => $children,
                'breadcrumbs' => $breadcrumbs,
                'title' => $category['name'],
                'isJewelry' => $isJewelry,
            ]);
        }

        $page = max(1, (int) $request->query('product-page', 1));
        $listing = $this->products->paginate($category['term_id'], $page);

        return view('shop.archive', [
            'categories' => $menuCategories,
            'sidebar' => $isJewelry ? $this->categories->jewelrySidebarTree() : $this->categories->sidebarTree(),
            'breadcrumbs' => [...$breadcrumbs, ['term_id' => $category['term_id'], 'name' => $category['name'], 'slug' => $category['slug']]],
            'title' => $category['name'],
            'listing' => $listing,
            'baseUrl' => url('/product-category/' . $category['slug']),
            'isJewelry' => $isJewelry,
        ]);
    }
}
