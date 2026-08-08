import { Suspense } from "react";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-12">
      <h1 className="mb-1 text-2xl font-semibold">Sign in</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        No passwords — we&apos;ll email you a sign-in link.
      </p>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
