// The version is baked in at build time (VITE_APP_VERSION from build-static.yml), so the page
// itself tells you which immutable bundle CloudFront is serving.
const version = import.meta.env.VITE_APP_VERSION ?? 'dev';

export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Hello from hello-react-site</h1>
      <p>
        Served from S3 through CloudFront, release <code>{version}</code>.
      </p>
    </main>
  );
}
