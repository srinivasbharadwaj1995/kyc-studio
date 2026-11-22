import { Suspense } from "react";
import { StudioView } from "@/components/studio/StudioView";

/**
 * /studio/[id]
 *
 * The flow itself lives in the browser's localStorage, so StudioView (a client
 * component) does the real work. This server page only reads the id from the URL.
 *
 * Why <Suspense>: this project enables Next 16 `cacheComponents`. The page shell
 * is prerendered, and anything that depends on the request (like URL params)
 * must sit inside a Suspense boundary so it can stream in after the shell.
 * Using useParams() at the top of a client page failed the production build.
 */
export default function StudioPage({ params }: PageProps<"/studio/[id]">) {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Loading flow…</p>}>
        <Studio params={params} />
      </Suspense>
    </main>
  );
}

async function Studio({ params }: Pick<PageProps<"/studio/[id]">, "params">) {
  const { id } = await params;
  return <StudioView id={id} />;
}
