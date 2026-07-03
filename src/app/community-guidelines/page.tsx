import type { Metadata } from "next";
import LegalDocumentPage from "@/content/legal/LegalDocumentPage";
import * as communityGuidelines from "@/content/legal/community-guidelines";

export const metadata: Metadata = {
  title: communityGuidelines.title,
};

export default function CommunityGuidelinesPage() {
  return <LegalDocumentPage document={communityGuidelines} />;
}
