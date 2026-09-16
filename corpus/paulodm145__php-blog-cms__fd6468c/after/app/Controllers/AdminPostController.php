<?php

namespace App\Controllers;

use App\Core\Auth;
use App\Core\ErrorPage;
use App\Core\View;
use App\Repositories\CategoryRepository;
use App\Repositories\PostRepository;
use App\Repositories\UserRepository;

class AdminPostController
{
    private $posts;
    private $categories;
    private $users;

    public function __construct()
    {
        Auth::requireAdmin();
        $this->posts = new PostRepository();
        $this->categories = new CategoryRepository();
        $this->users = new UserRepository();
    }

    public function index(): void
    {
        $posts = $this->posts->allForAdmin();

        View::render('admin/posts', [
            'title' => 'Posts | Admin paulorb.dev',
            'user' => Auth::user(),
            'posts' => $posts,
            'totalPosts' => count($posts),
        ]);
    }

    public function edit(string $id): void
    {
        $post = $this->posts->findByIdForAdmin((int) $id);

        if ($post === null) {
            ErrorPage::notFound();
            return;
        }

        View::render('admin/post-edit', [
            'title' => 'Editar post | Admin paulorb.dev',
            'user' => Auth::user(),
            'post' => $post,
            'categories' => $this->categories->all(),
            'users' => $this->users->all(),
            'success' => ($_GET['saved'] ?? '') === '1',
            'isNew' => false,
        ]);
    }

    public function create(): void
    {
        $categories = $this->categories->all();
        $users = $this->users->all();
        $currentUser = Auth::user();
        $defaultCategoryIds = isset($categories[0]) ? [(int) $categories[0]['id']] : [];

        View::render('admin/post-edit', [
            'title' => 'Novo post | Admin paulorb.dev',
            'user' => $currentUser,
            'post' => [
                'id' => null,
                'title' => '',
                'slug' => '',
                'excerpt' => '',
                'content' => '',
                'author_name' => $this->currentUserName(),
                'author_id' => $currentUser['id'] ?? null,
                'featured_image' => '/assets/images/blog-feature.svg',
                'published_at' => date('Y-m-d H:i:s'),
                'status' => 'draft',
                'category_name' => 'Geral',
                'category_ids' => $defaultCategoryIds,
                'tags' => [],
            ],
            'categories' => $categories,
            'users' => $users,
            'success' => false,
            'isNew' => true,
        ]);
    }

    public function store(): void
    {
        $id = $this->posts->createForAdmin($this->postData());
        header('Location: /admin/posts/' . $id . '/edit?saved=1');
    }

    public function update(string $id): void
    {
        $postId = (int) $id;
        $post = $this->posts->findByIdForAdmin($postId);

        if ($post === null) {
            ErrorPage::notFound();
            return;
        }

        $this->posts->updateForAdmin($postId, $this->postData());
        $post = $this->posts->findByIdForAdmin($postId);

        View::render('admin/post-edit', [
            'title' => 'Editar post | Admin paulorb.dev',
            'user' => Auth::user(),
            'post' => $post,
            'categories' => $this->categories->all(),
            'users' => $this->users->all(),
            'success' => true,
            'isNew' => false,
        ]);
    }

    public function delete(string $id): void
    {
        $this->posts->deleteForAdmin((int) $id);
        header('Location: /admin/posts');
    }

    public function status(string $id, string $status): void
    {
        $this->posts->updateStatusForAdmin((int) $id, $status);
        header('Location: ' . ($_SERVER['HTTP_REFERER'] ?? '/admin/posts'));
    }

    private function postData(): array
    {
        $currentImage = trim($_POST['current_featured_image'] ?? '/assets/images/blog-feature.svg');

        return [
            'title' => trim($_POST['title'] ?? ''),
            'slug' => trim($_POST['slug'] ?? ''),
            'excerpt' => trim($_POST['excerpt'] ?? ''),
            'content' => trim($_POST['content'] ?? ''),
            'author_id' => (int) ($_POST['author_id'] ?? 0),
            'featured_image' => $this->featuredImagePath($currentImage),
            'published_at' => str_replace('T', ' ', trim($_POST['published_at'] ?? '')),
            'category_ids' => $_POST['category_ids'] ?? [],
            'tags' => trim($_POST['tags'] ?? ''),
            'status' => trim($_POST['status'] ?? 'draft'),
        ];
    }

