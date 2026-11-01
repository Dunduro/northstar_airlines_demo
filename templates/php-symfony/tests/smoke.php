<?php

// Dependency-free smoke test (composer test): boots the kernel and handles real requests.
declare(strict_types=1);

use App\Kernel;
use Symfony\Component\HttpFoundation\Request;

require dirname(__DIR__) . '/vendor/autoload.php';

$_SERVER['APP_CACHE_DIR'] = sys_get_temp_dir() . '/hello-php-api-test-cache';
$_SERVER['LOG_LEVEL'] = 'warning';
$kernel = new Kernel('prod', false);
$failures = 0;
$check = static function (string $name, bool $ok) use (&$failures): void {
    echo ($ok ? 'ok   ' : 'FAIL ') . $name . "\n";
    $failures += $ok ? 0 : 1;
};

$res = $kernel->handle(Request::create('/health'));
$check('GET /health answers 200 for the ALB', $res->getStatusCode() === 200);
$check('GET /health reports ok', json_decode((string) $res->getContent(), true)['status'] === 'ok');

$req = Request::create('/');
$req->headers->set('x-correlation-id', 'abc-123');
$res = $kernel->handle($req);
$check('a valid correlation id is reused and echoed', $res->headers->get('x-correlation-id') === 'abc-123');

$req = Request::create('/');
$req->headers->set('x-correlation-id', "bad id\n");
$res = $kernel->handle($req);
$check('a malformed correlation id is replaced', preg_match('/^[0-9a-f]{32}$/', (string) $res->headers->get('x-correlation-id')) === 1);

exit($failures === 0 ? 0 : 1);
