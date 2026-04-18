import React from "react";
import HomeClient from "../../components/HomeClient";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-5 pb-8 md:px-6 md:py-10">
      <section className="flex w-full justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <HomeClient />
        </div>
      </section>
    </main>
  );
}
