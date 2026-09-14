<?php require __DIR__ . '/partials/shell-top.php'; ?>
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h1 class="h3 mb-1">Posts</h1>
                    <p class="text-secondary mb-0">Logado como <?= htmlspecialchars($user['email'], ENT_QUOTES, 'UTF-8') ?></p>
                </div>
                <a class="btn btn-primary" href="/admin/posts/create">Novo post</a>
            </div>

            <div class="row g-2 align-items-end mb-3" data-admin-table data-default-sort="published_at" data-default-dir="-1">
                <div class="col-md-6">
                    <label class="form-label" for="posts-search">Buscar</label>
                    <input
                        class="form-control"
                        id="posts-search"
                        type="search"
                        placeholder="Título, categoria, autor, status..."
                        data-table-search
                    >
                </div>
                <div class="col-md-3">
                    <label class="form-label" for="posts-status">Status</label>
                    <select class="form-select" id="posts-status" data-table-filter="status">
                        <option value="">Todos</option>
                        <option value="published">Publicado</option>
                        <option value="draft">Rascunho</option>
                        <option value="hidden">Oculto</option>
                    </select>
                </div>
                <div class="col-md-3">
                    <label class="form-label" for="posts-page-size">Por página</label>
                    <select class="form-select" id="posts-page-size" data-table-page-size>
                        <option value="10">10</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="0">Todos</option>
                    </select>
                </div>

                <div class="col-12">
                    <p class="text-secondary small mb-2" data-table-info>
                        <?= (int) $totalPosts ?> post<?= $totalPosts === 1 ? '' : 's' ?> encontrado<?= $totalPosts === 1 ? '' : 's' ?>.
                    </p>

                    <div class="table-responsive admin-table-wrap">
                        <table class="table admin-table align-middle mb-0">
                            <thead class="admin-table-head admin-table-head-sortable">
                                <tr>
                                    <th><button type="button" class="admin-table-sort" data-sort="title">Título <i class="fa-solid fa-sort"></i></button></th>
                                    <th><button type="button" class="admin-table-sort" data-sort="category">Categoria <i class="fa-solid fa-sort"></i></button></th>
                                    <th><button type="button" class="admin-table-sort" data-sort="author">Autor <i class="fa-solid fa-sort"></i></button></th>
                                    <th><button type="button" class="admin-table-sort" data-sort="status">Status <i class="fa-solid fa-sort"></i></button></th>
                                    <th><button type="button" class="admin-table-sort" data-sort="published_at" data-sort-type="number">Publicado em <i class="fa-solid fa-sort-down"></i></button></th>
                                    <th class="text-end"><span class="admin-table-head-label">Ações</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php
                                    $statusLabels = [
                                        'published' => 'Publicado',
                                        'draft' => 'Rascunho',
                                        'hidden' => 'Oculto',
                                    ];
                                ?>
                                <?php foreach ($posts as $post): ?>
                                    <?php
                                        $statusLabel = $statusLabels[$post['status']] ?? $post['status'];
                                        $publishedTimestamp = $post['published_at'] ? strtotime($post['published_at']) : 0;
                                        $searchHaystack = mb_strtolower(implode(' ', [
                                            $post['title'],
                                            $post['category_name'] ?? '',
                                            $post['author_name'],
                                            $statusLabel,
                                        ]), 'UTF-8');
                                    ?>
                                    <tr data-row data-status="<?= htmlspecialchars($post['status'], ENT_QUOTES, 'UTF-8') ?>" data-search="<?= htmlspecialchars($searchHaystack, ENT_QUOTES, 'UTF-8') ?>">
                                        <td data-col="title" data-value="<?= htmlspecialchars(mb_strtolower($post['title'], 'UTF-8'), ENT_QUOTES, 'UTF-8') ?>">
                                            <a class="post-title-link fw-semibold text-decoration-none" href="/blog/<?= rawurlencode($post['slug']) ?>">
                                                <?= htmlspecialchars($post['title'], ENT_QUOTES, 'UTF-8') ?>
                                            </a>
                                        </td>
                                        <td data-col="category" data-value="<?= htmlspecialchars(mb_strtolower($post['category_name'] ?? '', 'UTF-8'), ENT_QUOTES, 'UTF-8') ?>">
                                            <?= htmlspecialchars($post['category_name'] ?? '-', ENT_QUOTES, 'UTF-8') ?>
                                        </td>
                                        <td data-col="author" data-value="<?= htmlspecialchars(mb_strtolower($post['author_name'], 'UTF-8'), ENT_QUOTES, 'UTF-8') ?>">
                                            <?= htmlspecialchars($post['author_name'], ENT_QUOTES, 'UTF-8') ?>
                                        </td>
                                        <td data-col="status" data-value="<?= htmlspecialchars($statusLabel, ENT_QUOTES, 'UTF-8') ?>">
                                            <span class="status-badge status-<?= htmlspecialchars($post['status'], ENT_QUOTES, 'UTF-8') ?>">
                                                <?= htmlspecialchars($statusLabel, ENT_QUOTES, 'UTF-8') ?>
                                            </span>
                                        </td>
                                        <td data-col="published_at" data-value="<?= $publishedTimestamp ?>">
                                            <?= $post['published_at'] ? date('d/m/Y', $publishedTimestamp) : '-' ?>
                                        </td>
                                        <td class="text-end admin-actions">
                                            <a class="admin-action-link" href="/admin/posts/<?= (int) $post['id'] ?>/edit">Editar</a>
                                            <?php if ($post['status'] === 'published'): ?>
                                                <a class="admin-action-link" href="/blog/<?= rawurlencode($post['slug']) ?>" target="_blank" rel="noopener">Ver</a>
                                            <?php endif; ?>
                                            <?php if ($post['status'] !== 'published'): ?>
                                                <a class="admin-action-link" href="/admin/posts/<?= (int) $post['id'] ?>/status/published">Publicar</a>
                                            <?php endif; ?>
                                            <?php if ($post['status'] !== 'draft'): ?>
                                                <a class="admin-action-link" href="/admin/posts/<?= (int) $post['id'] ?>/status/draft">Rascunho</a>
                                            <?php endif; ?>
                                            <?php if ($post['status'] !== 'hidden'): ?>
                                                <a class="admin-action-link" href="/admin/posts/<?= (int) $post['id'] ?>/status/hidden">Ocultar</a>
                                            <?php endif; ?>
                                            <form class="d-inline" method="post" action="/admin/posts/<?= (int) $post['id'] ?>/delete" onsubmit="return confirm('Excluir este post? Ele sera ocultado da administracao e do site.');">
                                                <button class="admin-action-link admin-action-danger" type="submit">Excluir</button>
                                            </form>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                                <tr data-table-empty hidden>
                                    <td colspan="6" class="text-secondary">Nenhum post encontrado.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <nav class="pt-3" aria-label="Paginação administrativa de posts">
                        <ul class="pagination justify-content-center mb-0" data-table-pager></ul>
                    </nav>
                </div>
            </div>
<?php require __DIR__ . '/partials/shell-bottom.php'; ?>
<script src="/assets/js/admin-table.js?v=<?= @filemtime(dirname(__DIR__, 3) . '/public/assets/js/admin-table.js') ?: '1' ?>"></script>
</body>
</html>
