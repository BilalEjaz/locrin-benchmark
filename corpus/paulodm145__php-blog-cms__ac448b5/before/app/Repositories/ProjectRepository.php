<?php

namespace App\Repositories;

use App\Core\Text;
use App\Database\Database;
use PDO;

class ProjectRepository
{
    private $database;

    public function __construct(?Database $database = null)
    {
        $this->database = $database ?: new Database();
    }

    public function paginateForAdmin(int $page, int $perPage, string $search): array
    {
        $page = max(1, $page);
        $offset = ($page - 1) * $perPage;
        $pdo = $this->database->connection();
        $where = ' WHERE projects.deleted_at IS NULL';
        $params = [];

        if ($search !== '') {
            $where .= ' AND projects.name LIKE :search';
            $params['search'] = '%' . $search . '%';
        }

        $statement = $pdo->prepare(
            $this->selectSql() . $where . ' ORDER BY projects.sort_order, projects.id LIMIT :limit OFFSET :offset'
        );

        foreach ($params as $key => $value) {
            $statement->bindValue($key, $value);
        }

        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return array_map([$this, 'withComputedFields'], $statement->fetchAll());
    }

    public function countForAdmin(string $search): int
    {
        $sql = 'SELECT COUNT(*) AS total FROM projects WHERE deleted_at IS NULL';
        $params = [];

        if ($search !== '') {
            $sql .= ' AND name LIKE :search';
            $params['search'] = '%' . $search . '%';
        }

        $row = $this->database->fetch($sql, $params);

        return (int) ($row['total'] ?? 0);
    }

    public function findByIdForAdmin(int $id): ?array
    {
        $row = $this->database->fetch(
            $this->selectSql() . ' WHERE projects.id = :id AND projects.deleted_at IS NULL LIMIT 1',
            ['id' => $id]
        );

        if ($row === null) {
            return null;
        }

        $project = $this->withComputedFields($row);
        $project['gallery'] = $this->galleryFor($id);

        return $project;
    }

    public function findBySlug(string $slug): ?array
    {
        $row = $this->database->fetch(
            $this->selectSql() . ' WHERE projects.slug = :slug AND projects.status = "published" AND projects.deleted_at IS NULL LIMIT 1',
            ['slug' => $slug]
        );

        if ($row === null) {
            return null;
        }

        $project = $this->withComputedFields($row);
        $project['gallery'] = $this->galleryFor((int) $row['id']);

        return $project;
    }

    /**
     * Imagens da galeria de um projeto, na ordem em que foram adicionadas
     * — so buscada nas leituras de um projeto so (form de edicao e pagina
     * de detalhe), nao nas listagens, pra nao gerar N+1 query por card.
     */
    private function galleryFor(int $projectId): array
    {
        return $this->database->fetchAll(
            'SELECT media.id, media.path AS url, media.original_name AS name
             FROM project_images
             INNER JOIN media ON media.id = project_images.media_id AND media.deleted_at IS NULL
             WHERE project_images.project_id = :project_id
             ORDER BY project_images.sort_order',
            ['project_id' => $projectId]
        );
    }

    /**
     * Listagem publica de /projetos: mais recente primeiro (por data de
     * inicio), nao pela ordem manual do admin — nao ha UI de reordenar
     * aqui, so em /curriculo (featuredForResume) isso importaria.
     */
    public function paginatePublished(int $page, int $perPage): array
    {
        $page = max(1, $page);
        $offset = ($page - 1) * $perPage;
        $pdo = $this->database->connection();
        $statement = $pdo->prepare(
            $this->selectSql() . ' WHERE projects.status = "published" AND projects.deleted_at IS NULL
             ORDER BY projects.start_date DESC, projects.id DESC
             LIMIT :limit OFFSET :offset'
        );
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return array_map([$this, 'withComputedFields'], $statement->fetchAll());
    }

    public function countPublished(): int
    {
        $row = $this->database->fetch(
            'SELECT COUNT(*) AS total FROM projects WHERE status = "published" AND deleted_at IS NULL'
        );

        return (int) ($row['total'] ?? 0);
    }

    public function featuredForResume(): array
    {
        return array_map(
            [$this, 'withComputedFields'],
            $this->database->fetchAll(
                $this->selectSql() . ' WHERE projects.featured = 1 AND projects.status = "published"
                 AND projects.deleted_at IS NULL
                 ORDER BY projects.sort_order, projects.id'
            )
        );
    }

