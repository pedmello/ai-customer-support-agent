const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');

export function App() {
  return (
    <main>
      <p className="eyebrow">AI CUSTOMER SUPPORT AGENT</p>
      <h1>Uma base para um atendimento seguro.</h1>
      <p className="description">
        Estrutura inicial do projeto. A experiência de atendimento por mensagens
        será construída nas próximas etapas.
      </p>
      <section aria-labelledby="stage-title">
        <p className="stage">ETAPA 01</p>
        <h2 id="stage-title">Estrutura e configuração</h2>
        <p>Frontend preparado. Consulte a documentação e verifique a disponibilidade da API e do banco.</p>
        <nav aria-label="Recursos do projeto">
          <a href={`${apiUrl}/docs/`}>Documentação da API <span aria-hidden="true">↗</span></a>
          <a href={`${apiUrl}/health`}>Verificar disponibilidade <span aria-hidden="true">↗</span></a>
        </nav>
      </section>
      <footer>Fundação do projeto · v0.1.0</footer>
    </main>
  );
}
