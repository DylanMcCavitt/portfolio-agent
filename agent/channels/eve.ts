import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc, vercelSubject } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Visitor chat ingress only. Account/project MCP connections must not live
    // on this public channel unless an admin-only path is added explicitly.
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // Lets the portfolio web app call this agent from preview and production.
    vercelOidc({
      subjects: [
        vercelSubject({
          teamSlug: "dylan-mccavitts-projects",
          projectName: "portfolio",
          environment: "*",
        }),
      ],
    }),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
});
