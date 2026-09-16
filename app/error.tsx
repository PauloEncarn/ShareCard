'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) { return <main className="system-state" role="alert"><span className="system-error">!</span><strong>Não foi possível abrir esta tela.</strong><p>Verifique sua conexão e tente novamente.</p><button className="button primary" onClick={reset}>Tentar novamente</button></main>; }
