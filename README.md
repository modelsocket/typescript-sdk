# ModelSocket TypeScript Client SDK

This is the official TypeScript client SDK for ModelSocket, a WebSocket-based protocol for interacting with Large Language Models (LLMs).

ModelSocket provides a stateful, multiplexed, and efficient way to stream text, manage conversational context, and utilize tools with LLMs.

For more information about the ModelSocket protocol and its capabilities, please visit the official website: [https://modelsocket.github.io](https://modelsocket.github.io)

## Features

- **Stateful Sequences:** Maintain context across multiple interactions.
- **Multiplexing:** Handle multiple independent LLM interactions over a single WebSocket connection.
- **Streaming:** Receive generated text and tokens in real-time.
- **Tool Use:** Enable LLMs to use client-defined tools.
- **Context Forking:** Efficiently branch and explore different conversational paths.

## Installation

```bash
npm install modelsocket-ts # Or your preferred package manager
# or
yarn add modelsocket-ts
```

## Quick Start

```typescript
import { ModelSocket, Seq } from "modelsocket-ts";

async function main() {
  // Connect to your ModelSocket server
  const client = await ModelSocket.connect("wss://socket.mixlayer.ai");

  try {
    // Open a new sequence (conversation) with a specific model
    const seq = await client.open("meta/llama3.1-8b-instruct-free");

    // Append a user message to the sequence
    await seq.append("Hello, assistant!");

    // Generate a response from the model
    const stream = seq.gen({ role: "assistant" });

    // Stream the response text
    console.log("Assistant:");
    for await (const chunk of stream.textStream()) {
      process.stdout.write(chunk);
    }
    console.log("\n");

    // Or get the full text at once
    // const fullText = await stream.text();
    // console.log("Assistant (full):", fullText);

    // Close the sequence
    await seq.close();
  } catch (error) {
    console.error("An error occurred:", error);
  } finally {
    // Close the client connection
    client.close();
  }
}

main();
```

## Examples

- **Chat** ([Website](https://modelsocket-nextjs-chat.vercel.app/), [Repository](https://github.com/modelsocket/nextjs-chat)) A simple ModelSocket chat app
- **Fork demo** ([Website](https://modelsocket-nextjs-fork-demo.vercel.app/), [Repository](https://github.com/modelsocket/nextjs-fork-demo)) - Generate multiple sequences from a common token ancestry.

## Usage

### Connecting to ModelSocket

First, establish a connection to your ModelSocket server:

```typescript
import { ModelSocket } from "modelsocket-ts";

const client = await ModelSocket.connect("ws://your-modelsocket-server-url");
```

### Opening a Sequence

A `Seq` (Sequence) represents a single, stateful interaction with an LLM, like a conversation.

```typescript
const seq = await client.open(
  "model-name-or-id", // Specify the model you want to use
  {
    // Optional parameters
    tools: true, // Enable tool usage for this sequence
  }
);
```

### Appending Messages

You can append messages to a sequence to build up context. This is useful for providing history or instructions to the LLM.

```typescript
// Append a user message
await seq.append("Tell me a joke.", { role: "user" });

// Append a system message (often hidden from the user, but visible to the model)
await seq.append("The user is feeling playful.", {
  role: "system",
  hidden: true,
});

// Append an assistant's previous response
await seq.append("Why did the chicken cross the road?", { role: "assistant" });
```

### Generating Text

To get a response from the LLM, use the `gen` method. This returns a `GenStream` which allows you to process the LLM's output as it arrives.

```typescript
const stream: GenStream = seq.gen({
  role: "assistant", // The role the LLM should adopt for this generation
  // tokens: true,      // Set to true to receive token IDs along with text
  // temperature: 0.7,  // Set generation temperature
});

// Process the stream
for await (const chunk of stream.stream()) {
  if (!chunk.hidden) {
    process.stdout.write(chunk.text);
    if (chunk.tokens) {
      // console.log("Tokens:", chunk.tokens);
    }
  }
}
process.stdout.write("\n");

// Alternatively, get all text at once after the stream finishes:
// const fullResponse = await stream.text();
// console.log(fullResponse);

// Or text and tokens:
// const { text, tokens } = await stream.textAndTokens();
// console.log("Full text:", text, "All tokens:", tokens);
```

### Using Tools

If tools are enabled for a sequence (`tools: true` during `client.open()`), you can install tool definitions on the `Seq` object.

```typescript
import { Tool } from "modelsocket-ts";

// Define a tool
const getWeatherTool: Tool = {
  name: "get_current_weather",
  description: "Get the current weather in a given location",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: "The city and state, e.g. San Francisco, CA",
      },
      unit: { type: "string", enum: ["celsius", "fahrenheit"] },
    },
    required: ["location"],
  },
  fn: async (params: { location: string; unit?: string }) => {
    // Your tool implementation
    console.log(`Tool call: getWeatherTool with params:`, params);
    if (params.location.toLowerCase().includes("tokyo")) {
      return {
        temperature: "15",
        unit: params.unit || "celsius",
        forecast: "clear",
      };
    }
    return {
      temperature: "22",
      unit: params.unit || "celsius",
      forecast: "sunny",
    };
  },
};

// Install the tool on the sequence
await seq.install(getWeatherTool);

// Now, when you call seq.gen(), the LLM might decide to use this tool.
// The SDK will automatically call your `fn` and return the result to the LLM
// to continue generation.
await seq.append("What's the weather like in Tokyo?");
const weatherStream = seq.gen();
for await (const chunk of weatherStream.textStream()) {
  process.stdout.write(chunk);
}
process.stdout.write("\n");
```

### Forking a Sequence

Forking allows you to create a new sequence that inherits the context of an existing one. This is useful for exploring different conversational paths without affecting the original sequence.

```typescript
// Create a fork
const childSeq = await seq.createFork();

// Interact with the childSeq independently
await childSeq.append("What if I asked a different question?");
const childStream = childSeq.gen();
// ... process childStream ...
await childSeq.close();

// The original 'seq' remains unaffected.

// You can also use `withFork` for a more managed approach:
await seq.withFork(async (forkedSeq) => {
  await forkedSeq.append("Exploring an alternative path...");
  const result = await forkedSeq.gen().text();
  console.log("Forked result:", result);
  // forkedSeq is automatically closed when this async function completes or throws
});
```

### Closing

Always close sequences and the client when you're done to free up resources.

```typescript
await seq.close();
client.close();
```

## Logging

The SDK uses a simple logger. You can enable logging by setting the `MODELSOCKET_LOG` environment variable:

- `MODELSOCKET_LOG=debug`: Enables debug, info, and error logs.
- `MODELSOCKET_LOG=info`: Enables info and error logs.
- `MODELSOCKET_LOG=error`: Enables only error logs.

Example:

```bash
MODELSOCKET_LOG=debug node your-script.js
```

## License

Apache 2.0
