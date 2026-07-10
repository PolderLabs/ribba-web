'use client';

import { FormEvent, useState } from 'react';

interface MessageComposerProps {
  onSend: (body: string) => Promise<boolean>;
}

export default function MessageComposer({ onSend }: MessageComposerProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = value.trim();
    if (!body || busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await onSend(body);
    setBusy(false);
    if (ok) {
      setValue('');
    } else {
      // Bericht blijft in het veld staan — geen verlies van getypte tekst.
      setFailed(true);
    }
  }

  return (
    <form className="chat-composer" onSubmit={handleSubmit}>
      {failed && (
        <div className="alert-error" role="alert">Versturen mislukt. Probeer het opnieuw.</div>
      )}
      <div className="chat-composer-row">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Typ een bericht…"
          rows={1}
          maxLength={4000}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit(e);
            }
          }}
        />
        <button type="submit" className="btn-primary chat-send-button" disabled={busy || !value.trim()}>
          {busy ? '…' : 'Verstuur'}
        </button>
      </div>
    </form>
  );
}
