import { GenerateFlow } from "@/components/studio/GenerateFlow";
import { SavedFlows } from "@/components/studio/SavedFlows";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-12 px-4 py-10">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">KYC Studio</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Describe a KYC or onboarding flow in plain English. Gemini designs it, Zod checks it, and the studio reviews it for
          privacy and drop-off risks.
        </p>
      </div>
      <GenerateFlow />
      <SavedFlows />
    </main>
  );
}
