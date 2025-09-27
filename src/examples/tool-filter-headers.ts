import { FastMCP } from "../FastMCP.js";

// Example demonstrating role-based tool filtering using HTTP headers
const server = new FastMCP({
  name: "Role-Based Tool Filter Demo",
  // Tool filter that checks user role from headers
  toolFilter: async (tools, context) => {
    console.log("🔍 Tool filter called with headers:", context.headers);
    console.log(
      "📋 Available tools:",
      tools.map((t) => t.name),
    );

    // Example: Filter tools based on x-user-role header
    const userRole = context.headers["x-user-role"];
    console.log("👤 User role from header:", userRole);

    if (userRole === "admin") {
      // Admins get access to all tools
      console.log("✅ Admin access: returning all tools");
      return tools;
    } else if (userRole === "editor") {
      // Editors get read and write tools, but no admin tools
      const editorTools = tools.filter(
        (tool) => !tool.name.includes("admin") && !tool.name.includes("delete"),
      );
      console.log(
        "✅ Editor access:",
        editorTools.map((t) => t.name),
      );
      return editorTools;
    } else if (userRole === "viewer") {
      // Viewers get only read-only tools
      const viewerTools = tools.filter(
        (tool) =>
          tool.name.includes("read") ||
          tool.name.includes("get") ||
          tool.name.includes("list"),
      );
      console.log(
        "✅ Viewer access:",
        viewerTools.map((t) => t.name),
      );
      return viewerTools;
    }

    // No role or unknown role - return minimal tools
    console.log("⚠️ No valid role found, returning public tools only");
    const publicTools = tools.filter((tool) => tool.name.includes("public"));
    return publicTools;
  },
  version: "1.0.0",
});

// Add example tools with different permission levels
server.addTool({
  description: "Read system configuration",
  execute: async () => "Config data retrieved",
  name: "read_config",
});

server.addTool({
  description: "Get user information",
  execute: async () => "User data retrieved",
  name: "get_users",
});

server.addTool({
  description: "List all resources",
  execute: async () => "Resources listed",
  name: "list_resources",
});

server.addTool({
  description: "Update system settings",
  execute: async () => "Settings updated",
  name: "update_settings",
});

server.addTool({
  description: "Create new content",
  execute: async () => "Content created",
  name: "create_content",
});

server.addTool({
  description: "Delete sensitive data (admin only)",
  execute: async () => "Data deleted",
  name: "admin_delete_data",
});

server.addTool({
  description: "System administration tool",
  execute: async () => "Admin operation completed",
  name: "admin_manage_system",
});

server.addTool({
  description: "Public information access",
  execute: async () => "Public info retrieved",
  name: "public_info",
});

// Start the server
server.start({
  httpStream: {
    host: "localhost",
    port: 8080,
  },
  transportType: "httpStream",
});

console.log("🚀 Server started on http://localhost:8080/mcp");
console.log("");
console.log("📝 Test the role-based tool filtering with different headers:");
console.log("   # Admin user (gets all tools):");
console.log("   curl -X POST http://localhost:8080/mcp \\");
console.log("     -H 'Content-Type: application/json' \\");
console.log("     -H 'x-user-role: admin' \\");
console.log('     -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'');
console.log("");
console.log("   # Editor user (gets read/write tools, no admin tools):");
console.log("   curl -X POST http://localhost:8080/mcp \\");
console.log("     -H 'Content-Type: application/json' \\");
console.log("     -H 'x-user-role: editor' \\");
console.log('     -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'');
console.log("");
console.log("   # Viewer user (gets read-only tools):");
console.log("   curl -X POST http://localhost:8080/mcp \\");
console.log("     -H 'Content-Type: application/json' \\");
console.log("     -H 'x-user-role: viewer' \\");
console.log('     -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'');
console.log("");
console.log("   # No role (gets public tools only):");
console.log("   curl -X POST http://localhost:8080/mcp \\");
console.log("     -H 'Content-Type: application/json' \\");
console.log('     -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'');
