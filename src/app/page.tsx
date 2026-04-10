import React from "react";
import HomeClient from "../../components/HomeClient";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl md:text-4xl font-bold mb-8 text-zinc-900 dark:text-zinc-100">
        My Tumblr Clone
      </h1>
      <section className="w-full flex justify-center">
        <div className="w-full max-w-xl flex flex-col items-center gap-6">
          <HomeClient />
        </div>
      </section>
    </main>
  );
}
