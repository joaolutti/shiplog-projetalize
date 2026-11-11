"use client";
// "Relatar problema": opens a small form in place; the dev gets a DM (reportIssue).
import { useState } from "react";
import { reportAction } from "@/app/(app)/actions";
import { Icon } from "./ui";

export function ReportButton({ shipmentId, devName }: { shipmentId: number; devName: string | null }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className="btn neutral sm" onClick={() => setOpen(true)}>
        <Icon name="report" />
        Relatar problema
      </button>
    );
  }
  return (
    <form className="verify" action={reportAction} onSubmit={() => setOpen(false)} style={{ width: "100%" }}>
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <label htmlFor={`rep-${shipmentId}`} className="k">
        O que deu errado?
      </label>
      <textarea
        id={`rep-${shipmentId}`}
        name="comment"
        rows={3}
        required
        maxLength={2000}
        autoFocus
        placeholder="O que você tentou, o que aconteceu e o que esperava"
      />
      <div className="row">
        <button className="btn primary sm" type="submit">
          Enviar relato
        </button>
        <button className="btn ghost sm" type="button" onClick={() => setOpen(false)}>
          Cancelar
        </button>
        <span className="muted" style={{ fontSize: 12 }}>
          {devName ?? "O responsável"} recebe uma DM no Slack.
        </span>
      </div>
    </form>
  );
}
