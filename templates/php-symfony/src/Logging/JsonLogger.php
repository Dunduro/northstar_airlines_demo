<?php

declare(strict_types=1);

namespace App\Logging;

use Psr\Log\AbstractLogger;
use Psr\Log\LogLevel;

/**
 * Structured JSON logging with the platform's mandatory fields (architecture 3.1): one JSON
 * object per line on stderr with service, team, environment, version and correlation_id.
 */
final class JsonLogger extends AbstractLogger
{
    private const LEVELS = [
        LogLevel::DEBUG => 0, LogLevel::INFO => 1, LogLevel::NOTICE => 2, LogLevel::WARNING => 3,
        LogLevel::ERROR => 4, LogLevel::CRITICAL => 5, LogLevel::ALERT => 6, LogLevel::EMERGENCY => 7,
    ];

    /** @var resource */
    private $stream;
    private int $minLevel;

    public function __construct(private readonly CorrelationId $correlationId)
    {
        $this->stream = fopen('php://stderr', 'wb');
        $this->minLevel = self::LEVELS[strtolower((string) ($_SERVER['LOG_LEVEL'] ?? 'info'))] ?? 1;
    }

    public function log($level, string|\Stringable $message, array $context = []): void
    {
        if ((self::LEVELS[$level] ?? 1) < $this->minLevel) {
            return;
        }

        $entry = [
            'timestamp' => (new \DateTimeImmutable())->format('Y-m-d\TH:i:s.vP'),
            'level' => $level,
            'message' => $this->interpolate((string) $message, $context),
            'service' => $_SERVER['SERVICE'] ?? 'hello-php-api',
            'team' => $_SERVER['TEAM'] ?? 'loyalty',
            'environment' => $_SERVER['ENVIRONMENT'] ?? 'local',
            'version' => $_SERVER['VERSION'] ?? 'dev',
            'correlation_id' => $this->correlationId->get() ?? '-',
        ];
        foreach ($context as $key => $value) {
            $entry[$key] = $value instanceof \Throwable
                ? ['class' => $value::class, 'message' => $value->getMessage()]
                : (is_scalar($value) || $value === null || is_array($value) ? $value : get_debug_type($value));
        }

        fwrite($this->stream, json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE) . "\n");
    }

    private function interpolate(string $message, array $context): string
    {
        $replace = [];
        foreach ($context as $key => $value) {
            if (is_scalar($value) || $value instanceof \Stringable) {
                $replace['{' . $key . '}'] = (string) $value;
            }
        }

        return strtr($message, $replace);
    }
}
