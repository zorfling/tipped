import { Suspense } from "react";
import { DoneClient } from "./done-client";

export default async function JoinDonePage({
  params,
}: {
  params: Promise<{ slug: string; bucketId: string }>;
}) {
  const { slug, bucketId } = await params;
  return (
    <main className="mx-auto w-full max-w-md px-4 py-12">
      <Suspense>
        <DoneClient slug={slug} bucketId={bucketId} />
      </Suspense>
    </main>
  );
}
