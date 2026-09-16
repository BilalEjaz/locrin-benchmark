<x-layouts.app :categories="$categories" title="Search Items — U Nyi Lay Silver Shop">
    <div class="unyl-search-page">
        <div class="unyl-search-page__hero">
            <h1>Search Items</h1>
            <div class="unyl-divider"><img src="{{ asset('images/home/divider-small-leaf.svg') }}" alt="" loading="lazy" /></div>

            <form action="{{ url('/search-items') }}" method="GET" class="unyl-search-form unyl-search-page__form">
                <input type="text" name="s" value="{{ $search }}" class="unyl-search-form__input" placeholder="Search Items" autofocus />
                <button type="submit" class="unyl-search-form__submit" aria-label="Search">
                    <svg viewBox="0 0 21 20" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M15.2058 14.6574L19.0221 18.3362M9.62223 16.8864C5.26143 16.8864 1.72632 13.4787 1.72632 9.27517C1.72632 5.07158 5.26143 1.66392 9.62223 1.66392C13.983 1.66392 17.5181 5.07158 17.5181 9.27517C17.5181 13.4787 13.983 16.8864 9.62223 16.8864Z"/></svg>
                </button>
            </form>
        </div>

        @if ($search !== '')
            <div class="unyl-search-page__results">
                @if (empty($listing['items']))
                    <p class="unyl-shop__empty">No products found for "{{ $search }}".</p>
                @else
                    <p class="unyl-search-page__count">{{ $listing['total'] }} result{{ $listing['total'] === 1 ? '' : 's' }} for "{{ $search }}"</p>

                    <div class="unyl-shop__grid">
                        @foreach ($listing['items'] as $product)
                            <x-shop.product-card :product="$product" />
                        @endforeach
                    </div>

                    <x-shop.pagination :listing="$listing" :base-url="$baseUrl" />
                @endif
            </div>
        @elseif (!empty($bigItemsCategories) || !empty($jewelryCategories))
            <div class="unyl-search-page__discover">
                <div class="unyl-search-page__discover-columns">
                    <div class="unyl-search-page__discover-col">
                        <h2>Big Items</h2>
                        <div class="unyl-category-tiles unyl-category-tiles--search">
                            @foreach ($bigItemsCategories as $cat)
                                <a href="{{ url('/product-category/' . $cat['slug']) }}" class="unyl-category-tile">
                                    @if ($cat['image'])
                                        <img src="{{ $cat['image'] }}" alt="{{ $cat['name'] }}" loading="lazy" />
                                    @endif
                                    <span class="unyl-category-tile__caption">{{ $cat['name'] }}</span>
                                </a>
                            @endforeach
                        </div>
                    </div>

                    <div class="unyl-search-page__discover-col">
                        <h2>Jewelry</h2>
                        <div class="unyl-category-tiles unyl-category-tiles--search">
                            @foreach ($jewelryCategories as $cat)
                                <a href="{{ url('/product-category/' . $cat['slug']) }}" class="unyl-category-tile">
                                    @if ($cat['image'])
                                        <img src="{{ $cat['image'] }}" alt="{{ $cat['name'] }}" loading="lazy" />
                                    @endif
                                    <span class="unyl-category-tile__caption">{{ $cat['name'] }}</span>
                                </a>
                            @endforeach
                        </div>
                    </div>
                </div>
            </div>
        @endif
    </div>
</x-layouts.app>
