<?php

declare(strict_types=1);

namespace App;

use App\Logging\JsonLogger;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\FrameworkBundle;
use Symfony\Bundle\FrameworkBundle\Kernel\MicroKernelTrait;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;
use Symfony\Component\HttpKernel\Kernel as BaseKernel;
use Symfony\Component\Routing\Loader\Configurator\RoutingConfigurator;

/**
 * A Symfony micro-kernel: one file of configuration, no YAML, no Flex recipes. Grows into a
 * full Symfony app (config/, bundles) without changing how it is built or run.
 */
final class Kernel extends BaseKernel
{
    use MicroKernelTrait;

    public function registerBundles(): iterable
    {
        yield new FrameworkBundle();
    }

    protected function configureContainer(ContainerConfigurator $container): void
    {
        $container->extension('framework', [
            'secret' => '%env(default:default_secret:APP_SECRET)%',
            'http_method_override' => false,
            'handle_all_throwables' => true,
            'php_errors' => ['log' => true],
            'router' => ['utf8' => true],
        ]);
        $container->parameters()->set('default_secret', 'not-used-no-sessions-or-csrf');

        $services = $container->services()->defaults()->autowire()->autoconfigure();
        $services->load('App\\', __DIR__ . '/')->exclude([__DIR__ . '/Kernel.php']);

        // The platform's JSON logger replaces Symfony's default stderr logger.
        $services->set('logger', JsonLogger::class)->public();
        $services->alias(LoggerInterface::class, 'logger');
    }

    protected function configureRoutes(RoutingConfigurator $routes): void
    {
        $routes->import(__DIR__ . '/Controller/', 'attribute');
    }

    /** The image ships a warmed cache; tests and local runs can point it elsewhere. */
    public function getCacheDir(): string
    {
        return $_SERVER['APP_CACHE_DIR'] ?? parent::getCacheDir();
    }

    /** Logs go to stderr, never to files; this only keeps Symfony from needing var/log. */
    public function getLogDir(): string
    {
        return sys_get_temp_dir() . '/log';
    }
}
