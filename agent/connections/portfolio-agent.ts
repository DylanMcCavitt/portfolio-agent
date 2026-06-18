import { connect } from "@vercel/connect/eve";
import { defineMcpClientConnection } from "eve/connections";

export default defineMcpClientConnection({
  url: "https://mcp.vercel.com",
  description: "Vercel account and project management through the Vercel MCP server.",
  auth: connect("cl_5P6vkuuU0nbHwdwakXhK6m8ZIzDHKZq1"),
});
