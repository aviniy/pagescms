import { createAuthClient } from "better-auth/react";
import { emailOTPClient } from "better-auth/client/plugins";
import { clientSessionPolicy } from "@/lib/session-policy";

const authClient = createAuthClient({
  sessionOptions: clientSessionPolicy,
  plugins: [emailOTPClient()],
});

export const { emailOtp, signIn, signOut, useSession } = authClient;
export { authClient };
