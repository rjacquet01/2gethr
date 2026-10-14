import Link from "next/link"

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">
        We couldn&apos;t find the page you were looking for.
      </p>
      <Link href="/" className="text-primary hover:underline">
        Back to Togethr
      </Link>
    </main>
  )
}
