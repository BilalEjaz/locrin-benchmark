<?php

namespace App\Repositories;

use App\Core\Text;
use App\Database\Database;
use PDO;

class PostRepository
{
    private $database;

    public function __construct(?Database $database = null)
    {
        $this->database = $database ?: new Database();
    }

    public function paginate(int $page, int $perPage, ?int $year = null, ?int $month = null, ?int $categoryId = null, ?int $tagId = null): array
    {
        $page = max(1, $page);
        $offset = ($page - 1) * $perPage;
        $pdo = $this->database->connection();
        $where = 'WHERE posts.published_at IS NOT NULL AND posts.status = "published" AND posts.deleted_at IS NULL';
        $params = [];

        if ($year !== null && $month !== null) {
            $where .= ' AND YEAR(posts.published_at) = :year AND MONTH(posts.published_at) = :month';
            $params[':year'] = $year;
            $params[':month'] = $month;
        }

        if ($categoryId !== null) {
            $where .= ' AND EXISTS (
                SELECT 1 FROM post_category
                WHERE post_category.post_id = posts.id
                  AND post_category.category_id = :category_id
            )';
            $params[':category_id'] = $categoryId;
        }

        if ($tagId !== null) {
            $where .= ' AND EXISTS (
                SELECT 1 FROM post_tag
                WHERE post_tag.post_id = posts.id
                  AND post_tag.tag_id = :tag_id
            )';
            $params[':tag_id'] = $tagId;
        }

        $statement = $pdo->prepare(
            'SELECT posts.id, posts.title, posts.slug, posts.excerpt, posts.content,
                    COALESCE(users.name, posts.author_name) AS author_name,
                    posts.featured_image, posts.published_at,
                    ' . $this->categoryNamesSql() . ' AS category_name
             FROM posts
             LEFT JOIN users ON users.id = posts.author_id
             ' . $where . '
             ORDER BY posts.published_at DESC, posts.id DESC
             LIMIT :limit OFFSET :offset'
        );
        foreach ($params as $key => $value) {
            $statement->bindValue($key, $value, PDO::PARAM_INT);
        }
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    public function countPublished(?int $year = null, ?int $month = null, ?int $categoryId = null, ?int $tagId = null): int
    {
        $sql = 'SELECT COUNT(*) AS total FROM posts WHERE published_at IS NOT NULL AND status = "published" AND deleted_at IS NULL';
        $params = [];

        if ($year !== null && $month !== null) {
            $sql .= ' AND YEAR(published_at) = :year AND MONTH(published_at) = :month';
            $params = ['year' => $year, 'month' => $month];
        }

        if ($categoryId !== null) {
            $sql .= ' AND EXISTS (
                SELECT 1 FROM post_category
                WHERE post_category.post_id = posts.id
                  AND post_category.category_id = :category_id
            )';
            $params['category_id'] = $categoryId;
        }

        if ($tagId !== null) {
            $sql .= ' AND EXISTS (
                SELECT 1 FROM post_tag
                WHERE post_tag.post_id = posts.id
                  AND post_tag.tag_id = :tag_id
            )';
            $params['tag_id'] = $tagId;
        }

        $row = $this->database->fetch($sql, $params);

        return (int) ($row['total'] ?? 0);
    }

    /**
     * Posts publicados aleatorios, excluindo um post especifico — usado na
     * secao "Continue lendo" ao final do post.
     */
    public function randomExcluding(int $excludeId, int $limit): array
    {
        $pdo = $this->database->connection();
        $statement = $pdo->prepare(
            'SELECT posts.id, posts.title, posts.slug, posts.excerpt, posts.content,
                    posts.featured_image, posts.published_at,
                    ' . $this->categoryNamesSql() . ' AS category_name
             FROM posts
             WHERE posts.published_at IS NOT NULL AND posts.status = "published"
               AND posts.deleted_at IS NULL AND posts.id != :exclude_id
             ORDER BY RAND()
             LIMIT :limit'
        );
        $statement->bindValue(':exclude_id', $excludeId, PDO::PARAM_INT);
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    /**
     * Arquivo por mes (estilo WordPress) dos posts publicados.
     */
    public function archive(): array
    {
        return $this->database->fetchAll(
            'SELECT YEAR(published_at) AS year, MONTH(published_at) AS month, COUNT(*) AS total
             FROM posts
             WHERE published_at IS NOT NULL AND status = "published" AND deleted_at IS NULL
             GROUP BY YEAR(published_at), MONTH(published_at)
             ORDER BY year DESC, month DESC'
        );
    }

    public function search(string $term, int $page, int $perPage): array
    {
        $page = max(1, $page);
        $offset = ($page - 1) * $perPage;
        $like = $this->likeTerm($term);
        $pdo = $this->database->connection();
        $statement = $pdo->prepare(
            'SELECT posts.id, posts.title, posts.slug, posts.excerpt, posts.content,
                    COALESCE(users.name, posts.author_name) AS author_name,
                    posts.featured_image, posts.published_at,
                    ' . $this->categoryNamesSql() . ' AS category_name
             FROM posts
             LEFT JOIN users ON users.id = posts.author_id
             WHERE posts.published_at IS NOT NULL AND posts.status = "published" AND posts.deleted_at IS NULL
               AND (posts.title LIKE :term1 OR posts.excerpt LIKE :term2 OR posts.content LIKE :term3)
             ORDER BY posts.published_at DESC, posts.id DESC
             LIMIT :limit OFFSET :offset'
        );
        $statement->bindValue(':term1', $like);
        $statement->bindValue(':term2', $like);
        $statement->bindValue(':term3', $like);
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    public function searchCount(string $term): int
    {
        $like = $this->likeTerm($term);
        $row = $this->database->fetch(
            'SELECT COUNT(*) AS total FROM posts
             WHERE published_at IS NOT NULL AND status = "published" AND deleted_at IS NULL
               AND (title LIKE :term1 OR excerpt LIKE :term2 OR content LIKE :term3)',
            ['term1' => $like, 'term2' => $like, 'term3' => $like]
        );

        return (int) ($row['total'] ?? 0);
    }

    private function likeTerm(string $term): string
    {
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], trim($term));

        return '%' . $escaped . '%';
    }

    /**
     * Todos os posts publicados (slug + data), sem paginacao — usado no
     * sitemap.xml.
     */
    public function allPublishedForSitemap(): array
    {
        return $this->database->fetchAll(
            'SELECT slug, updated_at FROM posts
             WHERE published_at IS NOT NULL AND status = "published" AND deleted_at IS NULL
             ORDER BY published_at DESC'
        );
    }

    public function findBySlug(string $slug): ?array
    {
        $post = $this->database->fetch(
            'SELECT posts.id, posts.title, posts.slug, posts.excerpt, posts.content,
                    COALESCE(users.name, posts.author_name) AS author_name,
                    posts.featured_image, posts.published_at,
                    ' . $this->categoryNamesSql() . ' AS category_name
             FROM posts
             LEFT JOIN users ON users.id = posts.author_id
             WHERE posts.slug = :slug AND posts.published_at IS NOT NULL AND posts.status = "published" AND posts.deleted_at IS NULL
             LIMIT 1',
            ['slug' => $slug]
        );

        if ($post !== null) {
            $post['tags'] = $this->tagsForPost((int) $post['id']);
            $post['categories'] = $this->categoriesForPost((int) $post['id']);
        }

        return $post;
    }

    /**
     * Posts mais recentes por data de criacao (independente de status) —
     * usado no painel inicial do admin.
     */
    public function recentForAdmin(int $limit): array
    {
        $pdo = $this->database->connection();
        $statement = $pdo->prepare(
            'SELECT posts.id, posts.title, posts.slug, posts.status, posts.created_at,
                    COALESCE(users.name, posts.author_name) AS author_name
             FROM posts
             LEFT JOIN users ON users.id = posts.author_id
             WHERE posts.deleted_at IS NULL
             ORDER BY posts.created_at DESC, posts.id DESC
             LIMIT :limit'
        );
        $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    /**
     * Contagem de posts por status (published/draft/hidden) — usado nos
     * cards de estatistica do painel inicial do admin.
     */
    public function countsByStatus(): array
    {
        $rows = $this->database->fetchAll(
            'SELECT status, COUNT(*) AS total FROM posts WHERE deleted_at IS NULL GROUP BY status'
        );
        $counts = ['published' => 0, 'draft' => 0, 'hidden' => 0];

        foreach ($rows as $row) {
            if (array_key_exists($row['status'], $counts)) {
                $counts[$row['status']] = (int) $row['total'];
            }
        }

        return $counts;
    }

    /**
     * Lista completa (sem paginacao) pro admin — usada pela tabela com
     * busca/ordenacao/paginacao em JS de /admin/posts, que filtra e ordena
     * no navegador em vez de ir ao banco a cada interacao.
     */
    public function allForAdmin(): array
    {
        return $this->database->fetchAll(
            'SELECT posts.id, posts.title, posts.slug, posts.status,
                    COALESCE(users.name, posts.author_name) AS author_name,
                    posts.published_at,
                    ' . $this->categoryNamesSql() . ' AS category_name
             FROM posts
             LEFT JOIN users ON users.id = posts.author_id
             WHERE posts.deleted_at IS NULL
             ORDER BY posts.published_at DESC, posts.id DESC'
        );
    }

    public function findByIdForAdmin(int $id): ?array
    {
        $post = $this->database->fetch(
            'SELECT posts.id, posts.title, posts.slug, posts.excerpt, posts.content,
                    posts.author_id,
                    COALESCE(users.name, posts.author_name) AS author_name,
                    posts.featured_image, posts.published_at, posts.status,
                    ' . $this->categoryNamesSql() . ' AS category_name
             FROM posts
             LEFT JOIN users ON users.id = posts.author_id
             WHERE posts.id = :id AND posts.deleted_at IS NULL
             LIMIT 1',
            ['id' => $id]
        );

        if ($post !== null) {
            $post['tags'] = $this->tagsForPost($id);
            $post['categories'] = $this->categoriesForPost($id);
            $post['category_ids'] = array_map('intval', array_column($post['categories'], 'id'));
        }

        return $post;
    }

    public function updateForAdmin(int $id, array $data): void
    {
        $pdo = $this->database->connection();
        $pdo->beginTransaction();

        try {
            $categoryIds = $this->normalizeCategoryIds($data['category_ids'] ?? []);
            $primaryCategoryId = $categoryIds[0] ?? null;
            $author = $this->findAuthor((int) ($data['author_id'] ?? 0));
            $slug = trim($data['slug']) !== '' ? trim($data['slug']) : $this->slugify((string) $data['title']);
            $this->database->execute(
                'UPDATE posts
                 SET title = :title,
                     slug = :slug,
                     excerpt = :excerpt,
                     content = :content,
                     author_id = :author_id,
                     author_name = :author_name,
                     featured_image = :featured_image,
                     published_at = :published_at,
                     category_id = :category_id,
                     status = :status
                 WHERE id = :id',
                [
                    'title' => $data['title'],
                    'slug' => $slug,
                    'excerpt' => $data['excerpt'],
                    'content' => $data['content'],
                    'author_id' => $author['id'],
                    'author_name' => $author['name'],
                    'featured_image' => $data['featured_image'],
                    'published_at' => $data['published_at'] ?: null,
                    'category_id' => $primaryCategoryId,
                    'status' => $this->normalizeStatus($data['status'] ?? 'draft'),
                    'id' => $id,
                ]
            );
            $this->syncCategories($id, $categoryIds);
            $this->syncTags($id, $data['tags'] ?? '');
            $pdo->commit();
        } catch (\Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    public function createForAdmin(array $data): int
    {
        $pdo = $this->database->connection();
        $pdo->beginTransaction();

        try {
            $categoryIds = $this->normalizeCategoryIds($data['category_ids'] ?? []);
            $primaryCategoryId = $categoryIds[0] ?? null;
            $author = $this->findAuthor((int) ($data['author_id'] ?? 0));
            $slug = trim($data['slug']) !== '' ? trim($data['slug']) : $this->slugify((string) $data['title']);
            $this->database->execute(
                'INSERT INTO posts (
                    title, slug, excerpt, content, author_id, author_name, featured_image,
                    published_at, category_id, status, deleted_at
                 ) VALUES (
                    :title, :slug, :excerpt, :content, :author_id, :author_name, :featured_image,
                    :published_at, :category_id, :status, NULL
                 )',
                [
                    'title' => $data['title'],
                    'slug' => $slug,
                    'excerpt' => $data['excerpt'],
                    'content' => $data['content'],
                    'author_id' => $author['id'],
                    'author_name' => $author['name'],
                    'featured_image' => $data['featured_image'],
                    'published_at' => $data['published_at'] ?: null,
                    'category_id' => $primaryCategoryId,
                    'status' => $this->normalizeStatus($data['status'] ?? 'draft'),
                ]
            );
            $id = (int) $pdo->lastInsertId();
            $this->syncCategories($id, $categoryIds);
            $this->syncTags($id, $data['tags'] ?? '');
            $pdo->commit();

            return $id;
        } catch (\Throwable $exception) {
            $pdo->rollBack();
            throw $exception;
        }
    }

    public function deleteForAdmin(int $id): void
    {
        $this->database->execute(
            'UPDATE posts SET deleted_at = NOW(), status = "hidden" WHERE id = :id',
            ['id' => $id]
        );
    }

    public function updateStatusForAdmin(int $id, string $status): void
    {
        $this->database->execute(
            'UPDATE posts SET status = :status WHERE id = :id AND deleted_at IS NULL',
            ['status' => $this->normalizeStatus($status), 'id' => $id]
        );
    }

    private function tagsForPost(int $postId): array
    {
        return $this->database->fetchAll(
            'SELECT tags.name, tags.slug
             FROM tags
             INNER JOIN post_tag ON post_tag.tag_id = tags.id
             WHERE post_tag.post_id = :post_id
             ORDER BY tags.name',
            ['post_id' => $postId]
        );
    }

    private function categoriesForPost(int $postId): array
    {
        return $this->database->fetchAll(
            'SELECT categories.id, categories.name, categories.slug
             FROM categories
             INNER JOIN post_category ON post_category.category_id = categories.id
             WHERE post_category.post_id = :post_id
             ORDER BY categories.name',
            ['post_id' => $postId]
        );
    }

    private function categoryNamesSql(): string
    {
        return '(SELECT GROUP_CONCAT(categories.name ORDER BY categories.name SEPARATOR ", ")
                 FROM categories
                 INNER JOIN post_category ON post_category.category_id = categories.id
                 WHERE post_category.post_id = posts.id)';
    }

    private function normalizeCategoryIds($categoryIds): array
    {
        if (!is_array($categoryIds)) {
            $categoryIds = [$categoryIds];
        }

        $ids = [];

        foreach ($categoryIds as $categoryId) {
            $id = (int) $categoryId;

            if ($id > 0) {
                $category = $this->database->fetch(
                    'SELECT id FROM categories WHERE id = :id LIMIT 1',
                    ['id' => $id]
                );

                if ($category !== null) {
                    $ids[$id] = $id;
                }
            }
        }

        if (empty($ids)) {
            $row = $this->database->fetch('SELECT id FROM categories ORDER BY name LIMIT 1');

            if ($row !== null) {
                $ids[(int) $row['id']] = (int) $row['id'];
            }
        }

        if (empty($ids)) {
            $categoryId = $this->findOrCreateCategory('Geral');
            $ids[$categoryId] = $categoryId;
        }

        return array_values($ids);
    }

    private function findAuthor(int $authorId): array
    {
        $author = null;

        if ($authorId > 0) {
            $author = $this->database->fetch(
                'SELECT id, name FROM users WHERE id = :id LIMIT 1',
                ['id' => $authorId]
            );
        }

        if ($author === null) {
            $author = $this->database->fetch('SELECT id, name FROM users ORDER BY name LIMIT 1');
        }

        if ($author === null) {
            return ['id' => null, 'name' => 'Equipe Editorial'];
        }

        return ['id' => (int) $author['id'], 'name' => $author['name']];
    }

    private function findOrCreateCategory(string $name): int
    {
        $name = $name !== '' ? $name : 'Geral';
        $slug = $this->slugify($name);
        $this->database->execute(
            'INSERT INTO categories (name, slug) VALUES (:name, :slug)
             ON DUPLICATE KEY UPDATE name = VALUES(name)',
            ['name' => $name, 'slug' => $slug]
        );
        $row = $this->database->fetch('SELECT id FROM categories WHERE slug = :slug LIMIT 1', ['slug' => $slug]);

        return (int) $row['id'];
    }

    private function syncCategories(int $postId, array $categoryIds): void
    {
        $this->database->execute('DELETE FROM post_category WHERE post_id = :post_id', ['post_id' => $postId]);

        foreach ($categoryIds as $categoryId) {
            $this->database->execute(
                'INSERT IGNORE INTO post_category (post_id, category_id) VALUES (:post_id, :category_id)',
                ['post_id' => $postId, 'category_id' => (int) $categoryId]
            );
        }
    }

    private function syncTags(int $postId, string $tags): void
    {
        $this->database->execute('DELETE FROM post_tag WHERE post_id = :post_id', ['post_id' => $postId]);
        $names = array_filter(array_map('trim', explode(',', $tags)));

        foreach ($names as $name) {
            $slug = $this->slugify($name);
            $this->database->execute(
                'INSERT INTO tags (name, slug) VALUES (:name, :slug)
                 ON DUPLICATE KEY UPDATE name = VALUES(name)',
                ['name' => $name, 'slug' => $slug]
            );
            $tag = $this->database->fetch('SELECT id FROM tags WHERE slug = :slug LIMIT 1', ['slug' => $slug]);
            $this->database->execute(
                'INSERT IGNORE INTO post_tag (post_id, tag_id) VALUES (:post_id, :tag_id)',
                ['post_id' => $postId, 'tag_id' => (int) $tag['id']]
            );
        }
    }

    private function slugify(string $value): string
    {
        // iconv('UTF-8', 'ASCII//TRANSLIT', ...) depende do locale do
        // servidor pra transliterar (á -> a); quando falha, ele so descarta
        // o caractere acentuado (ou vira "?", que a regex tambem descarta),
        // entao "Correção" virava "corre-o" em vez de "correcao". Text::slugify
        // troca acentuados por seus equivalentes sem acento de forma explicita,
        // sem depender de locale.
        $value = Text::slugify($value);

        return $value !== '' ? $value : 'item';
    }

    private function normalizeStatus(string $status): string
    {
        $allowed = ['published', 'draft', 'hidden'];

        return in_array($status, $allowed, true) ? $status : 'draft';
    }
}
