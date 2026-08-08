"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PHOTO_SIZE = 512;

/** Centre-crop to square, downscale to ≤512px, encode JPEG — all client-side. */
async function cropToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(side, PHOTO_SIZE);
  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    out,
    out,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("crop failed"))),
      "image/jpeg",
      0.85,
    ),
  );
}

export function ProfileForm(props: {
  initialName: string;
  initialPhotoUrl: string | null;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(props.initialName);
  const [preview, setPreview] = useState<string | null>(props.initialPhotoUrl);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const blob = await cropToSquare(file);
      setPhotoBlob(blob);
      setPreview(URL.createObjectURL(blob));
      setError(null);
    } catch {
      setError("Couldn't read that image — try another one.");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("name", name);
    if (photoBlob) form.set("photo", photoBlob, "photo.jpg");
    const res = await fetch("/api/profile", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error ?? "Something went wrong");
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="size-24 shrink-0 overflow-hidden rounded-full border bg-muted"
          aria-label="Change photo"
        >
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Your photo" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center text-xs text-muted-foreground">
              Add photo
            </span>
          )}
        </button>
        <div className="text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Profile photo</p>
          <p>Required to join events — it&apos;s how your dates find you.</p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFile}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">First name</Label>
        <Input
          id="name"
          required
          value={name}
          placeholder="What your dates should call you"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={busy || !name.trim()}>
        {busy ? "Saving…" : (props.submitLabel ?? "Save profile")}
      </Button>
    </form>
  );
}
