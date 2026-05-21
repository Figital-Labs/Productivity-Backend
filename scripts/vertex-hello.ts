// Throwaway connectivity check for Vertex AI. Confirms the SA in .env can call
// gemini-2.5-flash and get a response. Not production code; delete after Sprint 2.
//
// Run: npx tsx scripts/vertex-hello.ts

import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const credentials = JSON.parse(requireEnv("GOOGLE_SERVICE_ACCOUNT_JSON"));
  const project = requireEnv("GOOGLE_CLOUD_PROJECT");
  const location = requireEnv("GOOGLE_CLOUD_LOCATION");

  console.log(`→ Project: ${project}`);
  console.log(`→ Location: ${location}`);
  console.log(`→ Service account: ${credentials.client_email}`);
  console.log("→ Calling gemini-2.5-flash via Vertex AI...\n");

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: { credentials },
  });

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Say hello in exactly five words.",
  });

  console.log("--- Response ---");
  console.log(response.text);
  console.log("--- End ---");
}

main().catch((err) => {
  console.error("❌ Vertex hello-world failed:");
  console.error(err);
  process.exit(1);
});
