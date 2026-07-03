import type { Metadata } from "next";
import LegalDocumentPage from "@/content/legal/LegalDocumentPage";
import * as terms from "@/content/legal/terms";

export const metadata: Metadata = {
  title: terms.title,
};

export default function TermsPage() {
  return <LegalDocumentPage document={terms} />;
}
