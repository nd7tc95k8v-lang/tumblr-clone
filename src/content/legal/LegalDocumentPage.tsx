import React from "react";
import type { LegalBlock, LegalDocument } from "./types";

type Props = {
  document: LegalDocument;
};

function renderBlock(block: LegalBlock, index: number) {
  if (block.type === "paragraph") {
    return (
      <p key={index} className="mt-3 text-text-secondary leading-relaxed">
        {block.text}
      </p>
    );
  }

  return (
    <ul key={index} className="mt-3 list-disc space-y-1 pl-5 text-text-secondary leading-relaxed">
      {block.items.map((item, itemIndex) => (
        <li key={itemIndex}>{item}</li>
      ))}
    </ul>
  );
}

export default function LegalDocumentPage({ document }: Props) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-3 pt-5 pb-8 md:px-6 md:py-10">
      <section className="flex w-full justify-center">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <article className="qrtz-card w-full">
            <h1 className="font-heading text-3xl font-bold text-text md:text-4xl">{document.title}</h1>
            <p className="mt-2 text-meta text-text-muted">Last updated: {document.lastUpdated}</p>

            <div className="mt-8 flex flex-col gap-8">
              {document.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="font-heading text-xl font-bold text-text">{section.heading}</h2>
                  {section.body.map((block, index) => renderBlock(block, index))}
                </section>
              ))}
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
