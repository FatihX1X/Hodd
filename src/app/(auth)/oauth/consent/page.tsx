import type { Metadata } from "next";
import { OAuthConsent } from "@/components/oauth-consent";

export const metadata: Metadata = { title: "Connect to Hodd", robots: { index: false, follow: false } };

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const authorizationId = typeof params.authorization_id === "string" ? params.authorization_id : null;
  return <OAuthConsent authorizationId={authorizationId} />;
}
