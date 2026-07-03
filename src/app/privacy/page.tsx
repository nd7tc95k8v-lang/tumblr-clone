import type { Metadata } from "next";
import LegalDocumentPage from "@/content/legal/LegalDocumentPage";
import * as privacy from "@/content/legal/privacy";

export const metadata: Metadata = {
  title: privacy.title,
};

export default function PrivacyPage() {
  return <LegalDocumentPage document={privacy} />;
}
