"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface Partner {
  registrationId: string;
  name: string | null;
  photoUrl: string | null;
  email: string;
}

export function MatchList({ slug, partners }: { slug: string; partners: Partner[] }) {
  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2">
      {partners.map((p) => (
        <MatchCard key={p.registrationId} slug={slug} partner={p} />
      ))}
    </ul>
  );
}

function MatchCard({ slug, partner }: { slug: string; partner: Partner }) {
  const [blocked, setBlocked] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportBody, setReportBody] = useState("");
  const [reportSent, setReportSent] = useState(false);

  return (
    <li className="rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-full border bg-muted">
          {partner.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={partner.photoUrl} alt="" className="size-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{partner.name}</p>
          {!blocked && (
            <a href={`mailto:${partner.email}`} className="text-sm text-muted-foreground underline">
              {partner.email}
            </a>
          )}
        </div>
      </div>
      <div className="mt-3 flex gap-3 text-xs">
        {blocked ? (
          <span className="text-muted-foreground">
            Blocked — you two will never be scheduled together again.
          </span>
        ) : (
          <>
            <button
              className="text-muted-foreground underline"
              onClick={async () => {
                await fetch("/api/blocks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ blockedRegistrationId: partner.registrationId }),
                });
                setBlocked(true);
              }}
            >
              Block
            </button>
            {!reportSent && (
              <button
                className="text-muted-foreground underline"
                onClick={() => setReporting((r) => !r)}
              >
                Report
              </button>
            )}
          </>
        )}
        {reportSent && <span className="text-muted-foreground">Report sent — thank you.</span>}
      </div>
      {reporting && !reportSent && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            className="min-h-20 rounded-md border bg-background p-2 text-sm"
            placeholder="What happened?"
            value={reportBody}
            onChange={(e) => setReportBody(e.target.value)}
          />
          <Button
            size="sm"
            variant="destructive"
            disabled={!reportBody.trim()}
            onClick={async () => {
              await fetch(`/api/events/${slug}/report`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  reportedRegistrationId: partner.registrationId,
                  body: reportBody,
                }),
              });
              setReportSent(true);
              setReporting(false);
            }}
          >
            Send report
          </Button>
        </div>
      )}
    </li>
  );
}
