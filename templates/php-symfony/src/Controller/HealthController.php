<?php

declare(strict_types=1);

namespace App\Controller;

use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

final class HealthController
{
    /** Liveness for the ALB health check: no dependency calls. */
    #[Route('/health', name: 'health', methods: ['GET'])]
    public function __invoke(): JsonResponse
    {
        return new JsonResponse([
            'status' => 'ok',
            'service' => $_SERVER['SERVICE'] ?? 'hello-php-api',
            'version' => $_SERVER['VERSION'] ?? 'dev',
        ]);
    }
}
