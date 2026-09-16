<?php

use App\Services\ThemeService;
use Illuminate\Http\Request;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| Here is where you can register web routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| contains the "web" middleware group. Now create something great!
|
*/

Route::get('/', function (Request $request) {
    if (config('v2board.app_url') && config('v2board.safe_mode_enable', 0)) {
        if ($request->server('HTTP_HOST') !== parse_url(config('v2board.app_url'))['host']) {
            abort(403);
        }
    }
    $renderParams = [
        'title' => config('v2board.app_name', 'V2Board'),
        'theme' => config('v2board.frontend_theme', 'default'),
        'version' => config('app.version'),
        'description' => config('v2board.app_description', 'V2Board is best'),
        'logo' => config('v2board.logo'),
    ];

    if (!config("theme.{$renderParams['theme']}")) {
        $themeService = new ThemeService($renderParams['theme']);
        $themeService->init();
    }

    $renderParams['theme_config'] = config('theme.' . config('v2board.frontend_theme', 'default'));

    return view('theme::' . config('v2board.frontend_theme', 'default') . '.dashboard', $renderParams);
});

//TODO:: 兼容
Route::get('/' . config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))), function () {
    return view('admin', [
        'title' => config('v2board.app_name', 'V2Board'),
        'theme_sidebar' => config('v2board.frontend_theme_sidebar', 'light'),
        'theme_header' => config('v2board.frontend_theme_header', 'dark'),
        'theme_color' => config('v2board.frontend_theme_color', 'default'),
        'background_url' => config('v2board.frontend_background_url'),
        'version' => config('app.version'),
        'logo' => config('v2board.logo'),
        'secure_path' => config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))),
    ]);
});

if (!empty(config('v2board.subscribe_path'))) {
    Route::get(config('v2board.subscribe_path'), 'V1\\Client\\ClientController@subscribe')->middleware('client');
}

// Advanced Admin hub (Blade) — small entry page that links to every
// out-of-panel admin tool. Exact same localStorage auth_data bridge as
// /subscribe-rules and /database; two views: the bridge and the hub.
Route::get('/' . config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))) . '/advanced', function (Request $request) {
    $secure_path = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
    $auth_data = (string) $request->input('auth_data', '');
    $user = $auth_data !== '' ? \App\Services\AuthService::decryptAuthData($auth_data) : false;
    if (!$user || !$user['is_admin']) {
        return response()->view('admin-advanced-login', [
            'secure_path' => $secure_path,
        ], 200);
    }

    return view('admin-advanced', [
        'secure_path' => $secure_path,
    ]);
});

// Subscribe Rules (RU DIRECT) — same bridge pattern as database transfer.
Route::get('/' . config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))) . '/subscribe-rules', function (Request $request) {
    $secure_path = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
    $auth_data = (string) $request->input('auth_data', '');
    $user = $auth_data !== '' ? \App\Services\AuthService::decryptAuthData($auth_data) : false;
    if (!$user || !$user['is_admin']) {
        return response()->view('subscribe-rules-login', [
            'secure_path' => $secure_path,
        ], 200);
    }

    return view('subscribe-rules', [
        'secure_path' => $secure_path,
        'title' => config('v2board.app_name', 'V2Board'),
        'auth_data' => $auth_data,
    ]);
});
// Database transfer admin page (Blade). The admin SPA keeps its JWT in localStorage,
// which a plain browser navigation does not carry — so when ?auth_data is missing we
// serve a tiny redirect bridge that picks the token up from localStorage and reloads
// with it. A missing/invalid token still 403s at every API call the page makes
// (those are gated by the `admin` middleware), so the bridge itself leaks nothing.
Route::get('/' . config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key')))) . '/database', function (Request $request) {
    $secure_path = config('v2board.secure_path', config('v2board.frontend_admin_path', hash('crc32b', config('app.key'))));
    $auth_data = (string) $request->input('auth_data', '');
    $user = $auth_data !== '' ? \App\Services\AuthService::decryptAuthData($auth_data) : false;
    if (!$user || !$user['is_admin']) {
        return response()->view('database-transfer-login', [
            'secure_path' => $secure_path,
        ], 200);
    }

    return view('database-transfer', [
        'secure_path' => $secure_path,
        'title' => config('v2board.app_name', 'V2Board'),
        'auth_data' => $auth_data,
    ]);
});
