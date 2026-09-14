<?php require __DIR__ . '/partials/shell-top.php'; ?>
            <div class="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h1 class="h3 mb-1">Posts</h1>
                    <p class="text-secondary mb-0">Logado como <?= htmlspecialchars($user['email'], ENT_QUOTES, 'UTF-8') ?></p>
                </div>
                <a class="btn btn-primary" href="/admin/posts/create">Novo post</a>
            </div>

            <form class="row g-2 align-items-end mb-4" method="get" action="/admin/posts">
                <div class="col-md-8">
                    <label class="form-label" for="q">Buscar por titulo</label>
                    <input
                        class="form-control"
                        id="q"
                        name="q"
                        type="search"
                        value="<?= htmlspecialchars($search, ENT_QUOTES, 'UTF-8') ?>"
                        placeholder="Digite parte do titulo"
                    >
                </div>
                <div class="col-md-4 d-flex gap-2">
                    <button class="btn btn-primary" type="submit">Buscar</button>
                    <?php if ($search !== ''): ?>
                        <a class="btn btn-outline-secondary" href="/admin/posts">Limpar</a>
                    <?php endif; ?>
                </div>
            </form>

            <p class="text-secondary small mb-3">
                <?= (int) $totalPosts ?> post<?= $totalPosts === 1 ? '' : 's' ?> encontrado<?= $totalPosts === 1 ? '' : 's' ?>.
            </p>

            <div class="table-responsive admin-table-wrap">
                <table class="table admin-table align-middle mb-0">
                    <thead class="admin-table-head">
                        <tr>
                            <th>Titulo</th>
                            <th>Categoria</th>
                            <th>Autor</th>
                            <th>Status</th>
                            <th>Publicado em</th>
                            <th class="text-end">Acoes</th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($posts as $post): ?>
                            <tr>
                                <td>
                                    <a class="post-title-link fw-semibold text-decoration-none" href="/blog/<?= rawurlencode($post['slug']) ?>">
                                        <?= htmlspecialchars($post['title'], ENT_QUOTES, 'UTF-8') ?>
                                    </a>
                                </td>
                                <td><?= htmlspecialchars($post['category_name'] ?? '-', ENT_QUOTES, 'UTF-8') ?></td>
                                <td><?= htmlspecialchars($post['author_name'], ENT_QUOTES, 'UTF-8') ?></td>
                                <td>
                                    <?php
                                        $statusLabels = [
                                            'published' => 'Publicado',
                                            'draft' => 'Rascunho',
                                            'hidden' => 'Oculto',
                                        ];
                                    ?>
                                    <span class="status-badge status-<?= htmlspecialchars($post['status'], ENT_QUOTES, 'UTF-8') ?>">
                                        <?= htmlspecialchars($statusLabels[$post['status']] ?? $post['status'], ENT_QUOTES, 'UTF-8') ?>
                                    </span>
                                </td>
                                <td><?= $post['published_at'] ? date('d/m/Y', strtotime($post['published_at'])) : '-' ?></td>
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
                    </tbody>
                </table>
            </div>

            <?php if ($totalPages > 1): ?>
                <nav class="pt-3" aria-label="Paginacao administrativa de posts">
                    <ul class="pagination justify-content-center mb-0">
                        <?php
                            $queryPrefix = $search !== '' ? '?q=' . urlencode($search) . '&page=' : '?page=';
                            $previousHref = '/admin/posts' . $queryPrefix . max(1, $currentPage - 1);
                            $nextHref = '/admin/posts' . $queryPrefix . min($totalPages, $currentPage + 1);
                        ?>
                        <li class="page-item <?= $currentPage <= 1 ? 'disabled' : '' ?>">
                            <a class="page-link" href="<?= $previousHref ?>">Anterior</a>
                        </li>

                        <?php for ($page = 1; $page <= $totalPages; $page++): ?>
                            <li class="page-item <?= $page === $currentPage ? 'active' : '' ?>">
                                <a
                                    class="page-link"
                                    href="/admin/posts<?= $search !== '' ? '?q=' . urlencode($search) . '&page=' . $page : '?page=' . $page ?>"
                                    <?= $page === $currentPage ? 'aria-current="page"' : '' ?>
                                >
                                    <?= (int) $page ?>
                                </a>
                            </li>
                        <?php endfor; ?>

                        <li class="page-item <?= $currentPage >= $totalPages ? 'disabled' : '' ?>">
                            <a class="page-link" href="<?= $nextHref ?>">Proxima</a>
                        </li>
                    </ul>
                </nav>
            <?php endif; ?>
<?php require __DIR__ . '/partials/shell-bottom.php'; ?>
</body>
</html>
