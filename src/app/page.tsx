import React from "react";
import HomeClient from "../../components/HomeClient";
import { APP_NAME } from "@/lib/constants";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-10 md:px-6">
      <h1 className="mb-8 text-3xl font-bold text-text md:text-4xl">
        Welcome to {APP_NAME}
      </h1>
      <section className="flex w-full justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <HomeClient />
        </div>
      </section>
    </main>
  );
}
