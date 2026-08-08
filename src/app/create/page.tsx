import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile-form";
import { CreateEventForm } from "./create-form";

export default async function CreatePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/create");

  if (!user.name || !user.photoUrl) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-8">
        <h1 className="mb-1 text-2xl font-semibold">First, your profile</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Creating an event makes you attendee #1, and every attendee needs a name and
          photo — it&apos;s how people find each other on the night.
        </p>
        <ProfileForm
          initialName={user.name ?? ""}
          initialPhotoUrl={user.photoUrl}
          submitLabel="Save and continue"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-8">
      <h1 className="mb-1 text-2xl font-semibold">Create an event</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Speed dating, self-organising: it only goes ahead if enough people on both sides
        join by the deadline. You&apos;re attendee #1 — no hosting required.
      </p>
      <CreateEventForm />
    </main>
  );
}
