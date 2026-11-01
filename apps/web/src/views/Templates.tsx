import type { TemplateInfo } from '@northstar/shared';
import { useApi } from '../api';
import { Card, Loading, Pill } from '../components';

type Entry = TemplateInfo & { latestModuleVersion: string };

const PATHS: Array<[string, string]> = [
  ['ecs-service', 'Long-running web apps and APIs: containers on Fargate behind the shared ALB'],
  ['lambda-api', 'Event-driven, spiky or integration APIs: API Gateway + Lambda'],
  ['static-site', 'Frontends and docs: private S3 + CloudFront, versioned bundles'],
];

/** The paved road, per language. Read-only: creating a repo from a template is the scaffolder's job. */
export function TemplatesView() {
  const { data, error } = useApi<{ templates: Entry[] }>('/v1/templates');
  if (!data) return <Loading error={error} />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Templates</h1>
          <div className="muted">
            The golden paths are language-agnostic; the language lives in the template and the container image (ADR-015).
            Every template ships /health, JSON logs with a correlation id, and pipelines that call the platform workflows.
            Legacy or vendor software that fits none of these takes the EC2 exception path.
          </div>
        </div>
      </div>
      <div className="grid">
        {PATHS.map(([path, blurb]) => {
          const rows = data.templates.filter((t) => t.goldenPath === path);
          if (rows.length === 0) return null;
          return (
            <Card key={path} title={<><span className="mono">{path}</span> <span className="small muted">v{rows[0]!.latestModuleVersion}</span></>}>
              <p className="muted small" style={{ marginTop: 0 }}>{blurb}</p>
              <table>
                <thead><tr><th>Template</th><th>Language</th><th>Pins</th><th>Build</th><th>Choose it when</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td className="mono">{t.id}</td>
                      <td>{t.language}{t.framework !== 'none' && <div className="small muted">{t.framework}</div>}</td>
                      <td className="mono">~&gt; {t.moduleVersion}{t.runtime && <div className="small muted">{t.runtime}</div>}</td>
                      <td><span className="mono small">{t.buildWorkflow}</span> <Pill kind="neutral">{t.artifact}</Pill></td>
                      <td className="small">{t.chooseWhen}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          );
        })}
      </div>
    </>
  );
}
