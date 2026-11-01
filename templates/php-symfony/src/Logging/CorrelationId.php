<?php

declare(strict_types=1);

namespace App\Logging;

/** The current request's correlation id (one per request; reset by the subscriber). */
final class CorrelationId
{
    private const VALID = '/^[A-Za-z0-9._:-]{1,128}$/';

    private ?string $current = null;

    public function startFrom(?string $header): string
    {
        $this->current = ($header !== null && preg_match(self::VALID, $header) === 1)
            ? $header
            : bin2hex(random_bytes(16));

        return $this->current;
    }

    public function get(): ?string
    {
        return $this->current;
    }

    public function clear(): void
    {
        $this->current = null;
    }
}
