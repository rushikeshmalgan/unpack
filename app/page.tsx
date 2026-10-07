import { LinkAnalyzerForm } from "@/components/home/LinkAnalyzerForm";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center px-4 py-16 sm:px-6 sm:py-24">
      <main className="w-full max-w-2xl">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Turn a Reel into useful information.
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Paste the Instagram Reel or Post link.
          </p>
        </div>

        <div className="mt-8">
          <LinkAnalyzerForm />
        </div>

        <p className="mt-10 text-center text-xs text-muted-foreground">
          No login. Nothing is saved. Analyze and move on.
        </p>
      </main>
    </div>
  );
}
