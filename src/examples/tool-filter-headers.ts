import { FastMCP } from "../FastMCP.js";

// Example demonstrating HTTP header forwarding to tool filter
const server = new FastMCP({
  name: "Tool Filter Headers Demo",
  version: "1.0.0",
  
  // Tool filter that checks headers
  toolFilter: async (tools, context) => {
    console.log("🔍 Tool filter called with headers:", context.headers);
    console.log("📋 Available tools:", tools.map(t => t.name));
    
    // Example: Filter tools based on x-provider header  
    const provider = context.headers['x-provider'];
    console.log("🏷️ Provider from header:", provider);
    
    if (provider === 'vapi') {
      // Only return tools that work with VAPI
      const vapiTools = tools.filter(tool => 
        tool.name.includes('vapi') || tool.name.includes('audio')
      );
      console.log("✅ Filtered for VAPI:", vapiTools.map(t => t.name));
      return vapiTools;
    } else if (provider === 'web') {
      // Only return web-related tools
      const webTools = tools.filter(tool => 
        tool.name.includes('web') || tool.name.includes('http')
      );
      console.log("✅ Filtered for Web:", webTools.map(t => t.name));
      return webTools;
    }
    
    // Return all tools for other providers or no provider
    console.log("✅ No filtering applied, returning all tools");
    return tools;
  }
});

// Add some example tools
server.addTool({
  name: "vapi_make_call",
  description: "Make a phone call using VAPI",
  execute: async () => "Called via VAPI"
});

server.addTool({
  name: "web_scrape",
  description: "Scrape a web page",  
  execute: async () => "Scraped web page"
});

server.addTool({
  name: "general_tool",
  description: "A general purpose tool",
  execute: async () => "General tool executed"
});

server.addTool({
  name: "audio_transcribe", 
  description: "Transcribe audio file",
  execute: async () => "Audio transcribed"
});

// Start the server
server.start({
  transportType: "httpStream",
  httpStream: {
    port: 8080,
    host: "localhost"
  }
});

console.log("🚀 Server started on http://localhost:8080/mcp");
console.log("");
console.log("📝 Test the tool filtering with different headers:");
console.log("   curl -X POST http://localhost:8080/mcp \\");
console.log("     -H 'Content-Type: application/json' \\");
console.log("     -H 'x-provider: vapi' \\");
console.log("     -d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}'");
console.log("");
console.log("   curl -X POST http://localhost:8080/mcp \\");
console.log("     -H 'Content-Type: application/json' \\");
console.log("     -H 'x-provider: web' \\");
console.log("     -d '{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}'");