    private function featuredImagePath(string $currentImage): string
    {
        $imageData = trim($_POST['featured_image_data'] ?? '');

        if ($imageData === '') {
            return $this->uploadedFeaturedImage($currentImage);
        }

        if (strlen($imageData) > 5000000) {
            return $currentImage;
        }

        if (!preg_match('/^data:image\/(jpeg|png|webp);base64,/', $imageData, $matches)) {
            return $currentImage;
        }

        $extension = $matches[1] === 'jpeg' ? 'jpg' : $matches[1];
        $base64 = substr($imageData, strpos($imageData, ',') + 1);
        $binary = base64_decode($base64, true);

        if ($binary === false || strlen($binary) > 3145728) {
            return $currentImage;
        }

        $uploadPath = dirname(__DIR__, 2) . '/public/uploads/posts';

        if (!is_dir($uploadPath)) {
            mkdir($uploadPath, 0755, true);
        }

        $fileName = 'post-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $extension;
        file_put_contents($uploadPath . '/' . $fileName, $binary);

        return '/uploads/posts/' . $fileName;
    }

    private function uploadedFeaturedImage(string $currentImage): string
    {
        if (
            !isset($_FILES['featured_image_upload'])
            || !is_array($_FILES['featured_image_upload'])
            || ($_FILES['featured_image_upload']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE
        ) {
            return $currentImage !== '' ? $currentImage : '/assets/images/blog-feature.svg';
        }

        if ($_FILES['featured_image_upload']['error'] !== UPLOAD_ERR_OK) {
            return $currentImage;
        }

        if ((int) $_FILES['featured_image_upload']['size'] > 2097152) {
            return $currentImage;
        }

        $tmpName = $_FILES['featured_image_upload']['tmp_name'];
        $mimeType = mime_content_type($tmpName);
        $extensions = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];

        if (!isset($extensions[$mimeType])) {
            return $currentImage;
        }

        $uploadPath = dirname(__DIR__, 2) . '/public/uploads/posts';

        if (!is_dir($uploadPath)) {
            mkdir($uploadPath, 0755, true);
        }

        $fileName = 'post-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $extensions[$mimeType];

        if (!move_uploaded_file($tmpName, $uploadPath . '/' . $fileName)) {
            return $currentImage;
        }

        return '/uploads/posts/' . $fileName;
    }

    public function uploadImage(): void
    {
        header('Content-Type: application/json');

        $file = $_FILES['image'] ?? null;
        $error = 'Envie uma imagem JPG, PNG ou WebP de até 2 MB';

        if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK
            || (int) $file['size'] > 2097152) {
            http_response_code(422);
            echo json_encode(['error' => $error]);
            return;
        }

        $extensions = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'image/webp' => 'webp',
        ];
        $mimeType = (string) mime_content_type((string) $file['tmp_name']);

        if (!isset($extensions[$mimeType])) {
            http_response_code(422);
            echo json_encode(['error' => $error]);
            return;
        }

        $uploadPath = dirname(__DIR__, 2) . '/public/uploads/posts';

        if (!is_dir($uploadPath)) {
            mkdir($uploadPath, 0755, true);
        }

        $fileName = 'post-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $extensions[$mimeType];

        if (!move_uploaded_file((string) $file['tmp_name'], $uploadPath . '/' . $fileName)) {
            http_response_code(422);
            echo json_encode(['error' => 'Não foi possível salvar a imagem']);
            return;
        }

        echo json_encode(['url' => '/uploads/posts/' . $fileName]);
    }

    private function currentUserName(): string
    {
        $user = Auth::user();

        return $user['name'] ?? 'Equipe Editorial';
    }
}
