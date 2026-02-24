export default function Home() {
  return (
    <main className="page-wrapper">
      <div className="card">
        <div className="logo">Ribba</div>
        <p className="pill">Rijschool software</p>
        <h1>Coming soon</h1>
        <p className="subtitle">
          We werken aan een volledig nieuwe Ribba website. Gebruik het menu voor
          wachtwoordresets en toekomstige portals.
        </p>
        <div className="divider" />
        <p style={{ fontSize: 13, color: '#A8A29E' }}>
          Vragen?{' '}
          <a href="mailto:hallo@ribba.app" style={{ color: '#2563EB', fontWeight: 600 }}>
            hallo@ribba.app
          </a>
        </p>
      </div>
    </main>
  );
}
