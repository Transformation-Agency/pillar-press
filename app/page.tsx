// Minimal landing/health page. Pillar Press is API-first; the front-end
// prototype (re-pointed off localStorage/window.claude) consumes /api/*.
export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem", maxWidth: 640 }}>
      <h1>Pillar Press</h1>
      <p>Editorial workstation backend. The API lives under <code>/api</code>.</p>
    </main>
  );
}
