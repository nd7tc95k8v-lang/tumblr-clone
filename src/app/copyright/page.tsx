import type { Metadata } from "next";
import LegalDocumentPage from "@/content/legal/LegalDocumentPage";
import * as copyright from "@/content/legal/copyright";

export const metadata: Metadata = {
  title: copyright.title,
};

export default function CopyrightPage() {
  return <LegalDocumentPage document={copyright} />;
}