    public function allPublishedForSitemap(): array
    {
        return $this->database->fetchAll(
            'SELECT slug, updated_at FROM projects WHERE status = "published" AND deleted_at IS NULL'
        );
    }

    public function create(array $data): int
    {
        $values = $this->normalize($data, null);
        $values['sort_order'] = $this->nextSortOrder();

        $this->database->execute(
            'INSERT INTO projects (
                name, slug, tagline, content, cover_media_id, technologies, role, project_type,
                live_url, source_url, start_date, end_date, featured, status, sort_order
             ) VALUES (
                :name, :slug, :tagline, :content, :cover_media_id, :technologies, :role, :project_type,
                :live_url, :source_url, :start_date, :end_date, :featured, :status, :sort_order
             )',
            $values
        );

        $id = (int) $this->database->connection()->lastInsertId();
        $this->syncGallery($id, $data['gallery_media_ids'] ?? '');

        return $id;
    }

    public function update(int $id, array $data): void
    {
        $values = $this->normalize($data, $id);
        unset($values['sort_order']);
        $values['id'] = $id;

        $this->database->execute(
            'UPDATE projects
             SET name = :name, slug = :slug, tagline = :tagline, content = :content,
                 cover_media_id = :cover_media_id, technologies = :technologies, role = :role,
                 project_type = :project_type, live_url = :live_url, source_url = :source_url,
                 start_date = :start_date, end_date = :end_date, featured = :featured, status = :status
             WHERE id = :id',
            $values
        );

        $this->syncGallery($id, $data['gallery_media_ids'] ?? '');
    }

    /**
     * Recria as linhas de project_images a partir da lista de IDs (texto
     * separado por virgula, na ordem escolhida no form) — mesmo padrao de
     * sincronizacao que PostRepository::syncTags()/syncCategories() ja usa.
     */
    private function syncGallery(int $projectId, string $mediaIdsCsv): void
    {
        $this->database->execute(
            'DELETE FROM project_images WHERE project_id = :project_id',
            ['project_id' => $projectId]
        );

        $mediaIds = array_filter(array_map('intval', explode(',', $mediaIdsCsv)));

        foreach (array_values($mediaIds) as $position => $mediaId) {
            $this->database->execute(
                'INSERT INTO project_images (project_id, media_id, sort_order) VALUES (:project_id, :media_id, :sort_order)',
                ['project_id' => $projectId, 'media_id' => $mediaId, 'sort_order' => $position]
            );
        }
    }

    public function delete(int $id): void
    {
        $this->database->execute('UPDATE projects SET deleted_at = NOW() WHERE id = :id', ['id' => $id]);
    }

    /**
     * IDs de todos os projetos nao excluidos, na ordem atual de sort_order —
     * usado pelo admin pra saber a posicao global de um projeto (primeiro/
     * ultimo) independente de paginacao ou busca, que so afetam a listagem.
     */
    public function orderedIdsForAdmin(): array
    {
        $rows = $this->database->fetchAll('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY sort_order, id');

        return array_map(static function (array $row): int {
            return (int) $row['id'];
        }, $rows);
    }

    public function moveUp(int $id): void
    {
        $this->swapOrder($id, -1);
    }

    public function moveDown(int $id): void
    {
        $this->swapOrder($id, 1);
    }

    /**
     * Troca a posicao do projeto $id com o vizinho na direcao indicada e
     * regrava sort_order de 0..N-1 pra toda a lista — mesmo padrao de
     * ResumeCertificationRepository::swap().
     */
    private function swapOrder(int $id, int $direction): void
    {
        $rows = $this->database->fetchAll('SELECT id FROM projects WHERE deleted_at IS NULL ORDER BY sort_order, id');
        $index = null;

        foreach ($rows as $position => $row) {
            if ((int) $row['id'] === $id) {
                $index = $position;
                break;
            }
        }

        $targetIndex = $index + $direction;

        if ($index === null || $targetIndex < 0 || $targetIndex >= count($rows)) {
            return;
        }

        [$rows[$index], $rows[$targetIndex]] = [$rows[$targetIndex], $rows[$index]];

        foreach ($rows as $position => $row) {
            $this->database->execute(
                'UPDATE projects SET sort_order = :sort_order WHERE id = :id',
                ['sort_order' => $position, 'id' => $row['id']]
            );
        }
    }

    private function nextSortOrder(): int
    {
        $row = $this->database->fetch('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM projects WHERE deleted_at IS NULL');

        return (int) $row['max_order'] + 1;
    }

    private function selectSql(): string
    {
        return 'SELECT projects.*, media.path AS cover_url, media.original_name AS cover_name
                 FROM projects
                 LEFT JOIN media ON media.id = projects.cover_media_id AND media.deleted_at IS NULL';
    }

    /**
     * Injeta campos derivados: "period" formatado (dd/mm/aaaa, igual aos
     * cursos), "technology_list" (array a partir do texto livre separado
     * por virgula), "is_ongoing" (true quando end_date esta vazio) e duas
     * variantes de descricao curta (usadas quando a tagline nao foi
     * preenchida, caindo pro texto puro do content): "resume_description"
     * — truncada, pra card de /projetos e secao Projetos do /curriculo,
     * onde o espaco e limitado — e "resume_description_full" — sem
     * truncar, pro PDF do curriculo, que nao deve resumir a descricao.
     */
    private function withComputedFields(array $row): array
    {
        $row['period'] = Text::dateRange($row['start_date'], $row['end_date']);
        $row['is_ongoing'] = $row['end_date'] === null;
        $row['technology_list'] = array_values(array_filter(array_map('trim', explode(',', (string) $row['technologies']))));

        $plainContent = trim(strip_tags((string) $row['content']));
        $row['resume_description'] = $row['tagline'] !== '' ? $row['tagline'] : Text::truncate($plainContent, 160);
        $row['resume_description_full'] = $row['tagline'] !== '' ? $row['tagline'] : $plainContent;

        return $row;
    }

    private function normalize(array $data, ?int $excludeId): array
    {
        $name = trim((string) $data['name']);
        $slugInput = trim((string) ($data['slug'] ?? ''));
        $slug = $this->uniqueSlug($slugInput !== '' ? $this->slugify($slugInput) : $this->slugify($name), $excludeId);
        $startDate = trim((string) ($data['start_date'] ?? ''));
        $endDate = trim((string) ($data['end_date'] ?? ''));
        $coverMediaId = (int) ($data['cover_media_id'] ?? 0);
        $projectType = trim((string) ($data['project_type'] ?? ''));

        return [
            'name' => $name,
            'slug' => $slug,
            'tagline' => trim((string) ($data['tagline'] ?? '')),
            'content' => trim((string) ($data['content'] ?? '')),
            'cover_media_id' => $coverMediaId > 0 ? $coverMediaId : null,
            'technologies' => trim((string) ($data['technologies'] ?? '')),
            'role' => trim((string) ($data['role'] ?? '')) !== '' ? trim((string) $data['role']) : null,
            'project_type' => in_array($projectType, ['personal', 'professional', 'freelance'], true) ? $projectType : null,
            'live_url' => trim((string) ($data['live_url'] ?? '')) !== '' ? trim((string) $data['live_url']) : null,
            'source_url' => trim((string) ($data['source_url'] ?? '')) !== '' ? trim((string) $data['source_url']) : null,
            'start_date' => $startDate !== '' ? $startDate : null,
            'end_date' => $endDate !== '' ? $endDate : null,
            'featured' => !empty($data['featured']) ? 1 : 0,
            'status' => in_array($data['status'] ?? '', ['published', 'draft'], true) ? $data['status'] : 'draft',
            'sort_order' => (int) ($data['sort_order'] ?? 0),
        ];
    }

    /**
     * Acrescenta -2, -3... ate achar um slug livre — diferente do padrao
     * de posts/paginas hoje, que deixa a constraint UNIQUE do banco
     * estourar um erro se colidir.
     */
    private function uniqueSlug(string $baseSlug, ?int $excludeId): string
    {
        $slug = $baseSlug;
        $suffix = 2;

        while ($this->slugExists($slug, $excludeId)) {
            $slug = $baseSlug . '-' . $suffix;
            $suffix++;
        }

        return $slug;
    }

    private function slugExists(string $slug, ?int $excludeId): bool
    {
        $sql = 'SELECT id FROM projects WHERE slug = :slug';
        $params = ['slug' => $slug];

        if ($excludeId !== null) {
            $sql .= ' AND id != :exclude_id';
            $params['exclude_id'] = $excludeId;
        }

        return $this->database->fetch($sql . ' LIMIT 1', $params) !== null;
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

        return $value !== '' ? $value : 'projeto';
    }
}
