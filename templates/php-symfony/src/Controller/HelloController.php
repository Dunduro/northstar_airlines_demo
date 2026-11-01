<?php

declare(strict_types=1);

namespace App\Controller;

use Psr\Log\LoggerInterface;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

final class HelloController
{
    public function __construct(private readonly LoggerInterface $logger)
    {
    }

    #[Route('/', name: 'hello', methods: ['GET'])]
    public function __invoke(Request $request): JsonResponse
    {
        $this->logger->info('said hello', ['event' => 'hello']);

        return new JsonResponse([
            'message' => 'Hello from ' . ($_SERVER['SERVICE'] ?? 'hello-php-api'),
            'correlation_id' => $request->attributes->get('correlation_id'),
        ]);
    }
}
