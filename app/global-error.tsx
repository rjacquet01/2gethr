"use client"

// Last resort when the root layout itself fails: it replaces the whole page,
// so it brings its own <html> and plain inline styles (no app CSS loads).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Togethr hit a problem</h1>
          <p style={{ maxWidth: 360, margin: 0, color: "#475569" }}>
            Please try again. If it keeps happening, email{" "}
            <a href="mailto:admin@mytogethr.com" style={{ color: "#1e3a5f" }}>admin@mytogethr.com</a>.
          </p>
          <button
            onClick={reset}
            style={{ background: "#1e3a5f", color: "#fff", border: 0, borderRadius: 8, padding: "10px 18px", fontSize: 15, cursor: "pointer" }}
          >
            Try again
          </button>
          {error.digest && <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  )
}
