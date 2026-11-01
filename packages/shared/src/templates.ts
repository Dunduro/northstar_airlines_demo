/**
 * The paved-road template catalog shown in the dashboard (GET /v1/templates). One entry per
 * directory in templates/; a unit test keeps this list in sync with each template's
 * platform.yaml and with the golden-path versions in CATALOG. In production the list is read
 * from the template repositories' manifests at release time.
 */
import { Type, type Static } from '@sinclair/typebox';

export const TemplateInfo = Type.Object({
  id: Type.String({ description: 'Template name (directory / template repository)' }),
  language: Type.String({ description: 'Language and runtime version, e.g. node22, php8.3' }),
  framework: Type.String(),
  goldenPath: Type.String({ description: 'Golden-path module the template deploys onto' }),
  moduleVersion: Type.String({ description: 'Module constraint the template pins, e.g. 2.4 (~> 2.4)' }),
  buildWorkflow: Type.String({ description: 'Platform build workflow the template calls' }),
  artifact: Type.Union([Type.Literal('image'), Type.Literal('lambda-zip'), Type.Literal('static-bundle')]),
  runtime: Type.Optional(Type.String({ description: 'Lambda runtime, for lambda-api templates' })),
  chooseWhen: Type.String(),
});
export type TemplateInfo = Static<typeof TemplateInfo>;

export const TEMPLATES: TemplateInfo[] = [
  {
    id: 'node-api', language: 'node22', framework: 'fastify', goldenPath: 'ecs-service', moduleVersion: '2.4',
    buildWorkflow: 'build-node.yml', artifact: 'image',
    chooseWhen: 'A typical HTTP/JSON API or BFF; the default for new backend work',
  },
  {
    id: 'php-symfony', language: 'php8.3', framework: 'symfony-php-fpm', goldenPath: 'ecs-service', moduleVersion: '2.4',
    buildWorkflow: 'build-php.yml', artifact: 'image',
    chooseWhen: 'PHP teams, Symfony apps, moving existing PHP onto the platform',
  },
  {
    id: 'dotnet-api', language: 'dotnet8', framework: 'aspnetcore-minimal-api', goldenPath: 'ecs-service', moduleVersion: '2.4',
    buildWorkflow: 'build-dotnet.yml', artifact: 'image',
    chooseWhen: '.NET teams, typed domain-heavy services, existing C# libraries',
  },
  {
    id: 'python-fastapi', language: 'python3.12', framework: 'fastapi', goldenPath: 'ecs-service', moduleVersion: '2.4',
    buildWorkflow: 'build-python.yml', artifact: 'image',
    chooseWhen: 'Data-adjacent APIs, model serving, Python teams',
  },
  {
    id: 'node-lambda', language: 'node22', framework: 'none', goldenPath: 'lambda-api', moduleVersion: '1.5',
    buildWorkflow: 'build-node.yml', artifact: 'lambda-zip', runtime: 'nodejs22.x',
    chooseWhen: 'Webhooks, integrations, spiky or low-traffic APIs',
  },
  {
    id: 'python-lambda', language: 'python3.12', framework: 'none', goldenPath: 'lambda-api', moduleVersion: '1.5',
    buildWorkflow: 'build-python.yml', artifact: 'lambda-zip', runtime: 'python3.12',
    chooseWhen: 'Webhooks, integrations and automation glue, for Python teams',
  },
  {
    id: 'react-static', language: 'javascript', framework: 'react-vite', goldenPath: 'static-site', moduleVersion: '2.0',
    buildWorkflow: 'build-static.yml', artifact: 'static-bundle',
    chooseWhen: 'SPAs, internal tool frontends, documentation',
  },
];
