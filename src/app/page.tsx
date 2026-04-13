import React from "react";
import HomeClient from "../../components/HomeClient";
import { APP_NAME } from "@/lib/constants";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-bg flex flex-col items-center py-10 px-4">
      <h1 className="text-3xl md:text-4xl font-bold mb-8 text-text">
        Welcome to {APP_NAME}
      </h1>
      <section className="w-full flex justify-center">
        <div className="w-full max-w-xl flex flex-col items-center gap-6">
          <HomeClient />
        </div>
      </section>
    </main>
  );
}
