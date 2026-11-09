<?php
declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

final class ApiError extends RuntimeException {
    public function __construct(public readonly int $status, string $message) { parent::__construct($message); }
}
function fail(int $status, string $message): never { throw new ApiError($status, $message); }
function reply(int $status, array $data): never {
    http_response_code($status);
    echo json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    exit;
}
function query(PDO $db, string $sql, array $params = []): PDOStatement {
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    return $stmt;
}
function row(PDO $db, string $sql, array $params = []): ?array {
    $result = query($db, $sql, $params)->fetch();
    return $result === false ? null : $result;
}
function body(): array {
    $raw = file_get_contents('php://input', false, null, 0, 100001);
    if ($raw === false || strlen($raw) > 100000) fail(413, 'Request is too large.');
    try { $value = json_decode($raw, false, 512, JSON_THROW_ON_ERROR); }
    catch (JsonException $e) { fail(400, 'Invalid request body.'); }
    if (!is_object($value)) fail(400, 'Invalid request body.');
    return (array)$value;
}
function atomic(PDO $db, callable $work): mixed {
    $db->beginTransaction();
    try { $result = $work(); $db->commit(); return $result; }
    catch (Throwable $e) { if ($db->inTransaction()) $db->rollBack(); throw $e; }
}
function publicUser(PDO $db, int $id): ?array {
    return row($db, 'SELECT id, name, email, role, created_at FROM grogu_users WHERE id=?', [$id]);
}
function createUser(PDO $db, array $input): array {
    $name = is_string($input['name'] ?? null) ? trim($input['name']) : '';
    $email = is_string($input['email'] ?? null) ? strtolower(trim($input['email'])) : '';
    $password = $input['password'] ?? null;
    $role = $input['role'] ?? null;
    if ($name === '' || strlen($name) > 100) fail(400, 'Enter a name (up to 100 characters).');
    if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) fail(400, 'Enter a valid email address.');
    if (!is_string($password) || strlen($password) < 10 || strlen($password) > 200) fail(400, 'Password must be between 10 and 200 characters.');
    if (!in_array($role, ['admin', 'member'], true)) fail(400, 'Choose a valid role.');
    try {
        query($db, 'INSERT INTO grogu_users (name,email,password,role) VALUES (?,?,?,?)', [$name, $email, password_hash(hash('sha256', $password), PASSWORD_DEFAULT), $role]);
    } catch (PDOException $e) {
        if (($e->errorInfo[1] ?? null) === 1062) fail(409, 'That email is already in use.');
        throw $e;
    }
    return publicUser($db, (int)$db->lastInsertId());
}
function cookieOptions(bool $secure, int $expires): array {
    return ['expires' => $expires, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict'];
}
function login(PDO $db, array $user, bool $secure): never {
    $token = bin2hex(random_bytes(32));
    query($db, 'DELETE FROM grogu_sessions WHERE expires <= ?', [time()]);
    query($db, 'INSERT INTO grogu_sessions (token,user_id,expires) VALUES (?,?,?)', [hash('sha256', $token), $user['id'], time() + 604800]);
    setcookie('grogu_session', $token, cookieOptions($secure, time() + 604800));
    reply(200, ['user' => $user]);
}
function currentUser(PDO $db): ?array {
    $token = $_COOKIE['grogu_session'] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) return null;
    return row($db, 'SELECT u.id,u.name,u.email,u.role,u.created_at FROM grogu_sessions s JOIN grogu_users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?', [hash('sha256', $token), time()]);
}
function project(PDO $db, int $id): array {
    $project = row($db, 'SELECT * FROM grogu_projects WHERE id=?', [$id]);
    if (!$project) fail(404, 'Project not found.');
    return $project;
}
function projectValues(PDO $db, array $input): array {
    $fields = ['name', 'domain', 'stage_url', 'host', 'launch_date', 'notes', 'designer_id', 'developer_id', 'tester_id', 'account_id'];
    $values = [];
    foreach ($fields as $field) {
        $v = $input[$field] ?? '';
        if (str_ends_with($field, '_id')) {
            if ($v === '' || $v === null) { $values[] = null; continue; }
            if ((!is_string($v) && !is_int($v)) || !ctype_digit((string)$v) || (int)$v < 1 || !publicUser($db, (int)$v)) fail(400, 'Choose a valid team member.');
            $values[] = (int)$v;
            continue;
        }
        $v = is_string($v) ? trim($v) : '';
        if (strlen($v) > ($field === 'notes' ? 5000 : 500)) fail(400, "$field is too long.");
        if ($field === 'name' && $v === '') fail(400, 'Project name is required.');
        if ($field === 'launch_date' && $v !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $v)) fail(400, 'Enter a valid launch date.');
        $values[] = $v;
    }
    return $values;
}

