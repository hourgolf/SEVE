// Graceful red banner shown when reads fail. Mirrors the reference HTML:
// an auth/RLS/key failure gets the actionable two-cause message; anything
// else shows the raw connection error.

export function ErrorBanner({
  message,
  isAccessError,
}: {
  message: string;
  isAccessError: boolean;
}) {
  if (isAccessError) {
    return (
      <div className="banner">
        Can&apos;t read your tables yet. Two likely causes:
        <br />
        1. <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> isn&apos;t set in{" "}
        <code>.env.local</code> (copy <code>.env.local.example</code>), or
        <br />
        2. The read-access SQL hasn&apos;t run (the <code>grant select</code> +{" "}
        <code>create policy</code> block).
        <br />
        <span className="muted">Raw error: {message}</span>
      </div>
    );
  }
  return <div className="banner">Connection error: {message}</div>;
}
