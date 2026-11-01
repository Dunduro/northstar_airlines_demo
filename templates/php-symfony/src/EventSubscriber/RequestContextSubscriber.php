<?php

declare(strict_types=1);

namespace App\EventSubscriber;

use App\Logging\CorrelationId;
use Psr\Log\LoggerInterface;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\RequestEvent;
use Symfony\Component\HttpKernel\Event\ResponseEvent;
use Symfony\Component\HttpKernel\Event\TerminateEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/** Platform conventions in one place: correlation id in, out, and on every log line. */
final class RequestContextSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly CorrelationId $correlationId,
        private readonly LoggerInterface $logger,
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::REQUEST => ['onRequest', 4096],
            KernelEvents::RESPONSE => ['onResponse', -1024],
            KernelEvents::TERMINATE => ['onTerminate', -1024],
        ];
    }

    public function onRequest(RequestEvent $event): void
    {
        if ($event->isMainRequest()) {
            $id = $this->correlationId->startFrom($event->getRequest()->headers->get('x-correlation-id'));
            $event->getRequest()->attributes->set('correlation_id', $id);
        }
    }

    public function onResponse(ResponseEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }
        $request = $event->getRequest();
        $event->getResponse()->headers->set('x-correlation-id', (string) $this->correlationId->get());
        $started = (float) $request->server->get('REQUEST_TIME_FLOAT', microtime(true));
        $this->logger->info('request completed', [
            'method' => $request->getMethod(),
            'path' => $request->getPathInfo(),
            'status' => $event->getResponse()->getStatusCode(),
            'duration_ms' => round((microtime(true) - $started) * 1000, 1),
        ]);
    }

    public function onTerminate(TerminateEvent $event): void
    {
        $this->correlationId->clear();
    }
}