try {
    $config = require __DIR__ . '/config.php';
    $base = $config['base_url'] ?? '';
    $url = parse_url($base);
    $local = ($config['allow_insecure_local'] ?? false) === true && ($url['scheme'] ?? '') === 'http' && in_array($url['host'] ?? '', ['localhost', '127.0.0.1'], true);
    if (!$local && (($url['scheme'] ?? '') !== 'https' || empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off')) fail(403, 'HTTPS is required.');
    if (!is_string($config['setup_key'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $config['setup_key'])) throw new RuntimeException('Invalid setup key configuration.');
    $db = new PDO(
        'mysql:host=' . $config['db_host'] . ';port=' . $config['db_port'] . ';dbname=' . $config['db_name'] . ';charset=utf8mb4',
        $config['db_user'], $config['db_password'],
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false, PDO::ATTR_STRINGIFY_FETCHES => false]
    );
    $method = $_SERVER['REQUEST_METHOD'];
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    if (!in_array($method, ['GET', 'POST', 'PATCH', 'DELETE'], true)) fail(405, 'Method not allowed.');
    if ($method !== 'GET' && (!isset($_SERVER['HTTP_ORIGIN']) || !hash_equals($base, $_SERVER['HTTP_ORIGIN']))) fail(403, 'Invalid request origin.');
    $secure = !$local;
    $user = currentUser($db);
    if ($path === '/api/session' && $method === 'GET') reply(200, ['user' => $user, 'needsSetup' => !row($db, 'SELECT id FROM grogu_users LIMIT 1'), 'setupKeyRequired' => true]);
    if ($path === '/api/setup' && $method === 'POST') {
        $input = body();
        if (!is_string($input['setupKey'] ?? null) || !hash_equals($config['setup_key'], $input['setupKey'])) fail(403, 'Invalid setup key.');
        $created = atomic($db, function () use ($db, $input) {
            query($db, 'SELECT id FROM grogu_setup_lock WHERE id=1 FOR UPDATE');
            if (row($db, 'SELECT id FROM grogu_users LIMIT 1')) fail(403, 'Setup has already been completed.');
            $input['role'] = 'admin';
            return createUser($db, $input);
        });
        login($db, $created, $secure);
    }
    if ($path === '/api/login' && $method === 'POST') {
        $input = body();
        $address = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
        $found = atomic($db, function () use ($db, $input, $address) {
            query($db, 'INSERT INTO grogu_login_attempts (address_hash,attempts,expires) VALUES (?,0,?) ON DUPLICATE KEY UPDATE address_hash=address_hash', [$address, time() + 900]);
            $attempt = row($db, 'SELECT * FROM grogu_login_attempts WHERE address_hash=? FOR UPDATE', [$address]);
            if ((int)$attempt['expires'] <= time()) {
                query($db, 'UPDATE grogu_login_attempts SET attempts=0,expires=? WHERE address_hash=?', [time() + 900, $address]);
                $attempt['attempts'] = 0;
            }
            if ((int)$attempt['attempts'] >= 10) return 'throttled';
            $email = is_string($input['email'] ?? null) ? strtolower(trim($input['email'])) : '';
            $password = $input['password'] ?? '';
            $found = row($db, 'SELECT * FROM grogu_users WHERE email=?', [$email]);
            if (!$found || !is_string($password) || strlen($password) > 200 || !password_verify(hash('sha256', $password), $found['password'])) {
                query($db, 'UPDATE grogu_login_attempts SET attempts=attempts+1 WHERE address_hash=?', [$address]);
                return null;
            }
            query($db, 'DELETE FROM grogu_login_attempts WHERE address_hash=?', [$address]);
            return publicUser($db, (int)$found['id']);
        });
        if ($found === 'throttled') fail(429, 'Too many sign-in attempts. Try again later.');
        if (!$found) fail(401, 'Incorrect email or password.');
        login($db, $found, $secure);
    }
    if (!$user) fail(401, 'Please sign in.');
    if ($path === '/api/password' && $method === 'POST') {
        $input = body();
        $found = row($db, 'SELECT password FROM grogu_users WHERE id=?', [$user['id']]);
        if (!is_string($input['currentPassword'] ?? null) || strlen($input['currentPassword']) > 200 || !password_verify(hash('sha256', $input['currentPassword']), $found['password'])) fail(400, 'Current password is incorrect.');
        $password = $input['newPassword'] ?? null;
        if (!is_string($password) || strlen($password) < 10 || strlen($password) > 200) fail(400, 'New password must be between 10 and 200 characters.');
        atomic($db, function () use ($db, $user, $password) {
            query($db, 'UPDATE grogu_users SET password=? WHERE id=?', [password_hash(hash('sha256', $password), PASSWORD_DEFAULT), $user['id']]);
            query($db, 'DELETE FROM grogu_sessions WHERE user_id=?', [$user['id']]);
        });
        login($db, $user, $secure);
    }
    if ($path === '/api/logout' && $method === 'POST') {
        query($db, 'DELETE FROM grogu_sessions WHERE token=?', [hash('sha256', $_COOKIE['grogu_session'])]);
        setcookie('grogu_session', '', cookieOptions($secure, time() - 3600));
        reply(200, ['ok' => true]);
    }
    if ($path === '/api/users' && $method === 'GET') reply(200, ['users' => query($db, 'SELECT id,name,email,role,created_at FROM grogu_users ORDER BY name')->fetchAll()]);
    if ($path === '/api/users' && $method === 'POST') {
        if ($user['role'] !== 'admin') fail(403, 'Only admins can add team members.');
        reply(201, ['user' => createUser($db, body())]);
    }
    if (preg_match('#^/api/users/(\d+)$#D', $path, $match) && $method === 'DELETE') {
        if ($user['role'] !== 'admin') fail(403, 'Only admins can remove team members.');
        if ((int)$match[1] === $user['id']) fail(400, 'You cannot remove your own account.');
        if (!query($db, 'DELETE FROM grogu_users WHERE id=?', [(int)$match[1]])->rowCount()) fail(404, 'Team member not found.');
        reply(200, ['ok' => true]);
    }
    if ($path === '/api/projects' && $method === 'GET') {
        $projects = query($db, 'SELECT p.*, (SELECT COUNT(*) FROM grogu_items i WHERE i.project_id=p.id) AS total, (SELECT COUNT(*) FROM grogu_items i WHERE i.project_id=p.id AND (i.not_applicable=1 OR (i.designer=1 AND i.developer=1 AND i.content_admin=1 AND i.tester=1 AND i.account_exec=1))) AS completed, (SELECT COUNT(*) FROM grogu_items i WHERE i.project_id=p.id AND (i.not_applicable=1 OR i.designer=1 OR i.developer=1 OR i.content_admin=1 OR i.tester=1 OR i.account_exec=1)) AS started FROM grogu_projects p ORDER BY p.updated_at DESC,p.id DESC')->fetchAll();
        reply(200, ['projects' => $projects]);
    }
    if ($path === '/api/projects' && $method === 'POST') {
        $values = projectValues($db, body());
        $id = atomic($db, function () use ($db, $values) {
            query($db, 'INSERT INTO grogu_projects (name,domain,stage_url,host,launch_date,notes,designer_id,developer_id,tester_id,account_id) VALUES (?,?,?,?,?,?,?,?,?,?)', $values);
            $id = (int)$db->lastInsertId();
            $template = json_decode(file_get_contents(__DIR__ . '/template.json'), true, 512, JSON_THROW_ON_ERROR);
            $position = 0;
            foreach ($template as [$section, $titles]) foreach ($titles as $title) query($db, 'INSERT INTO grogu_items (project_id,section,title,position,notes) VALUES (?,?,?,?,?)', [$id, $section, $title, $position++, '']);
            return $id;
        });
        reply(201, ['project' => project($db, $id)]);
    }
    if (preg_match('#^/api/projects/(\d+)$#D', $path, $match)) {
        $id = (int)$match[1];
        if ($method === 'GET') reply(200, ['project' => project($db, $id), 'items' => query($db, 'SELECT * FROM grogu_items WHERE project_id=? ORDER BY position', [$id])->fetchAll()]);
        if ($method === 'PATCH') {
            project($db, $id);
            $values = projectValues($db, body());
            $values[] = $id;
            query($db, 'UPDATE grogu_projects SET name=?,domain=?,stage_url=?,host=?,launch_date=?,notes=?,designer_id=?,developer_id=?,tester_id=?,account_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', $values);
            reply(200, ['project' => project($db, $id)]);
        }
        if ($method === 'DELETE') {
            if (!query($db, 'DELETE FROM grogu_projects WHERE id=?', [$id])->rowCount()) fail(404, 'Project not found.');
            reply(200, ['ok' => true]);
        }
    }
    if (preg_match('#^/api/projects/(\d+)/items/(\d+)$#D', $path, $match) && $method === 'PATCH') {
        $input = body();
        $keys = array_keys($input);
        if (count($keys) !== 1 || !in_array($keys[0], ['designer', 'developer', 'content_admin', 'tester', 'account_exec', 'not_applicable', 'notes'], true)) fail(400, 'Update one valid checklist field at a time.');
        $key = $keys[0];
        $value = $input[$key];
        if ($key === 'notes') {
            if (!is_string($value) || strlen($value) > 5000) fail(400, 'Notes must be under 5,000 characters.');
        } else {
            if (!is_bool($value)) fail(400, 'Checklist values must be true or false.');
            $value = (int)$value;
        }
        $projectId = (int)$match[1];
        $itemId = (int)$match[2];
        $item = atomic($db, function () use ($db, $key, $value, $projectId, $itemId) {
            if (!row($db, 'SELECT id FROM grogu_items WHERE id=? AND project_id=? FOR UPDATE', [$itemId, $projectId])) fail(404, 'Checklist item not found.');
            query($db, "UPDATE grogu_items SET $key=? WHERE id=? AND project_id=?", [$value, $itemId, $projectId]);
            query($db, 'UPDATE grogu_projects SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [$projectId]);
            return row($db, 'SELECT * FROM grogu_items WHERE id=?', [$itemId]);
        });
        reply(200, ['item' => $item]);
    }
    fail(404, 'Not found.');
} catch (ApiError $e) {
    reply($e->status, ['error' => $e->getMessage()]);
} catch (Throwable $e) {
    error_log((string)$e);
    reply(500, ['error' => 'Something went wrong on the server.']);
}
